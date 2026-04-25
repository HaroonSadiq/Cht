# Architecture

Everything that isn't platform-specific lives here: the matching engine, the reply worker, queueing, retries, security, multi-tenancy.

# Architecture

Everything that isn't platform-specific lives here: trigger dispatch, the send worker, contacts and tags, broadcasts, queueing, retries, security, multi-tenancy.

## Trigger dispatch

The trigger dispatcher is what runs when an inbound event (message, comment, new follow, story reply, postback, ref-URL click) is received. Its job: decide which flow, if any, to start for this contact.

### Dispatch order

The order matters — each step can short-circuit.

1. **Is this contact mid-flow?** If an active `flow_runs` row exists with `status='waiting_for_reply'` for this contact, **do not** start a new flow — instead, resume that run with this message as the user's reply. See `references/flows.md` → "Handling incoming replies mid-flow."
2. **Is this contact in human takeover mode?** If yes, no flow fires; message is logged and appears in the inbox for a human to handle.
3. **Does the event match an `ai_intent` flow?** For DMs only: classify via LLM, and if confidence ≥ threshold, start that flow.
4. **Does the event match a `keyword`/`comment`/`story_reply`/etc. flow?** Apply filters on channel, post IDs, patterns.
5. Of the matching flows from steps 3–4, pick lowest `priority`, tiebreak by most recently updated.
6. If none match, log `matched_flow_id = null` on the message event and stop.

Log every dispatch decision (including "no match" and "skipped because mid-flow") — this is the #1 thing business owners ask about when debugging.

### Trigger matching primitives

For `keyword` triggers, the match types are:

- **`exact`** — normalized text equals one of the patterns. Normalize by lowercasing, trimming, collapsing whitespace.
- **`contains`** — normalized text contains one of the patterns as a substring.
- **`keyword_any`** — any of the patterns appears as a whole word (`\b<pattern>\b` regex, case-insensitive).
- **`regex`** — the pattern is a regex matched against the raw text. **Timeout every regex at 100ms** to prevent catastrophic backtracking from a user-supplied pattern.

## Send worker

The send worker is a background job invoked when a flow step of type `send_message` executes (or from a broadcast, or from the live inbox). Its job: deliver one message to one contact, respecting platform rules.

### Per-send checklist

1. Load the `connected_account`, `contact`, and the rendered message content.
2. **Check token validity.** If `connected_account.status != 'active'` or token is expired, fail the send with status `skipped: account_not_active`.
3. **Check the 24-hour window** (Meta only). If `contact.last_inbound_at` is within 24h, proceed with `messaging_type: 'RESPONSE'`. If outside, check if the send was explicitly tagged (flow step or broadcast opted into a `MESSAGE_TAG`). If neither, fail with `skipped: outside_24h_window`.
4. **Render variables** in the message content from the contact's fields and the flow run's context.
5. **Call the platform API** to send.
6. **Parse the response.** Classify:
   - Success (2xx): insert `message_events` row with `direction='outbound'`, status='sent'.
   - Rate limit (429 or Meta `code 17`): requeue with backoff, respect `Retry-After`.
   - Auth error (`code 190`): flip `connected_account.status` to `expired`, don't retry, alert.
   - Scope error (`code 200`): don't retry, log permission name, alert.
   - Permanent error (invalid recipient, etc.): don't retry, log, move on.
   - Transient (5xx, network): retry with exponential backoff up to N times.
7. Update the contact's `last_outbound_at` if you track it.

Keep the worker stateless and horizontally scalable.

### Rate limiting

Track platform rate limit headers (`x-app-usage`, `x-page-usage`) and proactively slow down when approaching 80% capacity. Per-connected-account token buckets help smooth bursts from broadcasts.

## Contacts and tags

### Upsert on every inbound

Every webhook event that includes a sender does:

```sql
INSERT INTO contacts (connected_account_id, platform_contact_id, display_name, first_seen_at, last_seen_at, last_inbound_at)
VALUES (...)
ON CONFLICT (connected_account_id, platform_contact_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  last_seen_at = EXCLUDED.last_seen_at,
  last_inbound_at = EXCLUDED.last_inbound_at
RETURNING id;
```

Then use the returned `id` for the `message_events.contact_id` and for any flow dispatch. Contacts are scoped to a `connected_account_id`, not a user — the same person messaging two of a user's Pages is two contact rows (because the PSID is per-Page).

### Tags

Tags belong to the user (the business owner), not the connected account — the same tag can apply to contacts across multiple Pages. The `contact_tags` table is the join.

Adding and removing tags:

- From a flow step (`add_tag`/`remove_tag`): happens inline during flow execution.
- From the inbox UI (human applies a tag manually): write through the contacts API.
- From import (CSV): batch insert with `applied_by='import'`.

### Custom fields

`contacts.custom_fields` is a jsonb blob for business-defined data: `{ "plan": "pro", "order_count": 3, "last_product": "Widget" }`. Updated by `set_field` flow steps and by HTTP-request steps that save API responses. Used in message templates (`{{contact.custom_fields.plan}}`) and as branch conditions.

### Segmentation

A **segment** is a stored filter over contacts: `tags IN (...)`, `custom_fields.X = Y`, `last_inbound_at BETWEEN ... AND ...`, etc. Used by broadcasts and scheduled flows. Store segment definitions as a small table:

```
segments
  id, user_id, name, filter (jsonb), created_at, updated_at
```

Materialize the contact list lazily — a broadcast's "audience preview" runs the filter at preview time and again at send time (contacts change between the two).

