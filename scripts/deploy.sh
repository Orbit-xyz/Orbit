#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Orbit deployment orchestrator (#354)
#
# One command builds, optimizes, deploys (or upgrades), initializes the
# Soroban contract, and syncs the new contract ID into the app env files.
#
#   bash scripts/deploy.sh
#
# Run it from any directory: all paths resolve from this script's location.
#
# Environment overrides (all optional):
#   STELLAR_NETWORK     testnet (default) | futurenet
#   DEPLOYER_IDENTITY   stellar CLI key name that pays fees (default: alice)
#   ADMIN_IDENTITY      key that becomes/stays the protocol admin (default: deployer)
#   ORBIT_CONTRACT_ID   skip the lookup and upgrade this contract instead
#   MIN_XLM             minimum XLM balance required before deploying (default: 5)
#   SKIP_BUILD=1        reuse the existing optimized WASM
#   SKIP_ENV_SYNC=1     do not touch apps/*/.env files
#   DRY_RUN=1           print every state-changing command instead of running it
#   BACKEND_ENV_FILE, FRONTEND_ENV_FILE, CONTRACT_ID_FILE
#                       override the file locations (used by the test suite)
#
# Re-running is safe. If a contract ID is already recorded for the network, the
# script uploads the new bytecode and calls the contract's admin-guarded
# `upgrade` entrypoint. Otherwise it deploys a fresh instance and bootstraps the
# admin with `set_admin`.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACT_DIR="$ROOT_DIR/contracts/soroban"

STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
DEPLOYER_IDENTITY="${DEPLOYER_IDENTITY:-alice}"
ADMIN_IDENTITY="${ADMIN_IDENTITY:-$DEPLOYER_IDENTITY}"
MIN_XLM="${MIN_XLM:-5}"
DRY_RUN="${DRY_RUN:-0}"

case "$STELLAR_NETWORK" in
  testnet) HORIZON_URL="https://horizon-testnet.stellar.org"; FRIENDBOT=1 ;;
  futurenet) HORIZON_URL="https://horizon-futurenet.stellar.org"; FRIENDBOT=1 ;;
  *)
    echo "error: unsupported STELLAR_NETWORK '$STELLAR_NETWORK' (use testnet or futurenet)" >&2
    exit 1
    ;;
esac

if [ "$STELLAR_NETWORK" = "testnet" ]; then
  DEFAULT_CONTRACT_ID_FILE="$SCRIPT_DIR/.contract_id"
else
  DEFAULT_CONTRACT_ID_FILE="$SCRIPT_DIR/.contract_id.$STELLAR_NETWORK"
fi
CONTRACT_ID_FILE="${CONTRACT_ID_FILE:-$DEFAULT_CONTRACT_ID_FILE}"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$ROOT_DIR/apps/backend/.env}"
FRONTEND_ENV_FILE="${FRONTEND_ENV_FILE:-$ROOT_DIR/apps/frontend/.env.local}"

RAW_WASM="$CONTRACT_DIR/target/wasm32v1-none/release/orbit_contract.wasm"
OPT_WASM="$CONTRACT_DIR/target/wasm32v1-none/release/orbit_contract.optimized.wasm"

log() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }

# Runs a state-changing command, or prints it in DRY_RUN mode.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '    [dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

# Runs a command that prints a value and captures stdout. Dry runs print a
# placeholder so the rest of the flow can still be walked through.
capture() {
  local placeholder="$1"; shift
  if [ "$DRY_RUN" = "1" ]; then
    printf '    [dry-run] %s\n' "$*" >&2
    printf '%s' "$placeholder"
    return 0
  fi
  "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed or not on PATH. $2"
}

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
log "Preflight ($STELLAR_NETWORK)"
require_command stellar "Install the Stellar CLI: https://developers.stellar.org/docs/tools/stellar-cli"
require_command curl "curl is needed to check the deployer's funding on Horizon."
require_command node "Node.js is needed to read account balances."
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  require_command cargo "Install Rust with the wasm32v1-none target: rustup target add wasm32v1-none"
fi

# ---------------------------------------------------------------------------
# 2. Deployer identity and funding
# ---------------------------------------------------------------------------
log "Checking deployer identity '$DEPLOYER_IDENTITY'"
if DEPLOYER_ADDRESS="$(stellar keys address "$DEPLOYER_IDENTITY" 2>/dev/null)"; then
  info "Using existing key: $DEPLOYER_ADDRESS"
