// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {MockUSDC, MockTokenMessenger} from "./mocks/Mocks.sol";

contract CrossChainEscrowTest is Test {
    CrossChainEscrow escrow;
    MockUSDC usdc;
    MockTokenMessenger tm;

    address admin = address(0xA11CE);
    address arbiter = address(0xA2B17);
    address pauser = address(0xBA5E);
    address depositor = address(0xD0);
    address recipient = address(0xE1);
    address refundTo = address(0xF2);
    address outsider = address(0x0151DE5);

    uint32 constant DEST_DOMAIN = 2;
    bytes32 constant MINT_RECIPIENT = bytes32(uint256(0xCAFE));
    uint256 constant AMOUNT = 1_000 * 1e6; // 1,000 USDC
    uint256 constant DISPUTE_WINDOW = 1 days;

    function setUp() public {
        usdc = new MockUSDC();
        tm = new MockTokenMessenger();

        vm.prank(admin);
        escrow = new CrossChainEscrow(address(usdc), arbiter, pauser, address(tm));

        // fund depositor
        usdc.mint(depositor, 1_000_000 * 1e6);
        vm.prank(depositor);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ------------- helpers -------------

    function _deposit() internal returns (uint256 escrowId) {
        vm.prank(depositor);
        escrowId = escrow.deposit(
            recipient,
            refundTo,
            AMOUNT,
            DEST_DOMAIN,
            MINT_RECIPIENT,
            DISPUTE_WINDOW
        );
    }

    function _fundedAndFulfilled() internal returns (uint256 escrowId) {
        escrowId = _deposit();
        vm.prank(depositor);
        escrow.fulfillCondition(escrowId);
    }

    // ------------- happy path -------------

    /// Deposit -> fulfillCondition -> releaseAfterWindow transfers USDC
    /// out via CCTP mock and sets state to RELEASED.
    function test_HappyPath_DepositFulfillRelease() public {
        uint256 escrowId = _fundedAndFulfilled();

        // fast-forward past the dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        uint256 balBefore = usdc.balanceOf(address(escrow));
        assertEq(balBefore, AMOUNT);

        escrow.releaseAfterWindow(escrowId);

        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(address(tm)), AMOUNT);
        assertEq(tm.callsLength(), 1);

        (, , , , , , , , , , CrossChainEscrow.EscrowState state) =
            escrow.escrows(escrowId);
        assertEq(uint256(state), uint256(CrossChainEscrow.EscrowState.RELEASED));
    }

    // ------------- dispute: arbiter releases -------------

    /// Dispute raised, arbiter chooses release -> CCTP burn happens,
    /// state RELEASED.
    function test_Dispute_ArbiterReleasesCrossChain() public {
        uint256 escrowId = _fundedAndFulfilled();

        vm.prank(depositor);
        escrow.raiseDispute(escrowId);

        vm.prank(arbiter);
        escrow.resolveDispute(escrowId, true);

        assertEq(usdc.balanceOf(address(tm)), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        (, , , , , , , , , , CrossChainEscrow.EscrowState state) =
            escrow.escrows(escrowId);
        assertEq(uint256(state), uint256(CrossChainEscrow.EscrowState.RELEASED));
    }

    // ------------- dispute: arbiter refunds -------------

    /// Dispute raised, arbiter refunds -> refundBalances credits refundTo,
    /// refundTo withdraws with withdrawRefund.
    function test_Dispute_ArbiterRefunds_ThenWithdraw() public {
        uint256 escrowId = _fundedAndFulfilled();

        vm.prank(recipient);
        escrow.raiseDispute(escrowId);

        vm.prank(arbiter);
        escrow.resolveDispute(escrowId, false);

        assertEq(escrow.refundBalances(refundTo), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "funds stay in escrow until pull");

        vm.prank(refundTo);
        escrow.withdrawRefund();

        assertEq(usdc.balanceOf(refundTo), AMOUNT);
        assertEq(escrow.refundBalances(refundTo), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ------------- mutual cancel -------------

    /// Both parties call mutualCancel. After the second call, state is
    /// REFUNDED and the refund is credited.
    function test_MutualCancel_BothParties() public {
        uint256 escrowId = _deposit();

        vm.prank(depositor);
        escrow.mutualCancel(escrowId);

        // after only depositor approves, state still DEPOSITED
        (, , , , , , , , bool dAp, bool rAp, CrossChainEscrow.EscrowState stateMid) =
            escrow.escrows(escrowId);
        assertTrue(dAp);
        assertFalse(rAp);
        assertEq(uint256(stateMid), uint256(CrossChainEscrow.EscrowState.DEPOSITED));

        vm.prank(recipient);
        escrow.mutualCancel(escrowId);

        assertEq(escrow.refundBalances(refundTo), AMOUNT);
        (, , , , , , , , , , CrossChainEscrow.EscrowState state) =
            escrow.escrows(escrowId);
        assertEq(uint256(state), uint256(CrossChainEscrow.EscrowState.REFUNDED));
    }

    // ------------- revert conditions -------------

    /// fulfillCondition must only be callable by depositor.
    function test_Revert_FulfillByNonDepositor() public {
        uint256 escrowId = _deposit();
        vm.prank(outsider);
        vm.expectRevert(CrossChainEscrow.NotEscrowOwner.selector);
        escrow.fulfillCondition(escrowId);
    }

    /// fulfillCondition must fail when escrow is no longer in DEPOSITED.
    function test_Revert_FulfillWrongState() public {
        uint256 escrowId = _fundedAndFulfilled();
        vm.prank(depositor);
        vm.expectRevert(CrossChainEscrow.NoDeposit.selector);
        escrow.fulfillCondition(escrowId);
    }

    /// raiseDispute must fail after dispute window expired.
    function test_Revert_RaiseDisputeExpired() public {
        uint256 escrowId = _fundedAndFulfilled();
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);
        vm.prank(depositor);
        vm.expectRevert(CrossChainEscrow.DisputeWindowExpired.selector);
        escrow.raiseDispute(escrowId);
    }

    /// releaseAfterWindow must fail while window hasn't expired.
    function test_Revert_ReleaseBeforeWindow() public {
        uint256 escrowId = _fundedAndFulfilled();
        vm.expectRevert(CrossChainEscrow.DisputeWindowNotExpired.selector);
        escrow.releaseAfterWindow(escrowId);
    }

    /// escrow ID 0 should never exist.
    function test_Revert_EscrowIdZero() public {
        vm.expectRevert(CrossChainEscrow.EscrowDoesNotExist.selector);
        escrow.fulfillCondition(0);
    }

    /// Nonexistent escrow IDs revert EscrowDoesNotExist.
    function test_Revert_NonexistentEscrow() public {
        vm.expectRevert(CrossChainEscrow.EscrowDoesNotExist.selector);
        escrow.releaseAfterWindow(999);
    }

    /// raiseDispute from unauthorized caller reverts.
    function test_Revert_RaiseDisputeByOutsider() public {
        uint256 escrowId = _fundedAndFulfilled();
        vm.prank(outsider);
        vm.expectRevert(CrossChainEscrow.NotEscrowOwnerOrRecipient.selector);
        escrow.raiseDispute(escrowId);
    }

    /// resolveDispute requires ARBITER_ROLE.
    function test_Revert_ResolveByNonArbiter() public {
        uint256 escrowId = _fundedAndFulfilled();
        vm.prank(depositor);
        escrow.raiseDispute(escrowId);

        // AccessControl reverts with its own error; we just expect a revert.
        vm.prank(outsider);
        vm.expectRevert();
        escrow.resolveDispute(escrowId, true);
    }

    /// resolveDispute must be in DISPUTED state.
    function test_Revert_ResolveWithoutDispute() public {
        uint256 escrowId = _fundedAndFulfilled();
        vm.prank(arbiter);
        vm.expectRevert(CrossChainEscrow.NoDispute.selector);
        escrow.resolveDispute(escrowId, true);
    }

    /// deposit with 0 amount reverts.
    function test_Revert_DepositZeroAmount() public {
        vm.prank(depositor);
        vm.expectRevert(CrossChainEscrow.InvalidAmount.selector);
        escrow.deposit(recipient, refundTo, 0, DEST_DOMAIN, MINT_RECIPIENT, DISPUTE_WINDOW);
    }

    /// deposit with too-short dispute window reverts.
    function test_Revert_DisputeWindowTooShort() public {
        vm.prank(depositor);
        vm.expectRevert(CrossChainEscrow.DisputeWindowTooShort.selector);
        escrow.deposit(recipient, refundTo, AMOUNT, DEST_DOMAIN, MINT_RECIPIENT, 1 hours - 1);
    }

    /// deposit with zero addresses reverts.
    function test_Revert_ZeroAddressArgs() public {
        vm.startPrank(depositor);
        vm.expectRevert(CrossChainEscrow.ZeroAddress.selector);
        escrow.deposit(address(0), refundTo, AMOUNT, DEST_DOMAIN, MINT_RECIPIENT, DISPUTE_WINDOW);
        vm.expectRevert(CrossChainEscrow.ZeroAddress.selector);
        escrow.deposit(recipient, address(0), AMOUNT, DEST_DOMAIN, MINT_RECIPIENT, DISPUTE_WINDOW);
        vm.expectRevert(CrossChainEscrow.ZeroAddress.selector);
        escrow.deposit(recipient, refundTo, AMOUNT, DEST_DOMAIN, bytes32(0), DISPUTE_WINDOW);
        vm.stopPrank();
    }

    // ------------- pause -------------

    /// Pause blocks deposit and releaseAfterWindow. (fulfillCondition,
    /// raiseDispute, resolveDispute, mutualCancel, withdrawRefund are NOT
    /// pausable in this contract — only the USDC-moving paths are.)
    function test_Pause_BlocksCriticalFunctions() public {
        vm.prank(pauser);
        escrow.pause();

        vm.prank(depositor);
        vm.expectRevert();
        escrow.deposit(recipient, refundTo, AMOUNT, DEST_DOMAIN, MINT_RECIPIENT, DISPUTE_WINDOW);

        // unpause and run a full lifecycle, then pause and try release
        vm.prank(pauser);
        escrow.unpause();
        uint256 escrowId = _fundedAndFulfilled();

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(pauser);
        escrow.pause();

        vm.expectRevert();
        escrow.releaseAfterWindow(escrowId);
    }

    // ------------- pull-based refund -------------

    /// withdrawRefund reverts when caller has no pending refund balance.
    function test_Revert_WithdrawRefundNothing() public {
        vm.prank(outsider);
        vm.expectRevert(CrossChainEscrow.NothingToWithdraw.selector);
        escrow.withdrawRefund();
    }
}
