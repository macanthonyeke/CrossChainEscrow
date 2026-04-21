// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import {CrossChainEscrow} from "../../src/CrossChainEscrow.sol";
import {MockUSDC, MockTokenMessenger} from "../mocks/Mocks.sol";
import {Handler} from "./Handler.sol";

contract CrossChainEscrowInvariantTest is StdInvariant, Test {
    CrossChainEscrow escrow;
    MockUSDC usdc;
    MockTokenMessenger tm;
    Handler handler;

    address arbiter = address(0xA2B17);
    address pauser = address(0xBA5E);

    uint256 public prevEscrowCount;

    function setUp() public {
        usdc = new MockUSDC();
        tm = new MockTokenMessenger();
        escrow = new CrossChainEscrow(address(usdc), arbiter, pauser, address(tm));

        handler = new Handler(escrow, usdc, tm, arbiter);

        // Only allow the fuzzer to call the handler (not the escrow or USDC
        // directly), and only the action functions.
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.fulfillCondition.selector;
        selectors[2] = Handler.raiseDispute.selector;
        selectors[3] = Handler.releaseAfterWindow.selector;
        selectors[4] = Handler.resolveDispute.selector;
        selectors[5] = Handler.mutualCancel.selector;
        selectors[6] = Handler.withdrawRefund.selector;
        selectors[7] = Handler.jumpTime.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// Solvency: escrow USDC balance must equal deposited minus released
    /// via CCTP minus withdrawn via pull refunds.
    function invariant_Solvency() public view {
        uint256 expected =
            handler.g_totalDeposited() - handler.g_totalReleased() - handler.g_totalWithdrawn();
        assertEq(usdc.balanceOf(address(escrow)), expected, "solvency mismatch");
    }

    /// State machine: walk every escrow and check that its per-state
    /// invariants hold (CONDITION_MET/DISPUTED/RELEASED require a non-zero
    /// conditionMetTimestamp; RELEASED/REFUNDED are terminal so cannot
    /// re-enter active states).
    function invariant_StateMachine() public view {
        uint256 n = handler.allIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.allIds(i);
            (, , , uint256 amount, , , uint256 cmt, , , , CrossChainEscrow.EscrowState s) =
                escrow.escrows(id);

            assertGt(amount, 0, "zero amount recorded");

            if (s == CrossChainEscrow.EscrowState.DEPOSITED) {
                assertEq(cmt, 0, "DEPOSITED must have zero conditionMetTimestamp");
            } else if (
                s == CrossChainEscrow.EscrowState.CONDITION_MET ||
                s == CrossChainEscrow.EscrowState.DISPUTED ||
                s == CrossChainEscrow.EscrowState.RELEASED
            ) {
                assertGt(cmt, 0, "state requires conditionMetTimestamp > 0");
            }
            // REFUNDED is reachable from both mutualCancel (no cmt) and
            // resolveDispute(false) (has cmt), so no timestamp constraint.
        }
    }

    /// Double-spend: once an escrow is RELEASED or REFUNDED, it can never
    /// transition back. We enforce this by tracking terminal states across
    /// calls — a snapshot taken after each fuzz call and compared to a
    /// running mask of ever-terminal IDs.
    mapping(uint256 => bool) private _seenTerminal;

    function invariant_NoDoubleSpend() public {
        uint256 n = handler.allIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.allIds(i);
            (, , , , , , , , , , CrossChainEscrow.EscrowState s) = escrow.escrows(id);
            bool terminalNow =
                s == CrossChainEscrow.EscrowState.RELEASED ||
                s == CrossChainEscrow.EscrowState.REFUNDED;

            if (_seenTerminal[id]) {
                assertTrue(terminalNow, "escrow left terminal state");
            }
            if (terminalNow) {
                _seenTerminal[id] = true;
            }
        }
    }

    /// Refund balance integrity: the sum of refundBalances for all known
    /// actors must never exceed the contract's USDC balance (refunds are
    /// credited before being withdrawn, so they are always backed).
    function invariant_RefundBalancesBacked() public view {
        uint256 sum;
        uint256 n = handler.actorsLength();
        for (uint256 i = 0; i < n; i++) {
            sum += escrow.refundBalances(handler.actors(i));
        }
        assertLe(sum, usdc.balanceOf(address(escrow)), "refund balances exceed held USDC");
    }

    /// escrowCount must match total escrows ever created, and must never
    /// decrease between invariant checks.
    function invariant_EscrowCountMonotonic() public {
        uint256 cur = escrow.escrowCount();
        assertEq(cur, handler.g_everCreated(), "escrowCount != ever-created ghost");
        assertGe(cur, prevEscrowCount, "escrowCount decreased");
        prevEscrowCount = cur;
    }
}