else
  if [ "$FRIENDBOT" = "1" ]; then
    info "No key named '$DEPLOYER_IDENTITY'. Generating and funding one with Friendbot."
    run stellar keys generate "$DEPLOYER_IDENTITY" --network "$STELLAR_NETWORK" --fund
  else
    run stellar keys generate "$DEPLOYER_IDENTITY" --network "$STELLAR_NETWORK"
  fi
  DEPLOYER_ADDRESS="$(capture "G_DRYRUN_DEPLOYER" stellar keys address "$DEPLOYER_IDENTITY")"
  info "Deployer address: $DEPLOYER_ADDRESS"
fi

ADMIN_ADDRESS="$DEPLOYER_ADDRESS"
if [ "$ADMIN_IDENTITY" != "$DEPLOYER_IDENTITY" ]; then
  ADMIN_ADDRESS="$(capture "G_DRYRUN_ADMIN" stellar keys address "$ADMIN_IDENTITY")"
fi

# Account balance check. A 404 means the account was never created on the
# network, so deploy would fail with an opaque RPC error. Catch it first.
log "Checking XLM funding for $DEPLOYER_ADDRESS"
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] curl $HORIZON_URL/accounts/$DEPLOYER_ADDRESS"
else
  HTTP_BODY="$(mktemp)"
  HTTP_CODE="$(curl -s -o "$HTTP_BODY" -w '%{http_code}' "$HORIZON_URL/accounts/$DEPLOYER_ADDRESS" || echo 000)"
  if [ "$HTTP_CODE" = "404" ]; then
    rm -f "$HTTP_BODY"
    die "deployer $DEPLOYER_ADDRESS does not exist on $STELLAR_NETWORK, so it has no XLM.
    Fund it and rerun:
      stellar keys fund $DEPLOYER_IDENTITY --network $STELLAR_NETWORK
    or use the Stellar Laboratory account creator: https://laboratory.stellar.org/#account-creator?network=test"
  fi
  if [ "$HTTP_CODE" != "200" ]; then
    rm -f "$HTTP_BODY"
    die "could not reach Horizon at $HORIZON_URL (HTTP $HTTP_CODE). Check your network connection and retry."
  fi
  XLM_BALANCE="$(node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      const account = JSON.parse(raw);
      const native = (account.balances || []).find((b) => b.asset_type === "native");
      process.stdout.write(native ? native.balance : "0");
    });' < "$HTTP_BODY")"
  rm -f "$HTTP_BODY"
  if ! awk -v have="$XLM_BALANCE" -v need="$MIN_XLM" 'BEGIN { exit !(have + 0 >= need + 0) }'; then
    die "deployer $DEPLOYER_ADDRESS holds $XLM_BALANCE XLM but needs at least $MIN_XLM XLM to deploy and pay fees.
    Top it up with: stellar keys fund $DEPLOYER_IDENTITY --network $STELLAR_NETWORK"
  fi
  info "Balance: $XLM_BALANCE XLM"
fi

# ---------------------------------------------------------------------------
# 3. Build and optimize the WASM
# ---------------------------------------------------------------------------
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  log "Skipping build (SKIP_BUILD=1)"
else
  log "Building contract with 'stellar contract build'"
  (cd "$CONTRACT_DIR" && run stellar contract build)
fi

log "Optimizing WASM"
if [ "$DRY_RUN" != "1" ] && [ ! -f "$RAW_WASM" ] && [ "${SKIP_BUILD:-0}" = "1" ]; then
  die "no build artifact at $RAW_WASM. Run without SKIP_BUILD=1 first."
fi
if [ "$DRY_RUN" = "1" ] || [ -f "$RAW_WASM" ]; then
  run stellar contract optimize --wasm "$RAW_WASM" --wasm-out "$OPT_WASM"
else
  die "build did not produce $RAW_WASM"
fi
if [ "$DRY_RUN" != "1" ] && [ ! -f "$OPT_WASM" ]; then
  die "optimization did not produce $OPT_WASM"
fi
info "Optimized artifact: $OPT_WASM"