## Broadcasts

A broadcast sends one message to many contacts matching a segment.

### Sending a broadcast

1. User composes the broadcast: picks a connected account, writes the message, picks a segment (or creates one inline), optionally schedules it.
2. On schedule/send:
   - Resolve the segment to a contact list.
   - For each contact, check 24-hour window compliance. If the broadcast is tagged with a `MESSAGE_TAG`, all contacts are eligible; otherwise, only contacts within 24h window are eligible. Show the skipped count clearly in the UI.
   - Enqueue one send job per eligible contact.
   - Update `broadcasts.stats` as sends complete.

### Rate limiting broadcasts

Never fan out a broadcast at full speed — you'll trip platform rate limits on the first large send. Cap per-account send rate (e.g., 10/sec), spread the broadcast over minutes, and respect the `x-page-usage` header.

### Progress UI

Business owners want to see "1,234 / 5,000 sent, 12 failed" in near-real-time. Store aggregate counters in `broadcasts.stats` and update on each send completion.

## Queue choice

For Next.js on Vercel, good options in order:

1. **Upstash QStash** — HTTP-based queue, works well with serverless webhook handlers. The webhook handler enqueues a QStash message; QStash later calls a separate Next.js route that runs the flow step or send worker.
2. **Inngest** — gives you typed events, retries, and observability out of the box. Great developer experience for the flow execution engine specifically.
3. **BullMQ + Redis** — if running on a traditional Node host with long-running workers.

Avoid doing send work inline in the webhook handler. Meta will retry webhooks that take too long, which cascades into duplicate flow runs and duplicate messages.

## Idempotency

Every webhook event has a platform-provided ID (`message_id`, `comment_id`). Use it as a unique key in `message_events`:

```sql
UNIQUE (connected_account_id, platform_message_id)
```

On webhook receipt, `INSERT ... ON CONFLICT DO NOTHING` and only dispatch triggers if the insert actually created a new row.

For flow dispatch, add a unique constraint:

```sql
UNIQUE (flow_id, contact_id, triggered_by_message_event_id)
```

on `flow_runs`, so the same message can't start the same flow twice even if retried. For sends, the send worker checks if a prior `message_events (direction='outbound')` row exists for this (flow_run, step) before calling the API.

## Security

### Token encryption at rest

Never store access tokens in plain text. Options:

- **Postgres `pgcrypto`:** `PGP_SYM_ENCRYPT(token, key)`. Key comes from a secret manager (Vercel env, AWS Secrets Manager, Doppler, etc.).
- **Application-layer:** encrypt with Node's `crypto` (AES-256-GCM) before insert, decrypt on read. Store the IV alongside the ciphertext.

Either way, the encryption key must not live in the database or the repo. Rotate keys on a schedule — envelope encryption (encrypting a per-row data key with a master key) makes rotation cheap.

### Webhook signature verification

Every webhook handler must verify the platform's signature on the **raw request body**, in **constant time**, before trusting anything. A framework that parses JSON before giving you the raw body will break this — capture the raw body explicitly.

In Next.js App Router:

```ts
// app/api/webhooks/meta/route.ts
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifySignature(rawBody, signature, process.env.META_APP_SECRET!)) {
    return new Response('invalid signature', { status: 401 });
  }
  const payload = JSON.parse(rawBody);
  // ...
}
```

`verifySignature` should use `crypto.timingSafeEqual`.

### CSRF on OAuth callback

The `state` parameter in the OAuth redirect is required. Generate a cryptographically random value, store it server-side (session or short-lived DB row) keyed to the user, and verify it matches on callback. Reject the callback if state is missing or mismatched.

### Multi-tenancy / data isolation

Every query that reads or writes `connected_accounts`, `trigger_rules`, `message_events`, or `reply_events` must scope by the calling user's `user_id`. Easy ways to enforce this:

- **Application-layer:** every data-access function takes a `userId` and includes it in the `WHERE` clause. Code reviews catch violations.
- **Row-Level Security in Postgres:** enable RLS on each table and write policies that restrict by `user_id = current_setting('app.current_user_id')::uuid`. Set the setting at the start of each request. Stronger — makes it impossible to query across tenants even if a bug slips through.

For a platform this small, application-layer is fine. For a platform that grows or needs compliance, add RLS.

### Secrets

App secrets, encryption keys, OAuth client secrets all live in environment variables pulled from a secret manager. Never log a token, even partially (first/last 4 chars is acceptable for debugging).

## Retries, backoff, dead-letter

Reply worker retry policy:

- **Transient error:** retry after 1s, 5s, 30s, 2m, 10m (exponential-ish). After 5 failures, move to dead-letter and alert.
- **Rate limit (429):** respect `Retry-After` if present, else back off more aggressively. Optionally slow down all workers for that connected account.
- **Permanent error:** don't retry. Log and move on.

Dead-letter = a table `failed_reply_events` or the existing `reply_events` with `status='failed'` and a flag for "needs human attention." Show it in the dashboard.

## Observability

- Every webhook received → log (info level).
- Every match decision (matched rule ID or "no match") → log.
- Every reply attempt → log with platform response.
- Structured logs (JSON), not strings — you'll want to query them.
- Metrics: events received per account per hour, replies sent, match rate, error rate by type. Even a simple Postgres `COUNT` view powers a dashboard.

## Data retention

Incoming messages may contain personal info. Decide a retention policy (e.g., "we keep `message_events` for 90 days, then delete the `message_text` but keep the metadata for analytics"). Mention this in the privacy policy — required for Meta App Review anyway.
