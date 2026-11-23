#!/usr/bin/env bash
# Tests for scripts/deploy.sh (#354). Runs the orchestrator against stub
# `stellar` and `curl` binaries, so no network or real funds are needed.
#
#   bash scripts/test/deploy.test.sh
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/../.." && pwd)"
DEPLOY="$ROOT_DIR/scripts/deploy.sh"
CONTRACT_DIR="$ROOT_DIR/contracts/soroban"
STUB_RAW_WASM="$CONTRACT_DIR/target/wasm32v1-none/release/orbit_contract.wasm"
STUB_OPT_WASM="$CONTRACT_DIR/target/wasm32v1-none/release/orbit_contract.optimized.wasm"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; rm -f "$STUB_RAW_WASM" "$STUB_OPT_WASM"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# ---------------------------------------------------------------------------
# Stubs. They log every call to $CALL_LOG and behave according to env vars:
#   STUB_HTTP          Horizon HTTP status (default 200)
#   STUB_XLM           native balance returned by Horizon (default 100)
#   STUB_UPGRADE_FAIL  make `contract invoke ... upgrade` fail
# ---------------------------------------------------------------------------
BIN="$WORK/bin"
mkdir -p "$BIN"
cat > "$BIN/stellar" <<'STUB'
#!/usr/bin/env bash
echo "stellar $*" >> "$CALL_LOG"
case "$1 $2" in
  "keys address") echo "GDEPLOYERSTUBADDRESS" ;;
  "keys generate"|"keys fund") exit 0 ;;
  "contract build") mkdir -p target/wasm32v1-none/release && : > target/wasm32v1-none/release/orbit_contract.wasm ;;
  "contract optimize")
    out=""; while [ $# -gt 0 ]; do [ "$1" = "--wasm-out" ] && out="$2"; shift; done
    : > "$out" ;;
  "contract upload") echo "WASMHASHSTUB0000000000000000000000000000000000000000000000000000" ;;
  "contract deploy") echo "CNEWCONTRACTSTUB" ;;
  "contract invoke")
    case "$*" in
      *" upgrade "*) [ "${STUB_UPGRADE_FAIL:-0}" = "1" ] && exit 1 ;;
    esac
    exit 0 ;;
  *) echo "unexpected stellar call: $*" >&2; exit 2 ;;
esac
STUB
cat > "$BIN/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$CALL_LOG"
out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
printf '{"balances":[{"asset_type":"native","balance":"%s"}]}' "${STUB_XLM:-100.0000000}" > "$out"
printf '%s' "${STUB_HTTP:-200}"
STUB
chmod +x "$BIN/stellar" "$BIN/curl"

# Runs the orchestrator in an isolated sandbox. Extra env vars come from the caller.
run_deploy() {
  local case_dir="$1"; shift
  mkdir -p "$case_dir"
  : > "$case_dir/calls.log"
  env -i PATH="$BIN:/usr/bin:/bin:$(dirname "$(command -v node)"):$(dirname "$(command -v cargo)")" HOME="$HOME" \
    CALL_LOG="$case_dir/calls.log" \
    SKIP_BUILD="${SKIP_BUILD:-0}" \
    STUB_HTTP="${STUB_HTTP:-200}" STUB_XLM="${STUB_XLM:-100.0000000}" \
    STUB_UPGRADE_FAIL="${STUB_UPGRADE_FAIL:-0}" \
    CONTRACT_ID_FILE="$case_dir/contract_id" \
    BACKEND_ENV_FILE="$case_dir/backend.env" \
    FRONTEND_ENV_FILE="$case_dir/frontend.env.local" \
    "$@" bash "$DEPLOY" > "$case_dir/out.log" 2>&1
}

calls() { cat "$1/calls.log"; }

echo "deploy orchestrator tests"

# 1. Fresh deploy on a funded account.
C1="$WORK/fresh"
if run_deploy "$C1" STELLAR_NETWORK=testnet; then
  if grep -q "contract deploy" "$C1/calls.log" && grep -q -- "set_admin" "$C1/calls.log" \
     && ! grep -q -- " upgrade " "$C1/calls.log"; then
    pass "fresh deploy uploads, deploys and calls set_admin without upgrading"
  else
    fail "fresh deploy call sequence"; calls "$C1"
  fi
  [ "$(cat "$C1/contract_id")" = "CNEWCONTRACTSTUB" ] && pass "contract id recorded" || fail "contract id not recorded"
  grep -qx "ORBIT_CONTRACT_ID=CNEWCONTRACTSTUB" "$C1/backend.env" && pass "backend env synced" || fail "backend env not synced"
  grep -qx "NEXT_PUBLIC_ORBIT_CONTRACT_ID=CNEWCONTRACTSTUB" "$C1/frontend.env.local" && pass "frontend env synced" || fail "frontend env not synced"
