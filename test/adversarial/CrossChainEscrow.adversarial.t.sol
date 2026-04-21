// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CrossChainEscrow} from "../../src/CrossChainEscrow.sol";
import {MockUSDC, MockTokenMessenger} from "../mocks/Mocks.sol";

// ---------------------------------------------------------------------------
// Attacker contracts
// ---------------------------------------------------------------------------

/// Recipient contract whose fallback reverts. Used to prove the pull-based
/// refund still works even if the refundTo address is a hostile contract
/// that rejects pushes.
contract RejectingRefundTo {
    fallback() external payable { revert("nope"); }
    receive() external payable { revert("nope"); }
}

/// Attacker that attempts to re-enter withdrawRefund during an ERC20 hook.
/// MockUSDC is a plain OpenZeppelin ERC20 with no callbacks, so reentry is
/// impossible via transfer — the attacker has to hope the nonReentrant guard
/// can be bypassed. This contract calls withdrawRefund a second time from
/// inside its own fallback (never actually triggered by MockUSDC, but kept
/// so we can prove a second withdraw fails either way).
contract ReentrantAttacker {
    CrossChainEscrow public escrow;
    bool public reenterTried;

    constructor(CrossChainEscrow _e) {
        escrow = _e;
    }

    function attack() external {
        escrow.withdrawRefund();
    }

    receive() external payable {
        if (!reenterTried) {
            reenterTried = true;
            escrow.withdrawRefund();
        }
    }

    fallback() external payable {
        if (!reenterTried) {
            reenterTried = true;
            escrow.withdrawRefund();
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

contract CrossChainEscrowAdversarialTest is Test {
    CrossChainEscrow escrow;
    MockUSDC usdc;
    MockTokenMessenger tm;

    address arbiter = address(0xA2B17);
    address pauser = address(0xBA5E);
    address depositor = address(0xD0);
    address recipient = address(0xE1);
    address refundTo = address(0xF2);
    address outsider = address(0xBAD);

    uint32 constant DEST_DOMAIN = 2;
    bytes32 constant MINT_RECIPIENT = bytes32(uint256(0xCAFE));
    uint256 constant AMOUNT = 1_000 * 1e6;
    uint256 constant DISPUTE_WINDOW = 1 days;

    function setUp() public {
        usdc = new MockUSDC();
        tm = new MockTokenMessenger();
        escrow = new CrossChainEscrow(address(usdc), arbiter, pauser, address(tm));

        usdc.mint(depositor, 1_000_000 * 1e6);
        vm.prank(depositor);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _newEscrow(address _refund) internal returns (uint256 id) {
        vm.prank(depositor);
        id = escrow.deposit(recipient, _refund, AMOUNT, DEST_DOMAIN, MINT_RECIPIENT, DISPUTE_WINDOW);
    }

    // -----------------------------------------------------------------------
    // 1. Malicious recipient / refundTo — pull pattern still works
    // -----------------------------------------------------------------------

    /// Even when refundTo is a contract that reverts on every receive,
    /// the refund still gets credited. withdrawRefund uses ERC20 transfer,
    /// which doesn't invoke the fallback, so the pull pattern bypasses the
    /// hostile receiver entirely.
    function test_MaliciousRefundTo_PullRefundWorks() public {
        RejectingRefundTo bad = new RejectingRefundTo();
        uint256 id = _newEscrow(address(bad));

        vm.prank(depositor);
        escrow.fulfillCondition(id);
        vm.prank(recipient);
        escrow.raiseDispute(id);
        vm.prank(arbiter);
        escrow.resolveDispute(id, false);

        assertEq(escrow.refundBalances(address(bad)), AMOUNT);

        vm.prank(address(bad));
        escrow.withdrawRefund();
        assertEq(usdc.balanceOf(address(bad)), AMOUNT);
    }

    // -----------------------------------------------------------------------
    // 2. Reentrancy attempt on withdrawRefund
    // -----------------------------------------------------------------------

    /// An attacker contract with a reentrant fallback cannot double-withdraw:
    /// refundBalances is zeroed before the transfer, and ReentrancyGuard
    /// would block a recursive call anyway. We verify the first withdraw
    /// succeeds exactly once and the second attempt reverts.
    function test_ReentrancyAttacker_CannotDrain() public {
        ReentrantAttacker atk = new ReentrantAttacker(escrow);
        uint256 id = _newEscrow(address(atk));

        vm.prank(depositor);
        escrow.fulfillCondition(id);
        vm.prank(recipient);
        escrow.raiseDispute(id);
        vm.prank(arbiter);
        escrow.resolveDispute(id, false);

        // attacker withdraws — transfer via ERC20 (no receive hook), so the
        // reentrancy path is never triggered. The pull pattern is already
        // safe by construction.
        atk.attack();

        assertEq(usdc.balanceOf(address(atk)), AMOUNT);
        assertEq(escrow.refundBalances(address(atk)), 0);

        // a second withdrawRefund call must revert with NothingToWithdraw
        vm.expectRevert(CrossChainEscrow.NothingToWithdraw.selector);
        atk.attack();
    }

    // -----------------------------------------------------------------------
    // 3. Griefing: dispute right before expiry
    // -----------------------------------------------------------------------

    /// Adversary calls raiseDispute at the last possible moment of the
    /// dispute window (exactly at the deadline). That should succeed, per
    /// the `<=` check in the contract. Beyond the deadline it reverts.
    function test_Griefing_DisputeAtWindowBoundary() public {
        uint256 id = _newEscrow(refundTo);
        vm.prank(depositor);
        escrow.fulfillCondition(id);

        uint256 deadline = block.timestamp + DISPUTE_WINDOW;

        // exactly at deadline: recipient raises dispute to block release
        vm.warp(deadline);
        vm.prank(recipient);
        escrow.raiseDispute(id);

        (, , , , , , , , , , CrossChainEscrow.EscrowState s) = escrow.escrows(id);
        assertEq(uint256(s), uint256(CrossChainEscrow.EscrowState.DISPUTED));

        // one second past: can't raise dispute any more (new escrow)
        uint256 id2 = _newEscrow(refundTo);
        vm.prank(depositor);
        escrow.fulfillCondition(id2);
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(recipient);
        vm.expectRevert(CrossChainEscrow.DisputeWindowExpired.selector);
        escrow.raiseDispute(id2);
    }

    // -----------------------------------------------------------------------
    // 4. State confusion — actions on wrong escrow IDs
    // -----------------------------------------------------------------------

    /// Creating many escrows and trying to act on IDs in the wrong state
    /// must revert with the appropriate errors; state isn't shared across
    /// IDs.
    function test_StateConfusion_WrongIds() public {
        uint256 a = _newEscrow(refundTo); // DEPOSITED
        uint256 b = _newEscrow(refundTo);
        vm.prank(depositor);
        escrow.fulfillCondition(b);       // b is CONDITION_MET
        uint256 c = _newEscrow(refundTo);
        vm.prank(depositor);
        escrow.fulfillCondition(c);
        vm.prank(depositor);
        escrow.raiseDispute(c);           // c is DISPUTED

        // trying to releaseAfterWindow a DEPOSITED escrow -> InvalidState
        vm.expectRevert(CrossChainEscrow.InvalidState.selector);
        escrow.releaseAfterWindow(a);

        // trying to raiseDispute on DEPOSITED -> InvalidState
        vm.prank(depositor);
        vm.expectRevert(CrossChainEscrow.InvalidState.selector);
        escrow.raiseDispute(a);

        // resolveDispute on CONDITION_MET (not DISPUTED) -> NoDispute
        vm.prank(arbiter);
        vm.expectRevert(CrossChainEscrow.NoDispute.selector);
        escrow.resolveDispute(b, true);

        // fulfillCondition on DISPUTED -> NoDeposit
        vm.prank(depositor);
        vm.expectRevert(CrossChainEscrow.NoDeposit.selector);
        escrow.fulfillCondition(c);
    }

    // -----------------------------------------------------------------------
    // 5. Privilege escalation
    // -----------------------------------------------------------------------

    /// Non-arbiter cannot resolveDispute; non-depositor cannot fulfillCondition.
    function test_PrivilegeEscalation() public {
        uint256 id = _newEscrow(refundTo);

        // outsider cannot fulfill
        vm.prank(outsider);
        vm.expectRevert(CrossChainEscrow.NotEscrowOwner.selector);
        escrow.fulfillCondition(id);

        vm.prank(depositor);
        escrow.fulfillCondition(id);
        vm.prank(recipient);
        escrow.raiseDispute(id);

        // outsider cannot resolve (AccessControl revert)
        vm.prank(outsider);
        vm.expectRevert();
        escrow.resolveDispute(id, true);
    }

    // -----------------------------------------------------------------------
    // 6. Arbiter collusion — resolving without a dispute
    // -----------------------------------------------------------------------

    /// Even an arbiter can't resolve an escrow that isn't in DISPUTED state.
    /// Protects against arbiter "pre-resolving" a brand new deposit or
    /// stealing from CONDITION_MET escrows that haven't been challenged.
    function test_ArbiterCannotResolveUndisputed() public {
        uint256 id = _newEscrow(refundTo);

        // DEPOSITED
        vm.prank(arbiter);
        vm.expectRevert(CrossChainEscrow.NoDispute.selector);
        escrow.resolveDispute(id, true);

        // CONDITION_MET
        vm.prank(depositor);
        escrow.fulfillCondition(id);
        vm.prank(arbiter);
        vm.expectRevert(CrossChainEscrow.NoDispute.selector);
        escrow.resolveDispute(id, true);
    }

    // -----------------------------------------------------------------------
    // 7. Double withdrawal
    // -----------------------------------------------------------------------

    /// Two calls to withdrawRefund from the same address cannot withdraw
    /// more than the credited balance. The second call reverts with
    /// NothingToWithdraw.
    function test_DoubleWithdrawReverts() public {
        uint256 id = _newEscrow(refundTo);
        vm.prank(depositor);
        escrow.fulfillCondition(id);
        vm.prank(recipient);
        escrow.raiseDispute(id);
        vm.prank(arbiter);
        escrow.resolveDispute(id, false);

        vm.prank(refundTo);
        escrow.withdrawRefund();

        vm.prank(refundTo);
        vm.expectRevert(CrossChainEscrow.NothingToWithdraw.selector);
        escrow.withdrawRefund();

        // and no extra USDC was drained
        assertEq(usdc.balanceOf(refundTo), AMOUNT);
    }
}
