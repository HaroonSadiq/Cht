# Smoke Test Recipes

How to exercise each function type end-to-end with realistic input and confirm the expected outcome. Recipes give you: realistic input, pre-state, the call, and post-state assertions.

**Execution preference:** run the actual function (with mocked external dependencies) over tracing through code. State the mode at the top of the smoke test section.

## Setup primitives

### Sample IDs / fixtures

Use these fake-but-realistic IDs throughout smoke tests so anyone reading the report knows it's test data:

```
user_id:                  '00000000-0000-0000-0000-000000000001'
connected_account_id:     '00000000-0000-0000-0000-000000000010'
contact_id:               '00000000-0000-0000-0000-000000000020'
flow_id:                  '00000000-0000-0000-0000-000000000030'
message_event_id:         '00000000-0000-0000-0000-000000000040'

Meta Page ID:             '987654321098765'
Meta PSID:                '1234567890123456'
Meta App Secret (test):   'test_app_secret_do_not_use_in_prod'
Meta Page Token (test):   'EAATestPageToken00000000000000000000'

Instagram Business Account ID:  '17841400000000000'
TikTok open_id:                  'test_open_id_abc123'
```

### Computing a Meta webhook signature for tests

```ts
import crypto from 'node:crypto';

function signMetaPayload(body: string, appSecret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(body).digest('hex');
}
```

Use this to construct realistic `X-Hub-Signature-256` headers.

## Recipe: webhook handler (Meta)

### Inputs

A realistic Messenger inbound DM webhook:

```json
{
  "object": "page",
  "entry": [
    {
      "id": "987654321098765",
      "time": 1735000000000,
      "messaging": [
        {
          "sender": { "id": "1234567890123456" },
          "recipient": { "id": "987654321098765" },
          "timestamp": 1735000000000,
          "message": {
            "mid": "m_fake_message_id_01",
            "text": "what's the price?"
          }
        }
      ]
    }
  ]
}
```

Compute `X-Hub-Signature-256` over this exact JSON string with the test app secret.

### Pre-state

- `connected_accounts` row exists for Page `987654321098765`, status `active`.
- No `contacts` row for PSID `1234567890123456` yet.
- No prior `message_events` for `mid` `m_fake_message_id_01`.

### The call

```ts
const rawBody = JSON.stringify(payload);
const sig = signMetaPayload(rawBody, process.env.META_APP_SECRET!);

const req = new Request('https://example.com/api/webhooks/meta', {
  method: 'POST',
  headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' },
  body: rawBody,
});

const res = await POST(req);
```

### Post-state assertions

- `res.status === 200`.
- One new `contacts` row exists with `(connected_account_id=10..., platform_contact_id='1234567890123456')`, `last_inbound_at` ≈ now.
- One new `message_events` row exists with `platform_message_id='m_fake_message_id_01'`, `direction='inbound'`, `channel='dm'`, `message_text="what's the price?"`.
- A dispatch job was enqueued (check the queue mock or the producer's call log).

### Negative paths

- **Bad signature:** call again with a tampered body but old signature → `res.status === 401`, no DB rows inserted, no jobs enqueued.
- **Replay:** call again with the same body+signature → `res.status === 200`, contact's `last_seen_at` may update, but no new `message_events` row, no new dispatch job (idempotency).
- **Missing Page:** call with a payload for a Page ID we don't have a `connected_account` for → handler returns 200 (don't 500), logs "unknown page", inserts nothing.

## Recipe: trigger dispatcher

### Inputs

A `message_event` ID for a freshly-inserted inbound message.

### Pre-state

- `message_events` row exists, `triggered_flow_run_id IS NULL`.
- `flows` table has 3 active flows for the connected_account:
  1. keyword `contains 'price'`, priority 100.
  2. keyword `exact 'hello'`, priority 50.
  3. ai_intent `pricing_inquiry`, threshold 0.7, priority 200.
- Contact has no `waiting_for_reply` runs and `is_human_takeover = false`.

