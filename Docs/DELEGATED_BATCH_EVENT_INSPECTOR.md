# Delegated batch onboarding and live event inspection (#379, #380)

## One-transaction cohort onboarding

`batch_create_vaults_delegated(Vec<DelegatedVaultAuth>)` creates up to **20**
subscriber vaults in one atomic Soroban invocation. No individual subscriber
needs to submit a transaction or hold XLM for the submission fee; the relayer
submits the transaction, and each subscriber signs their own terms off-chain.

`DelegatedVaultAuth` has `user`, `merchant`, `token`, `amount`,
`interval_ledgers`, `nonce`, `expiry_ledger`, and `signature`. The token
and expiry are additional signed fields necessary to prevent relayer substitution
or unbounded reuse. The signed preimage is:

```
SHA256(
  XDR(current_contract_address)
  || network_id[32]
  || XDR(Symbol("batch_create_vaults_delegated"))
  || XDR(user)
  || XDR(merchant)
  || XDR(token)
  || amount.to_be_bytes()[16]
  || interval_ledgers.to_be_bytes()[4]
  || nonce.to_be_bytes()[8]
  || expiry_ledger.to_be_bytes()[4]
)
```

Sign these 32 digest bytes using the subscriber's Ed25519 secret key and set
`signature` to the resulting 64-byte value. Use
`delegated_batch_vault_digest` for canonical contract-side hashing and
`get_user_nonce(user)` for the current nonce. The signing payload is
deployment- and network-bound and intentionally **not** interchangeable with
the single-vault delegated authorization signature.

The contract validates expiry, nonce, positive amounts, nonzero intervals,
and account-address/public-key compatibility before Ed25519 verification.
Each successful entry consumes its user's nonce and creates a persistent vault
with the existing `write_vault` helper, preserving TTL and event conventions.
A bad entry causes a transaction error; Soroban atomically reverts **every**
earlier write in that transaction. Duplicate signatures and stale nonces cannot
be replayed. The contract logs the current authorization index as a diagnostic immediately
before validating each entry, including before the host's Ed25519 check.
Relayers should still prevalidate payloads and use transaction diagnostics to
locate the offending index; Soroban reports the typed authorization reason or
host signature failure and does not commit the partial batch.

## Developer dashboard: contract event stream

The Developers view embeds a dark terminal with decoded contract event cards,
a wallet/transaction search, type and status filters, and an inspector for JSON
and raw base64 XDR. The event names emitted by this contract are:

| Contract topic | Display category |
| --- | --- |
| `vault_created`, `trial_vault_created`, `vault_delegated` | Create vault |
| `funds_pulled` | Pull funds |
| `vault_cancelled` | Cancel vault |

Configuration in `apps/frontend/.env.local`:

```env
NEXT_PUBLIC_ORBIT_CONTRACT_ID=C...
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
# Optional: a provider endpoint supporting stellar_subscribe events.
NEXT_PUBLIC_ORBIT_EVENTS_WS_URL=
```

The optional WebSocket path uses the provider-specific `stellar_subscribe`
JSON-RPC method. The official Stellar Soroban RPC `getEvents` method is
HTTP-based; the inspector reconciles with it every 1.5 seconds, including when
a WebSocket is configured. A public browser-facing WebSocket URL must not
contain a private API key. Provider responsiveness and RPC ledger visibility
affect delivery latency: **sub-two-second arrival cannot be guaranteed by
the frontend alone**.

Only finalized, successful Soroban contract events are shown as such.
Failed transactions do not emit finalized contract events, so the FAILED
filter normally has no entries. Transaction failure inspection requires a
separate transaction diagnostic API; no failed event is fabricated.

The feed is bounded to 120 recent events, de-duplicates by event id, and
retries failed RPC reads without advancing its ledger watermark.
