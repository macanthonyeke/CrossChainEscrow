// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITokenMessenger {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint256 minFinalityThreshold
    ) external returns (uint64 nonce);
}