### The call

```ts
await dispatch(messageEventId);
```

### Post-state assertions

- One `flow_runs` row was created for flow #1 (the keyword `contains 'price'` flow) — it wins because the ai_intent flow has lower priority and the `'hello'` flow doesn't match.
- `message_events.triggered_flow_run_id` is set to the new run.
- A "step run" job was enqueued for the new run.
- Dispatch decision logged (matched flow id).

### Negative paths

- **Mid-flow:** pre-create a `flow_runs` row with `status='waiting_for_reply'` for this contact. Run dispatch. Verify: no new flow started; the existing run was resumed (status='active', `last_user_reply` set in context, step job enqueued).
- **Human takeover:** pre-set `contacts.is_human_takeover = true`. Run dispatch. Verify: no flow started, decision logged as "skipped: human takeover".
- **No match:** make all flows fail to match (e.g., message text is `'asdfqwerty'`). Verify: no flow started, decision logged as "no match", `message_events.triggered_flow_run_id` remains NULL.

## Recipe: trigger matcher (e.g., keyword)

### Inputs

- A message: `'how much does it cost?'`
- A list of flows of type `keyword` with various `match_type` and `patterns`.

### Pre-state

Three flows in DB / fixtures:
1. `match_type='contains', patterns=['price','cost'], channel='dm', priority=100, is_active=true`.
2. `match_type='exact', patterns=['hello'], channel='dm', priority=50, is_active=true`.
3. `match_type='contains', patterns=['cost'], channel='dm', priority=10, is_active=false`. *(inactive)*

### The call

```ts
const matched = await matchKeyword({ messageText: 'how much does it cost?', connectedAccountId, channel: 'dm' });
```

### Post-state assertions

- Returns flow #1.
- Flow #2 doesn't match (text isn't exactly 'hello').
- Flow #3 isn't returned (inactive).
- If priorities are tied, returns the most recently updated.

### Negative paths

- **No match:** message `'random text'` → returns null.
- **Channel filter:** same flows but call with `channel='comment'` → no match.
- **Regex timeout:** add a flow with a catastrophic regex (`/(a+)+$/`) and a long `'aaaaaaaaaaaaaaa!'` input. Verify the matcher times out at 100ms and returns no match — does not hang.

## Recipe: flow runner / step executor (`send_message`)

### Inputs

A `flow_run` ID whose `current_step_id` points to a `send_message` step with content `Hi {{contact.first_name}}, our price is $X.`.

### Pre-state

- `flow_runs` row, `status='active'`.
- `flow_steps` row of type `send_message`, config has the template above.
- `contacts` row with `display_name='Test User'`, `last_inbound_at` 5 minutes ago (within 24h window).
- `connected_accounts` row, `status='active'`, valid encrypted token.

### The call

```ts
await runStep(flowRunId);
```

### Post-state assertions

- Sender was called with the rendered text `'Hi Test User, our price is $X.'`, the contact's `platform_contact_id`, `messaging_type='RESPONSE'`.
- The platform API mock was hit at `POST /<page-id>/messages` with the right body shape.
- One new `message_events` row inserted: `direction='outbound'`, status='sent'.
- `flow_run.current_step_id` advanced to the next step (or `status='completed'` if the step had no next).

### Negative paths

- **Outside 24h window:** set `last_inbound_at` to 25 hours ago. Verify: send is skipped, `message_events` row inserted with `status='skipped: outside_24h_window'`, no platform call made, run still advances to next step (or alternatively the run errors — depends on policy).
- **Auth error:** mock platform to return error code 190. Verify: `connected_accounts.status` flipped to `'expired'`, `message_events.status='failed'`, run errored.
- **Rate limit:** mock platform to return 429 with `retry-after: 30`. Verify: `RateLimitError` thrown by sender; the worker re-enqueues with the right delay; run not advanced yet.

## Recipe: flow runner / step executor (`wait_for_reply`)

### Inputs