else
  fail "fresh deploy exited non-zero"; cat "$C1/out.log"
fi

# 2. Re-run upgrades the recorded contract instead of deploying a new one.
if run_deploy "$C1" STELLAR_NETWORK=testnet; then
  if grep -q -- " upgrade " "$C1/calls.log" && ! grep -q "contract deploy" "$C1/calls.log"; then
    pass "re-run upgrades the existing contract and does not redeploy"
  else
    fail "re-run should upgrade, not deploy"; calls "$C1"
  fi
else
  fail "re-run exited non-zero"; cat "$C1/out.log"
fi

# 3. Env sync is idempotent: one line per key, unrelated keys preserved.
printf 'PORT=3001\nORBIT_CONTRACT_ID=COLDVALUE\n' > "$C1/backend.env"
run_deploy "$C1" STELLAR_NETWORK=testnet >/dev/null
run_deploy "$C1" STELLAR_NETWORK=testnet >/dev/null
count="$(grep -c '^ORBIT_CONTRACT_ID=' "$C1/backend.env")"
if [ "$count" = "1" ] && grep -qx "PORT=3001" "$C1/backend.env" && grep -qx "ORBIT_CONTRACT_ID=CNEWCONTRACTSTUB" "$C1/backend.env"; then
  pass "env sync replaces the old value and keeps unrelated keys"
else
  fail "env sync result unexpected: $(cat "$C1/backend.env")"
fi

# 4. Unfunded deployer (Horizon 404) fails before any state change.
C4="$WORK/unfunded"
if STUB_HTTP=404 run_deploy "$C4" STELLAR_NETWORK=testnet; then
  fail "unfunded deployer should fail"
else
  if grep -q "does not exist on testnet" "$C4/out.log" && grep -q "stellar keys fund" "$C4/out.log" \
     && ! grep -q "contract deploy" "$C4/calls.log"; then
    pass "unfunded deployer fails early with funding instructions"
  else
    fail "unfunded message missing"; cat "$C4/out.log"
  fi
fi

# 5. Balance below the minimum fails with a clear message.
C5="$WORK/low"
if STUB_XLM=1.5 run_deploy "$C5" STELLAR_NETWORK=testnet; then
  fail "low balance should fail"
else
  grep -q "needs at least 5 XLM" "$C5/out.log" && pass "low balance is rejected with the minimum required" || { fail "low balance message missing"; cat "$C5/out.log"; }
fi

# 6. A failed upgrade is reported and does not overwrite the recorded ID.
C6="$WORK/upgrade-fail"
mkdir -p "$C6" && echo "CEXISTINGCONTRACT" > "$C6/contract_id"
if STUB_UPGRADE_FAIL=1 run_deploy "$C6" STELLAR_NETWORK=testnet; then
  fail "failed upgrade should exit non-zero"
else
  [ "$(cat "$C6/contract_id")" = "CEXISTINGCONTRACT" ] && pass "failed upgrade keeps the recorded contract id" || fail "contract id was overwritten"
fi

# 7. Dry run prints state-changing commands and writes nothing.
C7="$WORK/dry"
if run_deploy "$C7" STELLAR_NETWORK=testnet DRY_RUN=1; then
  if grep -q "\[dry-run\]" "$C7/out.log" && ! grep -q "contract deploy\|contract invoke" "$C7/calls.log" \
     && [ ! -e "$C7/contract_id" ] && [ ! -e "$C7/backend.env" ]; then
    pass "dry run performs no deploy, invoke or file writes"
  else
    fail "dry run had side effects"; cat "$C7/calls.log"
  fi
else
  fail "dry run exited non-zero"; cat "$C7/out.log"
fi

# 8. Unsupported networks are rejected before any call.
C8="$WORK/bad-net"
if run_deploy "$C8" STELLAR_NETWORK=mainnet; then
  fail "mainnet should be rejected"
else
  grep -q "unsupported STELLAR_NETWORK" "$C8/out.log" && pass "unsupported network is rejected" || fail "unsupported network message missing"
fi

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
