// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../src/Interface/ITokenMessenger.sol";

// Simple mintable USDC mock with 6 decimals.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Mock TokenMessenger that mimics Circle CCTP burn behaviour by pulling
// tokens out of the caller via transferFrom. This keeps the escrow
// contract's USDC balance accurate so solvency invariants hold.
contract MockTokenMessenger is ITokenMessenger {
    uint64 public nonceCounter;

    struct Call {
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        address caller;
    }

    Call[] public calls;
    uint256 public totalBurned;

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external override returns (uint64 nonce) {
        // pull tokens out of caller, mimicking CCTP burn
        ERC20(burnToken).transferFrom(msg.sender, address(this), amount);
        totalBurned += amount;
        calls.push(Call({
            amount: amount,
            destinationDomain: destinationDomain,
            mintRecipient: mintRecipient,
            burnToken: burnToken,
            caller: msg.sender
        }));
        nonce = ++nonceCounter;
    }

    function callsLength() external view returns (uint256) {
        return calls.length;
    }
}

// Recipient contract that reverts on USDC receipt path. Not actually
// receiving USDC directly (CCTP burns in the contract), but we use this
// for pull-pattern refund adversarial scenarios.
contract RevertingReceiver {
    fallback() external payable {
        revert("no receive");
    }

    receive() external payable {
        revert("no receive");
    }
}