A `flow_run` whose current step is `wait_for_reply` with `timeout_hours=24`.

### Pre-state

- `flow_runs.status='active'`, no `wait_until`.

### The call

```ts
await runStep(flowRunId);
```

### Post-state assertions

- `flow_runs.status='waiting_for_reply'`.
- `flow_runs.wait_until` ≈ now + 24h.
- No step job enqueued (the runner shouldn't re-enqueue itself).
- `current_step_id` is still the same `wait_for_reply` step (didn't advance).

### Resumption test

Now simulate the contact replying. Use the dispatcher recipe above with this contact:

- Verify the dispatcher's mid-flow check finds the waiting run.
- Verify `flow_runs.status` becomes `'active'`, `wait_until=NULL`.
- Verify `flow_runs.context.last_user_reply` is set to the message text.
- Verify a step job was enqueued for `next_step_id`.

### Timeout test

- Set `wait_until` to a past time.
- Run the wait-timeout scheduler.
- Verify: run is advanced to `on_timeout_next_step` (or ended), step job enqueued.

## Recipe: sender (Meta)

### Inputs

A `connected_account_id`, a `contact_id`, and a rendered message body.

### Pre-state

- Contact `last_inbound_at` 1 hour ago (within window).
- `connected_account.status='active'`, encrypted token decrypts to valid test value.

### The call

```ts
await sendMessageMeta({
  connectedAccountId,
  contactId,
  content: { text: 'Hello, Test User.' },
});
```

### Post-state assertions

- HTTP mock observed: `POST https://graph.facebook.com/v<version>/<page-id>/messages` with body containing `recipient.id = <PSID>`, `messaging_type = 'RESPONSE'`, `message.text = 'Hello, Test User.'`. Authorization header has `Bearer <decrypted token>`.
- One new `message_events` row, direction='outbound', status='sent', `platform_response` field has the mock's response body.

### Negative paths

- **Outside window, no tag:** set last_inbound_at to 25h ago. Verify: function throws/returns skipped; no HTTP call; `message_events` row with `status='skipped'`.
- **Outside window, with tag:** call with `messageTag='ACCOUNT_UPDATE'`. Verify: HTTP call happens with `messaging_type='MESSAGE_TAG'` and the tag.
- **Token expired:** mock 401/code 190. Verify: `connected_accounts.status` → 'expired'; `message_events` row with `status='failed'`; AuthError thrown.
- **Rate limit:** mock 429 with `Retry-After: 30`. Verify: RateLimitError thrown with retryAfter=30; one `message_events` row with `status='failed'`.

## Recipe: OAuth callback (Meta)

### Inputs

Query params: `code='test_code'`, `state='<valid stored state>'`.

### Pre-state

- A state row exists in the OAuth state store, keyed to the test session.
- HTTP mocks for `/oauth/access_token` (returns short-lived token), the long-lived exchange (returns long-lived token), and `/me/accounts` (returns one Page with a Page token).

### The call

```ts
const res = await GET(new Request(`https://example.com/api/auth/facebook/callback?code=test_code&state=<state>`));
```

### Post-state assertions

- State row consumed (deleted).
- `connected_accounts` row inserted/updated with `platform='facebook'`, `platform_account_id=<page id>`, encrypted token (decrypts to the page token from the mock), `status='active'`.
- A subscribe call was made to `/<page-id>/subscribed_apps` with `subscribed_fields=messages,messaging_postbacks,...`.
- Response is a redirect to a logged-in dashboard URL.

### Negative paths

- **State missing/invalid:** call with no state or wrong state. Verify: 400 response, no DB writes.
- **Code exchange fails:** mock the token endpoint to return an error. Verify: friendly error rendered, no DB writes, state row consumed (so it can't be retried with same state).
- **No Pages returned:** mock `/me/accounts` to return empty. Verify: friendly error, no `connected_accounts` row.

## Recipe: contact upsert helper

### Inputs

`(connected_account_id, platform_contact_id, display_name, event_timestamp)`.

### Pre-state — first call

- No existing `contacts` row.

### The call

```ts
const contactId = await upsertContactOnInbound({ ... });
```

### Post-state assertions

- New row created. `first_seen_at`, `last_seen_at`, `last_inbound_at` all ≈ event_timestamp.

### Pre-state — second call

- Row from first call still there.

### The call again

Same inputs but `display_name` updated and timestamp 5 minutes later.

### Post-state assertions

- Same row id (no duplicate row).
- `display_name` updated.
- `last_seen_at` and `last_inbound_at` advanced.
- `first_seen_at` unchanged.

## Recipe: AI intent classifier

### Inputs

A message and a list of intents.

### Pre-state

- LLM API mock that returns a deterministic response based on input.

### The call

```ts
const result = await classifyIntent({
  message: 'how much does this cost',
  intents: [
    { name: 'pricing_inquiry', examples: ['what is the price', 'how much'] },
    { name: 'support_request', examples: ['help', 'I have a problem'] },
  ],
});
```

### Post-state assertions

- Returns `{ intent: 'pricing_inquiry', confidence: <number> }`.
- Classification logged.
- Cache populated with the message hash (verify by calling again with same message and checking the LLM mock wasn't hit twice).

### Negative paths

- **Low confidence:** classifier returns 0.5 confidence. Verify: returns `{intent: null}` if threshold is 0.7.
- **LLM timeout:** mock the LLM to delay past timeout. Verify: returns `{intent: null}`, doesn't hang the dispatcher.
- **LLM error:** mock the LLM to throw. Verify: function returns `{intent: null}` (graceful fallback to keyword matching).

## Recipe: scheduler (wake-delayed-runs)

### Pre-state

- Three `flow_runs` rows:
  1. `status='active', wait_until=now()-1min` (should be picked up).
  2. `status='active', wait_until=now()+1hour` (should NOT be picked up).
  3. `status='completed', wait_until=now()-1min` (should NOT be picked up — wrong status).

### The call

```ts
await wakeDelayedRuns();
```

### Post-state assertions

- Run #1's `wait_until` is NULL, status still 'active', a step job enqueued.
- Runs #2 and #3 unchanged.

## Recipe: UI component (rule editor form)

### Inputs

User filling in fields and clicking Save.

### Pre-state

- Render the `<RuleEditor connectedAccountId="..." />` in a test environment (Vitest + React Testing Library, Playwright, etc.).

### The call

Simulate user actions: select trigger type, type patterns, type reply, click Save.

### Post-state assertions

- POST request fires to the right API endpoint with the right body shape.
- On success, redirected to the rules list (or success state shown).
- On validation error from server, error displayed inline.
- On network error, retry option visible.
- Form state preserved on validation failure (don't clear the user's typing).

## Recipe: helper (small utility)

For uncategorized helpers, do a basic functional smoke test:

- A few inputs covering normal cases.
- Edge cases: empty, null/undefined, very large, special characters.
- Confirm output type matches what callers expect.

If the helper is pure and small, a mental trace is acceptable; otherwise run it.

## When you can't run the smoke test

If the project lacks a test runner / DB / mocks and you can't execute, do a **manual trace**:

1. Walk through the function line by line with a specific input in mind.
2. State the value of each relevant variable after each line.
3. Note every external call and what it would return (assume happy path, then negative paths).
4. State the final state and what's been changed externally.

Be explicit that this is a trace, not an execution: *"I'm tracing through manually because no test runner is configured. Assumptions: ..."*. Findings from a trace are real but lower confidence than execution.

## Reporting smoke test results

In the report, structure each scenario like:

```
**Scenario: <name>**

Inputs: <key params>
Result: <what happened>
Verdict: ✅ passed (all assertions held)
       | ❌ failed: <which assertion failed>
       | ⚠️  partial: <what passed, what didn't>
```

Don't over-summarize. The user wants enough detail to verify your verdict; if you say "✅ passed", show the post-state that proves it.