# Install the bytecode on the network. Uploading identical bytes is a no-op
# that returns the same hash, so this step is safe to repeat.
log "Uploading WASM bytecode"
WASM_HASH="$(capture "0000000000000000000000000000000000000000000000000000000000000000" \
  stellar contract upload --wasm "$OPT_WASM" --source-account "$DEPLOYER_IDENTITY" --network "$STELLAR_NETWORK" | tail -n 1)"
info "WASM hash: $WASM_HASH"

# ---------------------------------------------------------------------------
# 4. Deploy or upgrade
# ---------------------------------------------------------------------------
EXISTING_CONTRACT_ID="${ORBIT_CONTRACT_ID:-}"
if [ -z "$EXISTING_CONTRACT_ID" ] && [ -s "$CONTRACT_ID_FILE" ]; then
  EXISTING_CONTRACT_ID="$(tr -d '[:space:]' < "$CONTRACT_ID_FILE")"
fi

CONTRACT_ID=""
if [ -n "$EXISTING_CONTRACT_ID" ]; then
  log "Upgrading existing contract $EXISTING_CONTRACT_ID"
  if run stellar contract invoke --id "$EXISTING_CONTRACT_ID" --source-account "$ADMIN_IDENTITY" \
      --network "$STELLAR_NETWORK" -- upgrade --caller "$ADMIN_ADDRESS" --new_wasm_hash "$WASM_HASH"; then
    CONTRACT_ID="$EXISTING_CONTRACT_ID"
    info "Upgrade submitted. Re-running with the same bytecode is a no-op."
  else
    die "upgrade of $EXISTING_CONTRACT_ID failed. The admin must be $ADMIN_ADDRESS. Check the error above, or delete $CONTRACT_ID_FILE to deploy a new instance."
  fi
else
  log "Deploying a new contract instance"
  CONTRACT_ID="$(capture "CDRYRUNCONTRACTID" \
    stellar contract deploy --wasm "$OPT_WASM" --source-account "$DEPLOYER_IDENTITY" --network "$STELLAR_NETWORK" | tail -n 1)"
  info "Contract ID: $CONTRACT_ID"
fi

# ---------------------------------------------------------------------------
# 5. Initialize admin state
# ---------------------------------------------------------------------------
# `set_admin` bootstraps the first caller as protocol admin and otherwise only
# asserts the caller is the current admin, so repeating it is safe.
log "Initializing admin ($ADMIN_ADDRESS)"
if ! run stellar contract invoke --id "$CONTRACT_ID" --source-account "$ADMIN_IDENTITY" \
    --network "$STELLAR_NETWORK" -- set_admin --caller "$ADMIN_ADDRESS"; then
  die "admin initialization failed. If this contract already has a different admin, rerun with ADMIN_IDENTITY set to that key."
fi

# ---------------------------------------------------------------------------
# 6. Record the contract ID and sync the apps
# ---------------------------------------------------------------------------
set_env_var() {
  local file="$1" key="$2" value="$3"
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] set $key in $file"
    return 0
  fi
  mkdir -p "$(dirname "$file")"
  if [ ! -f "$file" ]; then
    info "Creating $file (copy the remaining values from the matching .env.example)"
    : > "$file"
  fi
  local tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
  info "Set $key in ${file#"$ROOT_DIR"/}"
}

log "Recording contract ID"
run mkdir -p "$(dirname "$CONTRACT_ID_FILE")"
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] write $CONTRACT_ID to ${CONTRACT_ID_FILE#"$ROOT_DIR"/}"
else
  printf '%s\n' "$CONTRACT_ID" > "$CONTRACT_ID_FILE"
  info "Wrote ${CONTRACT_ID_FILE#"$ROOT_DIR"/}"
fi

if [ "${SKIP_ENV_SYNC:-0}" = "1" ]; then
  log "Skipping env sync (SKIP_ENV_SYNC=1)"
else
  log "Syncing contract ID into app env files"
  set_env_var "$BACKEND_ENV_FILE" "ORBIT_CONTRACT_ID" "$CONTRACT_ID"
  set_env_var "$FRONTEND_ENV_FILE" "NEXT_PUBLIC_ORBIT_CONTRACT_ID" "$CONTRACT_ID"
fi

log "Done"
info "Network:     $STELLAR_NETWORK"
info "Contract ID: $CONTRACT_ID"
info "WASM hash:   $WASM_HASH"
info "Re-run 'bash scripts/deploy.sh' at any time to ship a new build to this contract."
