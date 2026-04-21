// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CrossChainEscrow} from "../../src/CrossChainEscrow.sol";
import {MockUSDC, MockTokenMessenger} from "../mocks/Mocks.sol";

/// @notice Handler for invariant fuzzing. Each external function represents
/// a bounded action the fuzzer may invoke. We always make calls that *could*
/// succeed (correct state, correct actor) — invalid attempts are exercised
/// elsewhere in unit/adversarial tests.
contract Handler is Test {
    CrossChainEscrow public escrow;
    MockUSDC public usdc;
    MockTokenMessenger public tm;
    address public arbiter;

    // small bounded actor pool shared across all escrows
    address[] public actors;

    // per-escrow bookkeeping (indices are escrow IDs starting at 1)
    uint256[] public allIds;
    mapping(uint256 => address) public depositorOf;
    mapping(uint256 => address) public recipientOf;
    mapping(uint256 => address) public refundToOf;

    // ---- ghost variables ----
    uint256 public g_totalDeposited;   // sum of all deposited amounts
    uint256 public g_totalReleased;    // sum of amounts burned via CCTP
    uint256 public g_totalRefundCredited; // sum credited to refundBalances
    uint256 public g_totalWithdrawn;   // sum pulled out via withdrawRefund
    uint256 public g_everCreated;      // monotonic count of escrows created

    // Bounds
    uint256 constant MIN_AMOUNT = 1e6;
    uint256 constant MAX_AMOUNT = 10_000 * 1e6;
    uint256 constant MIN_WINDOW = 1 hours;
    uint256 constant MAX_WINDOW = 7 days;

    constructor(CrossChainEscrow _escrow, MockUSDC _usdc, MockTokenMessenger _tm, address _arbiter) {
        escrow = _escrow;
        usdc = _usdc;
        tm = _tm;
        arbiter = _arbiter;

        // seed actor pool
        for (uint160 i = 1; i <= 5; i++) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            usdc.mint(a, 1_000_000_000 * 1e6);
            vm.prank(a);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function allIdsLength() external view returns (uint256) {
        return allIds.length;
    }

    // ---- helpers ----

    function _pickActor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _pickId(uint256 seed) internal view returns (uint256 id, bool ok) {
        if (allIds.length == 0) return (0, false);
        return (allIds[seed % allIds.length], true);
    }

    function _stateOf(uint256 id) internal view returns (CrossChainEscrow.EscrowState) {
        (, , , , , , , , , , CrossChainEscrow.EscrowState s) = escrow.escrows(id);
        return s;
    }

    function _amountOf(uint256 id) internal view returns (uint256) {
        (, , , uint256 a, , , , , , , ) = escrow.escrows(id);
        return a;
    }

    function _conditionMetAt(uint256 id) internal view returns (uint256) {
        (, , , , , , uint256 t, , , , ) = escrow.escrows(id);
        return t;
    }

    function _windowOf(uint256 id) internal view returns (uint256) {
        (, , , , , , , uint256 w, , , ) = escrow.escrows(id);
        return w;
    }

    // ---- handler actions ----

    function deposit(uint256 seedDepositor, uint256 seedRecipient, uint256 seedRefund, uint256 amount, uint256 window)
        external
    {
        amount = bound(amount, MIN_AMOUNT, MAX_AMOUNT);
        window = bound(window, MIN_WINDOW, MAX_WINDOW);

        address d = _pickActor(seedDepositor);
        address r = _pickActor(seedRecipient);
        address rt = _pickActor(seedRefund);

        vm.prank(d);
        uint256 id = escrow.deposit(r, rt, amount, 1, bytes32(uint256(0xCAFE)), window);

        allIds.push(id);
        depositorOf[id] = d;
        recipientOf[id] = r;
        refundToOf[id] = rt;

        g_totalDeposited += amount;
        g_everCreated++;
    }

    function fulfillCondition(uint256 seed) external {
        (uint256 id, bool ok) = _pickId(seed);
        if (!ok) return;
        if (_stateOf(id) != CrossChainEscrow.EscrowState.DEPOSITED) return;

        vm.prank(depositorOf[id]);
        escrow.fulfillCondition(id);
    }

    function raiseDispute(uint256 seed, bool byRecipient) external {
        (uint256 id, bool ok) = _pickId(seed);
        if (!ok) return;
        if (_stateOf(id) != CrossChainEscrow.EscrowState.CONDITION_MET) return;
        if (block.timestamp > _conditionMetAt(id) + _windowOf(id)) return;

        address caller = byRecipient ? recipientOf[id] : depositorOf[id];
        vm.prank(caller);
        escrow.raiseDispute(id);
    }

    function releaseAfterWindow(uint256 seed, uint256 warpBy) external {
        (uint256 id, bool ok) = _pickId(seed);
        if (!ok) return;
        if (_stateOf(id) != CrossChainEscrow.EscrowState.CONDITION_MET) return;

        uint256 deadline = _conditionMetAt(id) + _windowOf(id);
        if (block.timestamp < deadline) {
            // advance bounded amount beyond the deadline
            warpBy = bound(warpBy, 0, 2 days);
            vm.warp(deadline + warpBy);
        }

        uint256 amt = _amountOf(id);
        escrow.releaseAfterWindow(id);
        g_totalReleased += amt;
    }

    function resolveDispute(uint256 seed, bool release) external {
        (uint256 id, bool ok) = _pickId(seed);
        if (!ok) return;
        if (_stateOf(id) != CrossChainEscrow.EscrowState.DISPUTED) return;

        uint256 amt = _amountOf(id);

        vm.prank(arbiter);
        escrow.resolveDispute(id, release);

        if (release) {
            g_totalReleased += amt;
        } else {
            g_totalRefundCredited += amt;
        }
    }

    function mutualCancel(uint256 seed, bool byRecipient) external {
        (uint256 id, bool ok) = _pickId(seed);
        if (!ok) return;
        if (_stateOf(id) != CrossChainEscrow.EscrowState.DEPOSITED) return;

        address caller = byRecipient ? recipientOf[id] : depositorOf[id];
        uint256 amt = _amountOf(id);

        vm.prank(caller);
        escrow.mutualCancel(id);

        // If that call flipped state to REFUNDED, it means both parties
        // approved, so the refund was credited.
        if (_stateOf(id) == CrossChainEscrow.EscrowState.REFUNDED) {
            g_totalRefundCredited += amt;
        }
    }

    function withdrawRefund(uint256 seed) external {
        address a = _pickActor(seed);
        uint256 bal = escrow.refundBalances(a);
        if (bal == 0) return;

        vm.prank(a);
        escrow.withdrawRefund();
        g_totalWithdrawn += bal;
    }

    // Time jumps give the fuzzer a way to cross dispute-window boundaries
    // without always having to call releaseAfterWindow.
    function jumpTime(uint256 secs) external {
        secs = bound(secs, 0, 3 days);
        vm.warp(block.timestamp + secs);
    }
}
