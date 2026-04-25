#!/usr/bin/env bash
# Smoke test for FlowBot against a live deployment.
#
# Usage:
#   bash scripts/smoke.sh https://cht-green.vercel.app
#
# Reads META_WEBHOOK_SECRET / META_VERIFY_TOKEN / TIKTOK_CLIENT_SECRET / CRON_SECRET
# from .env so it can sign real payloads — no fake responses, no mocks.
#
# Exit code = 0 if every test passes; non-zero on first failure.

set -e
BASE="${1:-https://cht-green.vercel.app}"
BASE="${BASE%/}"

# Load .env so we can sign realistic payloads
if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ -z "$META_WEBHOOK_SECRET" ] || [ -z "$META_VERIFY_TOKEN" ] || [ -z "$CRON_SECRET" ]; then
  echo "ERROR: .env must contain META_WEBHOOK_SECRET, META_VERIFY_TOKEN, CRON_SECRET" >&2
  exit 1
fi

PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
section() { echo; echo "── $1 ──"; }

# ─── 1. health ──────────────────────────────────────────────
section "health"
code=$(curl -sS -o /tmp/h.json -w "%{http_code}" "$BASE/api/health")
[ "$code" = "200" ] && ok "GET /api/health → 200" || fail "GET /api/health → $code"
grep -q '"status":"ok"' /tmp/h.json && ok "DB+Redis status = ok" || fail "DB or Redis is degraded — check /tmp/h.json"

# ─── 2. landing + dashboard ─────────────────────────────────
section "static assets"
code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/")
[ "$code" = "200" ] && ok "GET / (landing)" || fail "GET / → $code"
code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/dashboard")
[ "$code" = "200" ] && ok "GET /dashboard" || fail "GET /dashboard → $code"

# ─── 3. Meta webhook — GET handshake ────────────────────────
section "Meta webhook (GET handshake)"
challenge="smoke_$(date +%s)"
resp=$(curl -sS "$BASE/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=$META_VERIFY_TOKEN&hub.challenge=$challenge")
[ "$resp" = "$challenge" ] && ok "verify_token accepted, challenge echoed" || fail "expected '$challenge', got '$resp'"
# Wrong token → 403
code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x")
[ "$code" = "403" ] && ok "wrong verify_token → 403" || fail "wrong token leak — got $code"

# ─── 4. Meta webhook — POST signed payload ─────────────────
section "Meta webhook (POST + HMAC)"
PAYLOAD='{"object":"page","entry":[{"id":"smoketest_page","time":'$(date +%s)',"messaging":[{"sender":{"id":"smoke_user_1"},"recipient":{"id":"smoketest_page"},"timestamp":'$(date +%s)'000,"message":{"mid":"smoke_mid_'$(date +%s)'","text":"hello smoke"}}]}]}'
SIG="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$META_WEBHOOK_SECRET" | awk '{print $NF}')"
resp=$(curl -sS -X POST "$BASE/api/webhooks/meta" \
  -H "content-type: application/json" \
  -H "x-hub-signature-256: $SIG" \
  -d "$PAYLOAD")
echo "    response: $resp"
echo "$resp" | grep -q '"accepted"' && ok "valid signature accepted" || fail "valid signature rejected"
echo "$resp" | grep -q '"job_id"' && ok "job created (queue tracking working)" || fail "no job_id in response"

# Bad signature → 401
code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/webhooks/meta" \
  -H "content-type: application/json" \
  -H "x-hub-signature-256: sha256=BADSIG" \
  -d "$PAYLOAD")
[ "$code" = "401" ] && ok "bad signature → 401" || fail "bad signature accepted (got $code) — SECURITY HOLE"

# ─── 5. Meta webhook — comment payload (FB feed event) ─────
section "Meta webhook (FB comment / feed event)"
PAYLOAD='{"object":"page","entry":[{"id":"smoketest_page","time":'$(date +%s)',"changes":[{"field":"feed","value":{"item":"comment","verb":"add","comment_id":"cmt_smoke_'$(date +%s)'","post_id":"post_smoke_1","from":{"id":"smoke_commenter_1","name":"Smoke Commenter"},"message":"PRICE please"}}]}]}'
SIG="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$META_WEBHOOK_SECRET" | awk '{print $NF}')"
resp=$(curl -sS -X POST "$BASE/api/webhooks/meta" \
  -H "content-type: application/json" \
  -H "x-hub-signature-256: $SIG" \
  -d "$PAYLOAD")
