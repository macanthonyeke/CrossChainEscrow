// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./Interface/ITokenMessenger.sol";

contract CrossChainEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum EscrowState {
        DEPOSITED,
        CONDITION_MET,
        DISPUTED,
        RELEASED,
        REFUNDED
    }

    struct Escrow {
        address depositor;
        address recipient;
        address refundTo;
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        uint256 conditionMetTimestamp;
        uint256 disputeWindow;
        bool depositorApproveCancel;
        bool recipientApproveCancel;
        EscrowState state;
    }

    IERC20 public usdc;

    uint256 public escrowCount;

    ITokenMessenger public tokenMessenger;

    mapping(uint256 => Escrow) public escrows;
    mapping(address => uint256) public refundBalances;

    event EscrowCreated(uint256 indexed escrowId, address depositor, address recipient, uint256 amount);
    event ConditionFulfilled(uint256 indexed escrowId, uint256 disputeDeadline);
    event DisputeRaised(uint256 indexed escrowId, address raisedBy);
    event EscrowReleased(uint256 indexed escrowId);
    event EscrowRefunded(uint256 indexed escrowId);
    event RefundWithdrawn(address indexed depositor, uint256 amount);

    error InvalidAmount();
    error ZeroAddress();
    error NoDeposit();
    error NotEscrowOwner();
    error NotEscrowOwnerOrRecipient();
    error InvalidState();
    error DisputeWindowExpired();
    error DisputeWindowNotExpired();
    error NoDispute();
    error EscrowDoesNotExist();
    error DisputeWindowTooShort();
    error NothingToWithdraw();

    constructor(address _usdc, address _arbiter, address _pauser, address _tokenMessenger) {
        usdc = IERC20(_usdc);
        tokenMessenger = ITokenMessenger(_tokenMessenger);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, _arbiter);
        _grantRole(PAUSER_ROLE, _pauser);
    }

    function _executeCCTPRelease(Escrow storage e) internal {
        usdc.safeIncreaseAllowance(address(tokenMessenger), e.amount);

        tokenMessenger.depositForBurn(
            e.amount,
            e.destinationDomain,
            e.mintRecipient,
            address(usdc)
        );
    }

    function deposit(
        address _recipient,
        address _refundTo,
        uint256 _amount,
        uint32 _destinationDomain,
        bytes32 _mintRecipient,
        uint256 _disputeWindow
    ) external whenNotPaused nonReentrant returns (uint256 escrowId) {
        if (_amount == 0) revert InvalidAmount();
        if (_recipient == address(0)) revert ZeroAddress();
        if (_refundTo == address(0)) revert ZeroAddress();
        if (_mintRecipient == bytes32(0)) revert ZeroAddress();
        if (_disputeWindow < 1 hours) revert DisputeWindowTooShort();

        usdc.safeTransferFrom(msg.sender, address(this), _amount);

        escrowId = ++escrowCount;

        escrows[escrowId] = Escrow({
            depositor: msg.sender,
            recipient: _recipient,
            refundTo: _refundTo,
            amount: _amount,
            destinationDomain: _destinationDomain,
            mintRecipient: _mintRecipient,
            conditionMetTimestamp: 0,
            disputeWindow: _disputeWindow,
            depositorApproveCancel: false,
            recipientApproveCancel: false,
            state: EscrowState.DEPOSITED
        });

        emit EscrowCreated(escrowId, msg.sender, _recipient, _amount);
    }

    function fulfillCondition(uint256 escrowId) external {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.DEPOSITED) revert NoDeposit();
        if (e.depositor != msg.sender) revert NotEscrowOwner();

        e.conditionMetTimestamp = block.timestamp;

        e.state = EscrowState.CONDITION_MET;

        emit ConditionFulfilled(escrowId, block.timestamp + e.disputeWindow);
    }

    function raiseDispute (uint256 escrowId) external {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.depositor != msg.sender && e.recipient != msg.sender) revert NotEscrowOwnerOrRecipient();
        if (e.state != EscrowState.CONDITION_MET) revert InvalidState(); 

        if (block.timestamp > e.conditionMetTimestamp + e.disputeWindow) revert DisputeWindowExpired();

        e.state = EscrowState.DISPUTED;

        emit DisputeRaised(escrowId, msg.sender);
    }

    function releaseAfterWindow(uint256 escrowId) external whenNotPaused nonReentrant {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.CONDITION_MET) revert InvalidState();

        if (block.timestamp < e.conditionMetTimestamp + e.disputeWindow) revert DisputeWindowNotExpired();

        _executeCCTPRelease(e);

        e.state = EscrowState.RELEASED;

        emit EscrowReleased(escrowId);
    }

    function resolveDispute(uint256 escrowId, bool releaseToRecipient) external onlyRole(ARBITER_ROLE) {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.DISPUTED) revert NoDispute();

        uint256 amount = e.amount;

        if (releaseToRecipient) {
            _executeCCTPRelease(e);

            e.state = EscrowState.RELEASED;
            
            emit EscrowReleased(escrowId);
        } else {
            e.state = EscrowState.REFUNDED;
            refundBalances[e.refundTo] += amount;

            emit EscrowRefunded(escrowId);
        }
    }

    function mutualCancel(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];

        if (e.depositor == address(0)) revert EscrowDoesNotExist();
        if (e.state != EscrowState.DEPOSITED) revert NoDeposit();
        if (e.depositor != msg.sender && e.recipient != msg.sender) revert NotEscrowOwnerOrRecipient();

        uint256 amount = e.amount;

        if (e.depositor == msg.sender) {
            e.depositorApproveCancel = true;
        } else {
            e.recipientApproveCancel = true;
        }

        if (e.depositorApproveCancel && e.recipientApproveCancel) {
            e.state = EscrowState.REFUNDED;

            refundBalances[e.refundTo] += amount;

            emit EscrowRefunded(escrowId);
        }
    }

    function withdrawRefund() external nonReentrant {
        uint256 amount = refundBalances[msg.sender];

        if (amount == 0) revert NothingToWithdraw();

        refundBalances[msg.sender] = 0;

        usdc.safeTransfer(msg.sender, amount);

        emit RefundWithdrawn(msg.sender, amount);
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
