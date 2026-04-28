# CrossChainEscrow

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-%5E0.8.20-363636.svg)](https://docs.soliditylang.org/)
[![Foundry](https://img.shields.io/badge/Built%20with-Foundry-000000.svg)](https://getfoundry.sh/)
[![Network: Arc Testnet](https://img.shields.io/badge/Network-Arc%20Testnet-blue.svg)](https://testnet.arcscan.app)

A trust-minimized USDC escrow on Arc that releases funds cross-chain to any EVM network via Circle's Cross-Chain Transfer Protocol (CCTP v2).

**Built with:** Solidity `^0.8.20`, Foundry, OpenZeppelin Contracts, Circle CCTP v2 — deployed on Arc Testnet.

---

## Overview

### The problem

Buyer/seller, client/freelancer, and DAO/vendor payments rarely live on the same chain. The money sits on one network, and the work (or the recipient's wallet) lives on another. Off-chain escrow agents add fees, latency, and trust. Naive on-chain escrows handle neither cross-chain delivery nor contested outcomes.

### What CrossChainEscrow does

`CrossChainEscrow` lets a **depositor** lock USDC on Arc and commit to releasing it to a **recipient** on any CCTP-supported EVM chain. Conditions are checked on-chain, a time-boxed dispute window protects both sides, and release flows directly into Circle's burn-and-mint pipeline — no bridge custodian, no third-party relayer holding funds.

### How it works (high level)

1. Depositor approves USDC and calls `deposit(...)` on Arc, specifying the recipient's destination domain and 32-byte mint recipient.
2. When the deliverable is ready, depositor calls `fulfillCondition(...)`. This starts a **dispute window**.
3. During the window, either party may `raiseDispute(...)`.
4. If no dispute → **anyone** calls `releaseAfterWindow(...)` after the window expires. USDC is burned on Arc and minted to the recipient on the destination chain via CCTP.
5. If a dispute is raised → the **arbiter** calls `resolveDispute(...)` to either release cross-chain or credit a refund balance the depositor can withdraw.

### The hybrid dispute model

Escrows usually pick one of two extremes: fully trustless (just a timelock) or fully arbitrated (a trusted third party signs every release). Both are bad defaults.

CrossChainEscrow does both, in sequence:

- **Happy path is trustless.** If the depositor marks the condition met and nobody disputes within the window, the release is permissionless — literally anyone can trigger it. The arbiter never touches it.
- **Contested path is arbitrated, but only when invoked.** Raising a dispute pulls the escrow into `DISPUTED` state, which only the arbiter can resolve. The arbiter's power is scoped to that state — they cannot unilaterally seize funds from a non-disputed escrow.

The dispute window (minimum 1 hour, caller-specified at deposit time) is the knob that balances speed vs. safety.

### Why Arc

- **USDC-native gas.** Predictable deployment and execution costs denominated in the same asset the escrow holds.
- **Deterministic sub-second finality.** Lets callers use shorter dispute windows without racing reorgs.
- **Native CCTP integration.** Arc is wired into Circle's TokenMessenger directly, so release is a single on-chain call — no wrapped assets, no external bridge.

---

## Architecture

### Escrow lifecycle

Every escrow moves through one of five states. Terminal states (`RELEASED`, `REFUNDED`) are permanent.

```
                      deposit()
                          │
                          ▼
                   ┌──────────────┐
                   │  DEPOSITED   │──── mutualCancel() (both parties) ──┐
                   └──────┬───────┘                                     │
                          │                                             │
                fulfillCondition() (depositor)                          │
                          │                                             │
                          ▼                                             │
                   ┌───────────────┐                                    │
                   │ CONDITION_MET │                                    │
                   └───┬──────┬────┘                                    │
                       │      │                                         │
    raiseDispute()     │      │   releaseAfterWindow()                  │
    (either party)     │      │   (anyone, after window)                │
                       ▼      ▼                                         │
              ┌──────────┐  ┌──────────┐                                │
              │ DISPUTED │  │ RELEASED │ ◀── CCTP burn/mint             │
              └─────┬────┘  └──────────┘                                │
                    │                                                   │
          resolveDispute(arbiter)                                       │
                    │                                                   │
           ┌────────┴─────────┐                                         │
           ▼                  ▼                                         ▼
      ┌──────────┐       ┌──────────┐                             ┌──────────┐
      │ RELEASED │       │ REFUNDED │ ◀──────────────────────────▶│ REFUNDED │
      └──────────┘       └────┬─────┘                             └────┬─────┘
                              │                                        │
                              └──────── withdrawRefund() ◀──────────────┘
```

### Functions

| Function | Caller | Purpose |
|---|---|---|
| `deposit(recipient, refundTo, amount, destinationDomain, mintRecipient, disputeWindow)` | Depositor | Pulls USDC, creates escrow in `DEPOSITED`. |
| `fulfillCondition(escrowId)` | Depositor | Marks condition met, starts dispute window, moves to `CONDITION_MET`. |
| `raiseDispute(escrowId)` | Depositor or recipient | Freezes the escrow in `DISPUTED` during the window. |
| `releaseAfterWindow(escrowId)` | **Anyone** | After window expires with no dispute, burns USDC via CCTP and moves to `RELEASED`. |
| `resolveDispute(escrowId, releaseToRecipient)` | Arbiter (`ARBITER_ROLE`) | Resolves a `DISPUTED` escrow: release cross-chain, or credit `refundBalances[refundTo]`. |
| `mutualCancel(escrowId)` | Depositor or recipient | Each side signals approval; when both have, the escrow refunds. |
| `withdrawRefund()` | Holder of a refund balance | Pulls accumulated refund credits out as USDC. |
| `pause()` / `unpause()` | Pauser (`PAUSER_ROLE`) | Emergency stop for `deposit` and `releaseAfterWindow`. |

### Pull-based refunds

Refunds never `transfer` USDC inside `resolveDispute` or `mutualCancel`. Instead, the amount is credited to `refundBalances[refundTo]`, and the `refundTo` address claims it by calling `withdrawRefund()`.

Why:

- A revert in the refund transfer (blocklisted address, reentrant token hook, contract with no receiver) would otherwise brick dispute resolution and cancellation.
- The arbiter's transaction stays cheap and deterministic — it only updates state.
- The recipient of the refund controls when they collect. Checks-effects-interactions is enforced naturally.

### CCTP integration

Release on the happy path and the arbiter-favors-recipient path both flow through `_executeCCTPRelease`:

```solidity
function _executeCCTPRelease(Escrow storage e) internal {
    usdc.safeIncreaseAllowance(address(tokenMessenger), e.amount);
    tokenMessenger.depositForBurn(
        e.amount,
        e.destinationDomain,
        e.mintRecipient,
        address(usdc)
    );
}
```

`depositForBurn` burns the USDC on Arc and emits a Circle attestation. The standard CCTP flow off-chain fetches the attestation and calls `receiveMessage` on the destination chain's MessageTransmitter, which mints native USDC to `mintRecipient`. The escrow contract only needs to handle the source-side burn — Circle's attestation service does the rest.

---

## Security

### Access control

| Role | Granted to | Powers |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Deployer (constructor) | Role administration. |
| `ARBITER_ROLE` | `_arbiter` (constructor) | Can call `resolveDispute`. |
| `PAUSER_ROLE` | `_pauser` (constructor) | Can call `pause` / `unpause`. |

Arbiters **cannot** pause. Pausers **cannot** resolve disputes. The admin can rotate either role but has no direct power over escrows.

### Defense-in-depth

- **`ReentrancyGuard`** on every fund-moving function (`deposit`, `releaseAfterWindow`, `mutualCancel`, `withdrawRefund`).
- **`Pausable`** on `deposit` and `releaseAfterWindow`. Resolution, refund withdrawal, and dispute raising remain live even when paused, so users can always exit in-flight escrows.
- **`SafeERC20`** for all token movements (`safeTransferFrom`, `safeTransfer`, `safeIncreaseAllowance`).
- **Input validation:**
  - Zero-address checks on `_recipient`, `_refundTo`, and `_mintRecipient`.
  - Zero-amount check on `_amount`.
  - `_disputeWindow < 1 hours` reverts with `DisputeWindowTooShort`.
  - `escrowId` existence enforced via `e.depositor == address(0)` sentinel check.
  - State-machine guards on every transition (`InvalidState`, `NoDeposit`, `NoDispute`).
  - Window boundary guards (`DisputeWindowExpired`, `DisputeWindowNotExpired`).
- **Pull-based refunds** prevent a hostile `refundTo` from bricking dispute resolution.
- **Checks-effects-interactions** — state is written before any external call (allowance, transfer, burn).

### Custom errors

`InvalidAmount`, `ZeroAddress`, `NoDeposit`, `NotEscrowOwner`, `NotEscrowOwnerOrRecipient`, `InvalidState`, `DisputeWindowExpired`, `DisputeWindowNotExpired`, `NoDispute`, `EscrowDoesNotExist`, `DisputeWindowTooShort`, `NothingToWithdraw`.

---

## Contract addresses

### Arc Testnet

| Item | Value |
|---|---|
| `CrossChainEscrow` | `0x80Bc8A905C01Ae841E5F3B98824B903A76896266` |
| USDC | `0x3600000000000000000000000000000000000000` |
| CCTP v2 TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` |
| Explorer | https://testnet.arcscan.app |
| USDC Faucet | https://faucet.circle.com |

> Verify the TokenMessenger address against the current Circle documentation and https://testnet.arcscan.app before mainnet-equivalent deployment.

---

## Getting started

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`, `anvil`)
- Git
- Testnet USDC on Arc — claim from https://faucet.circle.com

### Install

```bash
git clone https://github.com/macanthonyeke/CrossChainEscrow.git
cd CrossChainEscrow
forge install
```

### Configure

```bash
cp .env.example .env
# edit .env and fill in PRIVATE_KEY and ARBITER_ADDRESS
```

### Build

```bash
forge build
```

### Test

```bash
forge test -vv
```

### Deploy to Arc Testnet

Load environment variables, then run the deploy script. The deployer account becomes `DEFAULT_ADMIN_ROLE`.

```bash
source .env

forge script script/DeployCrossChainEscrow.s.sol:DeployCrossChainEscrow \
  --rpc-url $ARC_TESTNET_RPC_URL \
  --broadcast \
  -vvvv
```

The deployed address is printed at the end of the run and saved under `broadcast/DeployCrossChainEscrow.s.sol/5042002/`.

---

## Testing

The suite lives under [test/](test/):

| Suite | File | Covers |
|---|---|---|
| Unit | [test/CrossChainEscrow.t.sol](test/CrossChainEscrow.t.sol) | Happy paths, every revert, per-function behavior, role checks. |
| Fuzz | [test/CrossChainEscrow.fuzz.t.sol](test/CrossChainEscrow.fuzz.t.sol) | Randomized inputs across amounts, windows, and timings. |
| Invariant | [test/invariant/CrossChainEscrow.invariant.t.sol](test/invariant/CrossChainEscrow.invariant.t.sol) | Global properties — conservation of USDC, monotonic state, no stuck balances. Driven by [test/invariant/Handler.sol](test/invariant/Handler.sol). |
| Adversarial | [test/adversarial/CrossChainEscrow.adversarial.t.sol](test/adversarial/CrossChainEscrow.adversarial.t.sol) | Reentrancy, malicious tokens, griefing patterns, access-control bypass attempts. |
| Mocks | [test/mocks/Mocks.sol](test/mocks/Mocks.sol) | `MockUSDC`, `MockTokenMessenger` — records `depositForBurn` calls. |

Run a single suite:

```bash
forge test --match-path test/CrossChainEscrow.t.sol -vv
forge test --match-path 'test/invariant/*'        -vv
forge test --match-path 'test/adversarial/*'      -vv
```

Gas snapshot:

```bash
forge snapshot
```

---

## How it works (step by step)

A complete freelance-payment flow, end to end.

**1. Depositor creates the escrow (on Arc).**
Alice owes Bob 1,000 USDC for a design delivered to Bob's wallet on Base.
Bob's destination CCTP domain is `6` (Base). Bob's address padded to `bytes32` is his `mintRecipient`.

```solidity
usdc.approve(address(escrow), 1_000e6);

uint256 id = escrow.deposit(
    bob,                                   // recipient (on Arc, informational)
    alice,                                 // refundTo — where refunds accrue
    1_000e6,                               // 1,000 USDC
    6,                                     // destinationDomain (Base)
    bytes32(uint256(uint160(bobOnBase))),  // mintRecipient on Base
    2 days                                 // disputeWindow
);
```

State: `DEPOSITED`. 1,000 USDC now sits in the escrow contract.

**2. Depositor confirms the work.**
Bob delivers. Alice calls `fulfillCondition(id)`. State → `CONDITION_MET`. A 2-day dispute window opens.

**3. Dispute window runs.**
Either party can call `raiseDispute(id)` during the window. If nobody does, the window expires cleanly.

**4a. No dispute → permissionless release.**
Anyone — Bob, Alice, a keeper bot, a randomer — calls `releaseAfterWindow(id)`. The escrow calls `depositForBurn` on Arc's TokenMessenger. USDC burns on Arc. Circle's attestation service signs the message. On Base, Bob (or a relayer) calls `receiveMessage` on the MessageTransmitter and Bob's wallet receives 1,000 native USDC. State → `RELEASED`.

**4b. Dispute raised → arbiter resolves.**
Alice raises a dispute (`raiseDispute(id)`). State → `DISPUTED`. The arbiter reviews the claim off-chain, then calls:

- `resolveDispute(id, true)` → release cross-chain to Bob (same CCTP path as 4a). State → `RELEASED`.
- `resolveDispute(id, false)` → credit `refundBalances[alice] += 1_000e6`. State → `REFUNDED`. Alice calls `withdrawRefund()` on Arc to collect.

**5. Mutual cancel (alternative path).**
Before `fulfillCondition`, either party can call `mutualCancel(id)`. Once both have called it, the amount credits to `refundBalances[refundTo]` and the depositor collects via `withdrawRefund()`.

---

## License

Released under the [MIT License](LICENSE).