echo "    response: $resp"
echo "$resp" | grep -q '"accepted":1' && ok "comment event accepted" || fail "comment event rejected"

# ─── 6. TikTok webhook ─────────────────────────────────────
section "TikTok webhook (POST + HMAC)"
if [ -n "$TIKTOK_CLIENT_SECRET" ]; then
  PAYLOAD='{"event_id":"tt_smoke_'$(date +%s)'","event_type":"comment","data":{"text":"hello"}}'
  SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$TIKTOK_CLIENT_SECRET" | awk '{print $NF}')
  code=$(curl -sS -o /tmp/tt.txt -w "%{http_code}" -X POST "$BASE/api/webhooks/tiktok" \
    -H "content-type: application/json" \
    -H "tiktok-signature: $SIG" \
    -d "$PAYLOAD")
  [ "$code" = "200" ] && ok "valid signature accepted" || fail "TikTok webhook → $code (body: $(cat /tmp/tt.txt))"
  # Bad sig → 401
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/webhooks/tiktok" \
    -H "content-type: application/json" \
    -H "tiktok-signature: BADSIG" \
    -d "$PAYLOAD")
  [ "$code" = "401" ] && ok "bad signature → 401" || fail "bad signature accepted (got $code)"
else
  echo "  ⏭  TIKTOK_CLIENT_SECRET not set — skipping"
fi

# ─── 7. Idempotency — same event twice ──────────────────────
section "Idempotency (duplicate webhook delivery)"
DUP_MID="dup_$(date +%s)"
PAYLOAD='{"object":"page","entry":[{"id":"smoketest_page","time":'$(date +%s)',"messaging":[{"sender":{"id":"smoke_user_2"},"recipient":{"id":"smoketest_page"},"timestamp":'$(date +%s)'000,"message":{"mid":"'$DUP_MID'","text":"dup test"}}]}]}'
SIG="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$META_WEBHOOK_SECRET" | awk '{print $NF}')"
r1=$(curl -sS -X POST "$BASE/api/webhooks/meta" -H "content-type: application/json" -H "x-hub-signature-256: $SIG" -d "$PAYLOAD")
r2=$(curl -sS -X POST "$BASE/api/webhooks/meta" -H "content-type: application/json" -H "x-hub-signature-256: $SIG" -d "$PAYLOAD")
n1=$(echo "$r1" | grep -o '"accepted":[0-9]*' | head -1)
n2=$(echo "$r2" | grep -o '"accepted":[0-9]*' | head -1)
echo "    first delivery:  $n1"
echo "    second delivery: $n2  (should be 0 — already seen)"
[ "$n2" = '"accepted":0' ] && ok "duplicate suppressed" || fail "duplicate NOT suppressed — idempotency broken"

# ─── 8. OAuth start (unauthenticated) ──────────────────────
section "OAuth start (no session → 401)"
code=$(curl -sS -o /dev/null -w "%{http_code}" -L -i "$BASE/api/oauth/meta/start" 2>&1 | grep -E "^HTTP" | head -1 | awk '{print $2}')
# Without session it should redirect or 401. Either is fine, just confirm it responds.
code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/api/oauth/meta/start")
[ "$code" = "401" ] || [ "$code" = "302" ] && ok "responds ($code) — auth-gated" || fail "OAuth start → $code"

# ─── 9. Worker (cron-protected) ────────────────────────────
section "Worker (cron secret check)"
code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE/api/worker?key=WRONG_SECRET")
[ "$code" = "401" ] && ok "rejects wrong CRON_SECRET" || fail "worker accepted wrong secret — SECURITY HOLE (got $code)"
resp=$(curl -sS "$BASE/api/worker?key=$CRON_SECRET")
echo "    worker output: $(echo $resp | head -c 200)…"
echo "$resp" | grep -q '"ok":true' && ok "worker drains queue with correct secret" || fail "worker failed: $resp"

# ─── 10. Authenticated endpoints reject unauthed ───────────
section "Auth-gated endpoints reject anonymous"
for ep in "/api/auth/me" "/api/integrations" "/api/flows" "/api/contacts" "/api/workspaces/me"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE$ep")
  [ "$code" = "401" ] && ok "$ep → 401" || fail "$ep leaked data (got $code)"
done

# ─── summary ───────────────────────────────────────────────
echo
echo "════════════════════════════════════════"
echo "  PASSED: $PASS   FAILED: $FAIL"
echo "════════════════════════════════════════"
[ "$FAIL" = "0" ] && exit 0 || exit 1
