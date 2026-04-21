// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {MockUSDC, MockTokenMessenger} from "./mocks/Mocks.sol";

contract CrossChainEscrowFuzzTest is Test {
    CrossChainEscrow escrow;
    MockUSDC usdc;
    MockTokenMessenger tm;

    address arbiter = address(0xA2B17);
    address pauser = address(0xBA5E);
    address depositor = address(0xD0);
    address recipient = address(0xE1);
    address refundTo = address(0xF2);

    uint32 constant DEST_DOMAIN = 2;
    bytes32 constant MINT_RECIPIENT = bytes32(uint256(0xCAFE));

    // realistic bounds: 1 <= amount <= 1B USDC (6 decimals)
    uint256 constant MAX_AMOUNT = 1_000_000_000 * 1e6;
    uint256 constant MIN_WINDOW = 1 hours;
    uint256 constant MAX_WINDOW = 30 days;

    function setUp() public {
        usdc = new MockUSDC();
        tm = new MockTokenMessenger();
        escrow = new CrossChainEscrow(address(usdc), arbiter, pauser, address(tm));

        // mint generously so no single fuzz call runs out
        usdc.mint(depositor, type(uint128).max);
        vm.prank(depositor);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _boundAmount(uint256 x) internal pure returns (uint256) {
        return bound(x, 1, MAX_AMOUNT);
    }

    function _boundWindow(uint256 x) internal pure returns (uint256) {
        return bound(x, MIN_WINDOW, MAX_WINDOW);
    }

    // ------------- fuzz deposit amounts -------------

    /// Deposit with a random amount stores the amount correctly and moves
    /// exactly that many USDC into the escrow.
    function testFuzz_DepositAmount(uint256 amount) public {
        amount = _boundAmount(amount);
        vm.prank(depositor);
        uint256 id = escrow.deposit(recipient, refundTo, amount, DEST_DOMAIN, MINT_RECIPIENT, 1 days);

        (, , , uint256 storedAmount, , , , , , , ) = escrow.escrows(id);
        assertEq(storedAmount, amount);
        assertEq(usdc.balanceOf(address(escrow)), amount);
    }

    // ------------- fuzz dispute window -------------

    /// A random dispute window must be enforced: releaseAfterWindow reverts
    /// before the deadline and succeeds after.
    function testFuzz_DisputeWindowEnforced(uint256 window) public {
        window = _boundWindow(window);
        vm.prank(depositor);
        uint256 id = escrow.deposit(recipient, refundTo, 1e6, DEST_DOMAIN, MINT_RECIPIENT, window);

        vm.prank(depositor);
        escrow.fulfillCondition(id);

        uint256 deadline = block.timestamp + window;

        // just before deadline — must revert
        vm.warp(deadline - 1);
        vm.expectRevert(CrossChainEscrow.DisputeWindowNotExpired.selector);
        escrow.releaseAfterWindow(id);

        // at deadline — release succeeds (window check is strict <)
        vm.warp(deadline);
        escrow.releaseAfterWindow(id);
    }

    // ------------- fuzz nonexistent IDs -------------

    /// Random IDs that were never created revert EscrowDoesNotExist.
    function testFuzz_NonexistentEscrowId(uint256 id) public {
        vm.assume(id != 0 && id > escrow.escrowCount());
        vm.expectRevert(CrossChainEscrow.EscrowDoesNotExist.selector);
        escrow.fulfillCondition(id);
    }

    // ------------- fuzz multiple escrows -------------

    /// Creating N escrows leaves each with independent state and amount.
    function testFuzz_MultipleEscrowsIndependent(uint8 count, uint256 seed) public {
        count = uint8(bound(count, 1, 20));

        uint256[] memory ids = new uint256[](count);
        uint256[] memory amounts = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 a = _boundAmount(uint256(keccak256(abi.encode(seed, i))));
            amounts[i] = a;
            vm.prank(depositor);
            ids[i] = escrow.deposit(recipient, refundTo, a, DEST_DOMAIN, MINT_RECIPIENT, 1 days);
        }

        // fulfill only odd-indexed escrows
        for (uint256 i = 0; i < count; i++) {
            if (i % 2 == 1) {
                vm.prank(depositor);
                escrow.fulfillCondition(ids[i]);
            }
        }

        for (uint256 i = 0; i < count; i++) {
            (, , , uint256 storedAmount, , , , , , , CrossChainEscrow.EscrowState s) =
                escrow.escrows(ids[i]);
            assertEq(storedAmount, amounts[i]);
            if (i % 2 == 1) {
                assertEq(uint256(s), uint256(CrossChainEscrow.EscrowState.CONDITION_MET));
            } else {
                assertEq(uint256(s), uint256(CrossChainEscrow.EscrowState.DEPOSITED));
            }
        }
    }

    // ------------- fuzz release timing -------------

    /// Release behaviour exactly at and around the boundary:
    ///   t <  deadline  -> revert DisputeWindowNotExpired
    ///   t >= deadline  -> succeed
    function testFuzz_ReleaseTimingBoundary(uint256 window, int8 offset) public {
        window = _boundWindow(window);
        vm.prank(depositor);
        uint256 id = escrow.deposit(recipient, refundTo, 1e6, DEST_DOMAIN, MINT_RECIPIENT, window);
        vm.prank(depositor);
        escrow.fulfillCondition(id);

        uint256 deadline = block.timestamp + window;
        int256 off = int256(bound(offset, -3, 3));
        uint256 target = off >= 0 ? deadline + uint256(off) : deadline - uint256(-off);
        vm.warp(target);

        if (target < deadline) {
            vm.expectRevert(CrossChainEscrow.DisputeWindowNotExpired.selector);
            escrow.releaseAfterWindow(id);
        } else {
            escrow.releaseAfterWindow(id);
            (, , , , , , , , , , CrossChainEscrow.EscrowState s) = escrow.escrows(id);
            assertEq(uint256(s), uint256(CrossChainEscrow.EscrowState.RELEASED));
        }
    }

    // ------------- fuzz refund balances -------------

    /// Multiple refund credits to the same refundTo accumulate in
    /// refundBalances; withdrawRefund drains the full cumulative balance.
    function testFuzz_RefundBalancesCumulative(uint8 n, uint256 seed) public {
        n = uint8(bound(n, 1, 10));

        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            uint256 amt = _boundAmount(uint256(keccak256(abi.encode(seed, i, "amt"))));
            total += amt;

            vm.prank(depositor);
            uint256 id = escrow.deposit(recipient, refundTo, amt, DEST_DOMAIN, MINT_RECIPIENT, 1 days);
            vm.prank(depositor);
            escrow.fulfillCondition(id);
            vm.prank(recipient);
            escrow.raiseDispute(id);
            vm.prank(arbiter);
            escrow.resolveDispute(id, false);
        }

        assertEq(escrow.refundBalances(refundTo), total);

        vm.prank(refundTo);
        escrow.withdrawRefund();
        assertEq(usdc.balanceOf(refundTo), total);
        assertEq(escrow.refundBalances(refundTo), 0);
    }

    // ------------- fuzz unauthorized callers -------------

    /// Random addresses that are not depositor/recipient/arbiter cannot
    /// call the role-gated or owner-gated functions.
    function testFuzz_UnauthorizedCallersRejected(address attacker) public {
        vm.assume(attacker != address(0));
        vm.assume(attacker != depositor && attacker != recipient && attacker != arbiter);
        vm.assume(attacker.code.length == 0);

        vm.prank(depositor);
        uint256 id = escrow.deposit(recipient, refundTo, 1e6, DEST_DOMAIN, MINT_RECIPIENT, 1 days);

        // fulfillCondition: only depositor
        vm.prank(attacker);
        vm.expectRevert(CrossChainEscrow.NotEscrowOwner.selector);
        escrow.fulfillCondition(id);

        // depositor transitions to CONDITION_MET so dispute/resolve paths become reachable
        vm.prank(depositor);
        escrow.fulfillCondition(id);

        // raiseDispute: only depositor or recipient
        vm.prank(attacker);
        vm.expectRevert(CrossChainEscrow.NotEscrowOwnerOrRecipient.selector);
        escrow.raiseDispute(id);

        // recipient raises, then attacker tries to resolve (needs ARBITER_ROLE)
        vm.prank(recipient);
        escrow.raiseDispute(id);

        vm.prank(attacker);
        vm.expectRevert();
        escrow.resolveDispute(id, true);
    }
}
