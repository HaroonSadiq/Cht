# Behavior Checks

For each function type, the platform-specific and architectural concerns the function's *behavior* must respect. Wiring (the previous file) is about whether the function is called; behavior is about whether what it does is correct given the system's constraints.

For each item, point to the **exact line(s)** in the function that satisfy it, or note its absence as a finding.

## Webhook handler

### Must do

1. **Verify signature on raw body, in constant time.**
   - Captures `raw body` via `await req.text()` (App Router) or equivalent — *not* `req.json()` or framework-parsed JSON. The bytes used for signature MUST equal the bytes the platform signed.
   - Calls `crypto.timingSafeEqual` (or equivalent) — never `===` between strings.
   - Returns 401 if signature missing/invalid; logs nothing else (don't leak that signatures were rejected via verbose logs).
2. **Idempotency** on `(connected_account_id, platform_message_id)` via `INSERT ... ON CONFLICT DO NOTHING`.
3. **Upsert the contact** before doing anything else with the event. Always advance `last_inbound_at`. The 24h window depends on this being right.
4. **Hand off to a queue** rather than processing synchronously. Webhook returns 200 within ~3s.
5. **Returns 200 even when downstream queue fails** if the `message_events` row was inserted — the row is the durable record, a reconciliation worker can retry. Returning non-200 makes Meta retry aggressively.

### Must not

- Trust any field from the payload as authoritative until the signature is verified.
- Use parsed JSON to compute the signature.
- Run the matching engine inline.
- Log raw payload at info level (often contains user content / PII).
- Use `body.user.id` directly as a database key — Meta sends Page-Scoped IDs (PSIDs) which are different per Page; the unique key is `(connected_account_id, platform_contact_id)`.

### Edge cases

- The `messaging` array can have multiple events per webhook delivery — loop, don't pick the first.
- `message.text` can be missing (attachments, postbacks, story replies) — check before reading.
- `entry` array can be batched — same loop discipline.
- The verification handshake (`GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`) is a different code path; ensure the GET handler echoes `hub.challenge` only when `hub.verify_token` matches.

## OAuth callback handler

### Must do

1. **Verify and consume `state`** before any token exchange. Reject if missing/invalid/already consumed/expired.
2. **HTTPS** for the token-exchange call. Validate the response: presence of `access_token`, no error fields.
3. **Encrypt tokens before insert.** Never persist plaintext, even for "just a moment."
4. **Scope verification** — confirm the granted scopes (returned by the platform or by `/debug_token`) match what the app needs. If a scope was requested but not granted, surface that to the user.
5. **For Meta**, exchange short-lived → long-lived user token, then derive Page tokens via `/me/accounts`. Don't persist the user token; persist the per-Page tokens.
6. **Subscribe to webhooks** for the new connected account.

### Must not

- Trust the redirected URL parameters as authoritative — `state` is the only protection against CSRF/replay.
- Persist the OAuth `code` after exchange.
- Render the access token in HTML/logs/error responses.

### Edge cases

- User cancels mid-flow — callback may have `error` in query string; handle and redirect to a friendly error page.
- User has no Pages (FB) / no IG-linked Page — render help, don't crash.
- Token refresh — if implementing for TikTok or IG long-lived flows, do this in a separate refresher worker, not in the callback.

## Trigger dispatcher

### Must do

1. **Honor the dispatch order:**
   - **First:** check for an existing `flow_runs` row for this contact with `status='waiting_for_reply'`. If found, route the message to that run as the user's reply — do not start any new flow.
   - **Second:** check `contacts.is_human_takeover`. If true, no flow fires (still log to inbox).
   - **Third:** call AI intent classifier (DM only).
   - **Fourth:** keyword/comment/story_reply/etc. matchers.
2. **Pick exactly one flow** to start per inbound event. Multiple matches → lowest `priority` wins, tiebreak by most recent `updated_at`.
3. **Log the decision.** Even "no match" should produce a log entry — the user will need this when debugging "why didn't the bot reply?"
4. **Idempotency** — if the same `message_event` is dispatched twice, the second dispatch should not start a new run (use `flow_runs (flow_id, contact_id, triggered_by_message_event_id)` unique constraint).

### Must not

- Run all matchers and pick the "best" — short-circuit. The user expects only one bot response per message.
- Start a flow for a contact in human-takeover mode just because a keyword matched.

## Trigger matcher (per-type)

### Must do

1. Filter by `connected_account_id` (the matcher operates only on flows for this account).
2. Filter by `is_active = true`.
3. Apply the `channel` filter (`dm` / `comment` / `both`).
4. **For keyword:** use the normalized text (lowercase, trim, collapsed whitespace) consistently for `exact` and `contains`. Use `\b<pattern>\b` regex for `keyword_any`.
5. **For regex:** wrap each regex execution in a 100ms timeout to prevent ReDoS.
6. **Return one flow** (the highest-priority match) or null. Determinism matters — same inputs → same output.

### Must not

- Use `eval()` or any dynamic execution of user-provided patterns.
- Concatenate user-provided patterns into SQL.

## Flow runner

### Must do

1. Load the run + current step + contact in one transaction.
2. Dispatch to the correct step executor by `step_type`.
3. Advance `current_step_id` and update timestamps **atomically** with the step's actions.
4. Handle the "step throws" case: set `status='errored'`, capture the error, do not silently advance.
5. Re-enqueue itself for the next step unless the step set a wait or terminated.

### Must not

- Trust `flow_runs.context` to be small — cap or truncate before write.
- Run a step for a run with `status != 'active'` (waiting / completed / errored runs should not advance).

## Flow step executors

### `send_message`

- Renders templates with variable substitution (`{{contact.first_name}}`, `{{flow.context.last_user_reply}}`, etc.).
- Calls the sender (which is responsible for 24h window — don't duplicate the check here).
- Logs the rendered message in `flow_runs.context` for debugging.

### `wait_for_reply`

- Sets `status='waiting_for_reply'` and `wait_until = now() + timeout_hours`.
- Returns without advancing (the runner won't enqueue a next step).
- The dispatcher's mid-flow check must route the next inbound message to this run.

### `delay`

- Sets `wait_until = now() + duration_minutes`.
- Returns without advancing.
- The wake-delayed-runs scheduler picks it up.

### `branch`

- Evaluates conditions in declared order.
- First match wins.
- A `default` branch must exist; error if not.
- Returns the chosen `next_step_id` to the runner.

### `add_tag` / `remove_tag`

- Operates via `contact_tags` repo.
- No-op if tag is already present (add) or absent (remove).
- Advances synchronously.

### `set_field`

- Renders the value template before writing.
- `contacts.custom_fields` JSONB merge, not replace.
- Caps total custom_fields size (e.g., 16KB) — refuse over-cap writes.

### `http_request`

- Has a timeout (5–10s default).
- Stores the response (status, headers, body parsed if JSON) in `flow_runs.context.http_response_data`.
- Doesn't follow arbitrary redirects to internal/private addresses (SSRF protection).
- If `save_response_to_field` is set, writes that field to `contacts.custom_fields` after the call.

### `handoff_to_human`

- Sets `contacts.is_human_takeover = true`.
- Sets `flow_runs.status = 'active_human'` (so the run isn't picked up by the timeout scheduler).
- Optionally enqueues a notification.

## Sender

### Must do

1. **Check connected_account.status === 'active'.** If not, fail with `skipped: account_not_active`.
2. **24h window check** for Meta: read `contact.last_inbound_at`. If within 24h, use `messaging_type: 'RESPONSE'`. If outside, the call must include a `message_tag` parameter; if not provided, fail with `skipped: outside_24h_window`.
3. **Decrypt the access token** just-in-time; never log it.
4. **Insert outbound `message_events` row** after the API responds, regardless of success/failure. Status field reflects the outcome.
5. **Update `contacts.last_outbound_at`** if tracked.
6. **Classify errors:**
   - 429 / `code 17`: rate-limited. Throw `RateLimitError` with `retryAfter`.
   - `code 190`: token expired. Flip `connected_accounts.status = 'expired'`, throw `AuthError`.
   - `code 200`: scope missing. Throw `PermanentError`. Don't retry; alert.
   - `code 100`: invalid recipient. Throw `PermanentError`.
   - 5xx / network: throw `TransientError`. The caller (worker) decides retry policy.

### Must not

- Hardcode the API version (it's in config).
- Send to any contact without first checking the contact belongs to the connected_account being used.
- Strip or modify the user's reply text to "fix" it before sending.

## Crypto helpers

### Signature verification

- Accept raw body (string/Buffer) only.
- Use `crypto.timingSafeEqual` for the final comparison.
- Compute expected signature using HMAC-SHA256 with app secret — confirm app secret comes from env (`META_APP_SECRET`, `TIKTOK_APP_SECRET`).
- Return `false` (not throw) for invalid format; throw only on programmer error.

### Token encryption

- AES-256-GCM with a 96-bit random IV per encryption.
- 32-byte key from env (`TOKEN_ENCRYPTION_KEY`), checked at startup that it's exactly 32 bytes.
- Output includes IV + ciphertext + auth tag (often packed as a single buffer or base64 with delimiters).
- Decryption verifies auth tag; throws on tamper detection.

### State generation

- Cryptographically random — `crypto.randomBytes(32).toString('hex')` or equivalent.
- Stored server-side with TTL (e.g., 10 min) keyed to the session.
- Single-use — consume on validation.

## DB access function (repository)

### Must do

1. **Tenant scoping** — every query has `WHERE user_id = $1` or transitively (`WHERE connected_account_id IN (SELECT id FROM connected_accounts WHERE user_id = $1)`).
2. Use parameterized queries; never string-concatenate user input.
3. Multi-statement operations in transactions.
4. Upserts use `ON CONFLICT` with the documented unique key.
5. Indexes match query patterns — confirm by reading `migrations/` for relevant indexes.

### Must not

- Return raw DB rows that include encrypted token fields outside the repo (decrypt at the boundary).
- Skip tenant scope on "internal admin" reads — admin tools should explicitly opt out via a separate function.

## Contact upsert helper

### Must do

1. `INSERT ... ON CONFLICT (connected_account_id, platform_contact_id) DO UPDATE`.
2. On update, advance `last_seen_at` and `last_inbound_at` to the event's timestamp.
3. Update `display_name` only if non-null in the event (don't overwrite with null).
4. Update `profile_image_url` similarly.
5. Return the contact's `id` (and ideally the full row).

### Must not

- Mutate `is_subscribed` on inbound (subscription state is set by user actions / unsubscribe flows, not by inbound message receipt).
- Reset `custom_fields` or tags.

## AI intent classifier

### Must do

1. Build a prompt with the user message + the list of `(intent_name, examples)` pairs.
2. Use a small/cheap model (Haiku-class) by default.
3. Set a hard timeout (~3s).
4. Return `{intent: string, confidence: number}` or `{intent: null}` for unrecognized.
5. **Cache** by message hash for a short TTL (e.g., 60s) to absorb webhook retries.
6. Log every classification (input, intents, output, confidence) for tuning.

### Must not

- Send PII the user didn't consent to send to a third-party LLM (depends on user's privacy policy — flag if this is a concern).
- Use the LLM's response without confidence-thresholding.

## UI components

### Must do

- Show loading state while fetching data.
- Show empty state when there's no data, with helpful guidance.
- Show error state with a retry path on fetch failure.
- Form fields have `<label>`s and visible focus states.
- Status indicators use text + color, not color alone.
- Optimistic updates roll back on server error.
- Pages requiring auth gate on session before fetching.

### Must not

- Render user-supplied content with `dangerouslySetInnerHTML` without sanitization.
- Hardcode API base URLs (use env / config).
- Block the main thread with synchronous heavy work.
- Trigger re-fetches in render (only in effects/event handlers).

## Cross-cutting checks

These apply to most function types:

- **Logging** at the right level — debug for verbose, info for happy path, warn for unexpected-but-recoverable, error for failures requiring attention.
- **No secrets in logs.** Tokens, API keys, signed URLs, PII — none of these should appear in log output.
- **Timeouts** on every external call (HTTP, DB query in the rare case it could hang, queue operations).
- **Resource cleanup** on the error path — connections returned to pool, files closed, listeners removed.
- **Transactions cover the right boundary** — too narrow and you have inconsistency; too wide and you hold locks too long.
