# Wiring Checks

For each function type, the integration points that must be hit when adding one. If any integration point is missing, the function is half-installed and won't actually run in the system.

For every check below, **search the codebase to confirm**. Use `grep -rn`, ripgrep, or the IDE's find-references — not memory.

## Webhook handler

A new (or modified) webhook handler is wired correctly when:

- [ ] Route registered at the correct path (matches what's configured in the Meta/TikTok app dashboard).
- [ ] Both `GET` and `POST` are exported (GET for verification handshake, POST for events).
- [ ] Signature verifier is imported and called on the raw body before any other work.
- [ ] Contact upsert helper is imported and called on every event with a sender.
- [ ] `message_events` insert is called with `ON CONFLICT DO NOTHING` (idempotency).
- [ ] Queue producer is imported and called to enqueue dispatch.
- [ ] Returns `Response` with status 200 within ~3 seconds.

**Common miss:** the dispatch enqueue is added but the `message_events` insert is forgotten — events get dispatched but the message log is empty, breaking idempotency on retry.

## OAuth callback handler

- [ ] Route registered at the redirect URI configured in the platform app dashboard.
- [ ] State validator is called and the state row consumed (single-use).
- [ ] Token exchange call uses HTTPS, the platform's documented endpoint, and the correct client_id/client_secret pair from env.
- [ ] Token encrypter is imported and called before insert.
- [ ] `connected_accounts` insert/upsert uses `(user_id, platform, platform_account_id)` as the conflict key.
- [ ] Webhook subscription call is made for the new account (Meta only — `POST /{page-id}/subscribed_apps`).
- [ ] Redirect to a logged-in dashboard page on success; render an error page on failure.

**Common miss:** OAuth callback works but the new connected account never receives webhooks because the per-Page `subscribed_apps` call was never made.

## Trigger dispatcher (the orchestrator)

- [ ] Imported and called by the queue worker that consumes `message_events` dispatch jobs.
- [ ] Dispatch order is implemented in this exact sequence: mid-flow check → human takeover check → AI intent (DM only) → keyword/comment/etc. matchers → "no match" log.
- [ ] Each step short-circuits — once a flow is started or human takeover is detected, no further matchers run.
- [ ] Logs every dispatch decision (matched flow id, or "no match", or "skipped: human takeover", or "skipped: mid-flow").

If the user is *modifying* the dispatcher (not replacing), check the modification didn't break the order or the short-circuiting.

## Trigger matcher (per-type)

When adding a new trigger type or a new matcher implementation:

- [ ] Function exported from `lib/triggers/<trigger_type>.ts`.
- [ ] **Registered in the dispatcher** — the dispatcher iterates a list/map of matchers; the new one must be in it. Find this list and confirm.
- [ ] `trigger_type` enum value added to the `flows` table's check constraint AND any TypeScript/Python enum.
- [ ] Schema for `trigger_config` (the JSONB blob) defined and validated — usually a Zod/Pydantic schema. Find it and confirm the new type's config shape is in it.
- [ ] UI configurator added — the rule editor / flow builder must offer this trigger as an option, with form fields for its config. Look in `components/flow-builder/triggers/` or equivalent.
- [ ] Fixture / seed data updated if the project has any (test fixtures often need a representative flow per trigger type).

**Common miss:** the matcher and the dispatcher are wired, but the UI doesn't know how to create a flow with this trigger type. Users can't reach it.

## Flow runner / step executor

When adding a new step type:

- [ ] Executor function exported from `lib/flows/steps/<step_type>.ts`.
- [ ] **Registered in the runner** — runner switches/maps over `step_type`; the new value has a case. Find the map/switch and confirm.
- [ ] `step_type` enum value added to the `flow_steps` table's check constraint AND any TypeScript/Python enum.
- [ ] Schema for the step's `config` blob defined and validated.
- [ ] **Flow builder UI:**
  - Palette item added (left sidebar of the canvas) — `components/flow-builder/palette/`.
  - Node component added — `components/flow-builder/nodes/<step_type>.tsx`.
  - Node registered in the React Flow `nodeTypes` map.
  - Config form added — `components/flow-builder/configs/<step_type>.tsx`.
- [ ] Validator updated — the flow validator checks for orphan nodes, empty messages, etc. New step types may have new validation rules.
- [ ] If the step has a wait-like behavior (sets `wait_until`), the **scheduler** is already general and will pick it up. Confirm the scheduler doesn't have a hardcoded list of waitable step types.

When modifying an existing step executor: check the runner's switch/map still routes to it correctly, and that the config schema covers any new config fields.

## Sender (per platform)

When adding or modifying a sender:

- [ ] Exported from `lib/senders/<platform>.ts`.
- [ ] Registered in the sender facade `lib/senders/index.ts` (or wherever the platform-→-sender map lives) — flow step `send_message` and broadcast workers route through this.
- [ ] **24h window check** is called before the actual send for Meta-family platforms; for outside-window sends, the function accepts and applies a `messageTag` parameter.
- [ ] Token validity check happens (read `connected_account.status`, refuse if not `active`).
- [ ] Outbound `message_events` row is inserted (`direction='outbound'`) with the platform response.
- [ ] Errors are classified and bubbled up:
  - 429 / Meta code 17: throws `RateLimitError` with `retryAfter`.
  - 401 / Meta code 190: throws `AuthError` and triggers `connected_accounts.status = 'expired'` flip.
  - 4xx other: throws `PermanentError`.
  - 5xx / network: throws `TransientError`.

When adding a **new platform**, also confirm:
- [ ] `platform` enum value added to `connected_accounts.platform`.
- [ ] OAuth callback route exists for it.
- [ ] Webhook handler route exists for it.
- [ ] Connect-account UI has a card for it.
- [ ] Platform icon mapping updated (used in many UI places).

## Platform client

- [ ] Single instance / module is the only place HTTP calls to that platform happen.
- [ ] Base URL and API version come from config, not literals.
- [ ] All calls pass through a single `request()` helper that handles retries, timeouts, and logging.
- [ ] No business logic — purely HTTP wrapping.
- [ ] Used by senders, OAuth callbacks, webhook subscribers; **not** used directly by route handlers or UI.

## Scheduler / background worker

- [ ] Triggered correctly:
  - **Cron-style scheduler** — registered in `vercel.json` crons, or equivalent for the host. Confirm the cron schedule matches expected cadence.
  - **Queue consumer** — registered as a consumer of the right queue topic; confirm the topic name matches what producers use.
- [ ] Uses `SELECT ... FOR UPDATE SKIP LOCKED` (or equivalent) when grabbing rows to process — multiple instances must not double-process.
- [ ] Idempotent — if a job runs twice, the result is the same.
- [ ] Updates row state atomically with the action (e.g., advancing `current_step_id` and inserting `message_events` in one transaction).
- [ ] Logs progress and errors at appropriate levels.

For the **wake-delayed-runs scheduler** specifically: query is on `(status, wait_until)`, the index supports it, and runs whose `wait_until` is in the past are advanced before any with `wait_until` in the future.

## DB access function (repository)

- [ ] Takes a `userId` parameter (or `connectedAccountId`, which transitively scopes via FK).
- [ ] Filters every read/write by that scope. **Search the function for the `where` clause** — confirm the scope is in it.
- [ ] If multi-statement, runs in a transaction.
- [ ] Upserts use `ON CONFLICT` with the right unique key (see schema).
- [ ] Indexes exist for the query patterns introduced. Check `migrations/` for matching indexes.
- [ ] Returns typed results, not raw query results.
- [ ] Used by callers via this repo function; nobody bypasses it with raw SQL.

**Common miss:** new repo function exists, but a route still uses inline SQL because no one searched for the inline use.

## Crypto helper

- [ ] `verify*Signature` functions:
  - Take **raw body** (string or Buffer), not parsed JSON.
  - Use `crypto.timingSafeEqual` (or platform equivalent) — never `===` or `==`.
  - Return boolean; throw on missing/malformed input.
  - Read app secret from env, not a literal.
- [ ] Token encryption:
  - Reads encryption key from env (a 32-byte key for AES-256-GCM).
  - Random IV per encryption.
  - Returns `{iv, ciphertext, authTag}` (or a packed buffer).
  - Decryption verifies the auth tag.
- [ ] State generators:
  - Use a CSPRNG (`crypto.randomBytes`).
  - State is stored server-side keyed to the user session.
  - State has an expiry (e.g., 10 minutes).

These functions are used everywhere — confirm they're imported by the right callers (webhook handlers, OAuth callbacks, connected_accounts repo).

## Contact upsert helper

- [ ] Single canonical implementation in `lib/contacts.ts`.
- [ ] Uses `INSERT ... ON CONFLICT (connected_account_id, platform_contact_id) DO UPDATE SET last_inbound_at = ..., last_seen_at = ..., display_name = COALESCE(...)`.
- [ ] Returns the contact's `id`.
- [ ] Imported by every webhook handler — search for inbound webhook routes that *don't* import this and flag them.

## Tag / segment helpers

- [ ] Tag operations call the helper, not raw `contact_tags` SQL.
- [ ] Segment evaluator handles all filter clauses defined in the segment schema; no clause is silently ignored.
- [ ] Audience preview and broadcast-time evaluation use the same evaluator (no risk of preview saying 1000 contacts and send saying 800).

## AI intent classifier

- [ ] Called by the dispatcher in the right step (DM-only, after mid-flow check, before keyword matching).
- [ ] Confidence threshold from `flows.trigger_config` is checked.
- [ ] Cache or rate limit prevents runaway LLM costs.
- [ ] Classifications logged to a table or log stream for tuning.

## UI components

- [ ] Imported and rendered by a parent (page, layout, or another component).
- [ ] If it fetches data, the fetcher is wired to the actual API route (not a placeholder).
- [ ] If it has a form, the submit handler hits a real API route.
- [ ] Routing additions: if the component is at a new URL, the route file exists and links to it have been updated where appropriate.
- [ ] Flow builder additions: see "Flow runner / step executor" above for the full set.
- [ ] Empty / loading / error states are present (or the parent provides them).

**Common miss:** a new page is created at a new URL but no nav link is added — users can't reach it.

## Helpers (uncategorized)

For small generic utilities (date formatting, string normalization, etc.):
- [ ] Used somewhere. If you can't find a single import, the helper is dead code.
- [ ] Consistent with the project's style for that kind of utility.
- [ ] Exported only what's needed (don't widen the public API of a util module).

## Wiring search snippets

When in doubt, run these searches:

```bash
# Where is this function imported / called?
grep -rn "import.*<functionName>" .
grep -rn "<functionName>(" . | grep -v node_modules

# Is this enum value referenced everywhere it should be?
grep -rn "'<new_enum_value>'" .

# Is this route hit from anywhere in the frontend?
grep -rn "/api/<route-path>" .

# Are there places using raw SQL for this entity instead of the repo?
grep -rn "FROM <table>" .
```

State which searches you ran and what they returned.
