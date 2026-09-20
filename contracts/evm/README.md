# OrbitPuller — Arc (EVM) Settlement Contract

Solidity port of Orbit's settlement engine for **Arc**, Circle's EVM Layer-1 where USDC is
the native gas token. This is the second of Orbit's two rails; the Stellar Soroban rail
lives in `../soroban/` and is unaffected by anything here.

**Deployed & verified on Arc Testnet:**
[`0x2c0c751e40b89a01309548DaBe7937754447aC92`](https://explorer.testnet.arc.io/address/0x2c0c751e40b89a01309548DaBe7937754447aC92)

## What it does

Non-custodial pull payments. The contract never holds funds — it only moves tokens a payer
has explicitly approved, and only within the cadence and cap recorded in their vault.

| Function | Role | Soroban equivalent |
| :--- | :--- | :--- |
| `createVault` | Subscriber authorizes a merchant to pull X per interval | `create_vault` |
| `pullFunds` | Merchant collects one interval's payment | `pull_funds` |
| `revokeVault` | Subscriber cancels unilaterally | *(none — EVM addition)* |
| `batchDisburse` | Atomic multi-recipient payroll, one signature | `batch_disburse` |
| `getVault` / `isPullable` / `nextPullTimestamp` | Dashboard reads | *(none)* |

The contract is **ownerless** — no admin, no upgrade path, no pause. Once deployed, nobody
can change its behavior, including us.

## Arc specifics that shaped this code

- **USDC satisfies `IERC20` directly** at `0x3600000000000000000000000000000000000000`.
  There is no wrapped USDC; the native and ERC-20 interfaces share one balance.
- **Decimals differ by interface**: `6` on ERC-20, `18` on the native gas view. This
  contract touches only `IERC20`, which is what Circle's guidance requires.
- **Transfers to `address(0)` revert on Arc**, so `batchDisburse` validates recipients
  explicitly — a blank row in a payroll CSV fails with `InvalidParams` rather than an
  opaque error from inside USDC.
- **Block timestamps are non-decreasing, not strictly increasing.** Irrelevant to a
  30-day cadence comparison, but do not use timestamps for ordering here.

## Working on it

```bash
forge build
forge test                                   # 25 tests
forge coverage --no-match-coverage "(script|lib)"   # 100% lines/branches/funcs on src/
```

Deploy (see `Docs/Build_Guide.md` Task 6.4 for the full procedure):

```bash
cp .env.example .env                         # network values are pre-filled
cast wallet import orbit-deployer --interactive
forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL \
  --account orbit-deployer --broadcast
```

Verification needs no API key — the explorer runs Blockscout:

```bash
forge verify-contract <ADDRESS> src/OrbitPuller.sol:OrbitPuller \
  --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ \
  --chain-id 5042002
```
