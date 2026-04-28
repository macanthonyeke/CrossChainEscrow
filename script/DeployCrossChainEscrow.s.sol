// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";

contract DeployCrossChainEscrow is Script {
    address constant USDC_ARC_TESTNET = 0x3600000000000000000000000000000000000000;
    address constant TOKEN_MESSENGER_ARC_TESTNET = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    function run() external returns (CrossChainEscrow escrow) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address pauser = vm.envOr("PAUSER_ADDRESS", vm.addr(deployerKey));

        require(arbiter != address(0), "ARBITER_ADDRESS not set");

        console2.log("Deployer:", vm.addr(deployerKey));
        console2.log("Arbiter: ", arbiter);
        console2.log("Pauser:  ", pauser);
        console2.log("USDC:    ", USDC_ARC_TESTNET);
        console2.log("Messenger:", TOKEN_MESSENGER_ARC_TESTNET);

        vm.startBroadcast(deployerKey);
        escrow = new CrossChainEscrow(
            USDC_ARC_TESTNET,
            arbiter,
            pauser,
            TOKEN_MESSENGER_ARC_TESTNET
        );
        vm.stopBroadcast();

        console2.log("CrossChainEscrow deployed at:", address(escrow));
    }
}
