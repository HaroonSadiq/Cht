# Flows

A **flow** is a directed graph of steps that executes per-contact when triggered. This is the core primitive of the platform — a simple "trigger keyword → reply once" is just a flow with one `send_message` step. A ManyChat-style "welcome new follower → send greeting → wait 2 hours → ask a question → branch on their answer → tag them → send follow-up" is a flow with eight steps. Same data model, same execution engine.

## Why a flow, not a rule

If you model "trigger → one reply" as a hardcoded rule, you ship fast but hit a wall within weeks:

- Users want to send two messages in a row with a delay → rule can't.
- Users want to ask a question and branch on the answer → rule can't.
- Users want to tag the contact when a rule fires → rule can't.
- Users want AI intent routing instead of keyword match → rule can't.

Modeling as flows from day one lets all of these ship as new step types or new trigger types, without a rewrite. The **simple-rule editor** in the UI is just a shortcut that produces a one-step flow — it's a UX affordance, not a different backend concept.

## Trigger types

A flow's `trigger_type` + `trigger_config` determines when it starts for a contact:

- **`keyword`** — inbound DM or comment matches a pattern. `trigger_config = { channel: 'dm'|'comment'|'both', match_type: 'contains'|'exact'|'keyword_any'|'regex', patterns: [...] }`
- **`comment`** — any new comment on specified (or all) posts. Used for comment-to-DM growth tools. `trigger_config = { post_ids: [...] | 'all', open_to_dm: true }`
- **`story_reply`** — IG story reply. `trigger_config = { story_ids: [...] | 'all' }`
- **`story_mention`** — someone mentions the business in their IG story.
- **`new_follow`** — new follower (IG). Used for follow-to-DM.
- **`ref_url`** — user clicks a `m.me/<page>?ref=<code>` or `ig.me/<page>?ref=<code>` link. `trigger_config = { ref_code: '<code>' }`.
- **`manual`** — staff manually starts this flow for a contact from the inbox.
- **`scheduled`** — runs on a schedule for contacts matching a filter (e.g., "3 days after last_inbound_at, message anyone tagged 'prospect' outside the 24h window → requires a valid message tag").
- **`ai_intent`** — an incoming message is classified by an LLM as matching a named intent. See "AI intent triggers" below.

Multiple flows can match the same incoming event. Resolution is by lowest `priority` number, tiebreak by most recently updated. Log the decision (matched flow ID, or "no match") on the `message_event`.

## Step types

Each step is a row in `flow_steps`. The `step_type` determines what it does; `config` carries the parameters.

### `send_message`
Send a message to the contact. `config = { content: { text: string, buttons?: [...], attachments?: [...], quick_replies?: [...] } }`. See `references/frontend-patterns.md` → "Rich message composer" for content shape. Rendered with variable substitution: `{{contact.first_name}}`, `{{contact.custom_fields.order_id}}`, `{{flow.context.user_reply}}`.

### `wait_for_reply`
Pause the flow until the contact sends a reply (or a timeout). `config = { timeout_hours: number, on_timeout_next_step: uuid | null }`. When the contact replies, the reply text goes into `flow_runs.context.last_user_reply` and the flow resumes at `next_step_id`. If they don't reply within `timeout_hours`, route to `on_timeout_next_step` (or end the flow).

### `delay`
Wait a fixed duration, then continue. `config = { duration_minutes: number }`. Sets `flow_runs.wait_until = now() + duration`; a scheduler picks up ready runs and advances them.

### `branch`
Route to one of N next steps based on a condition. `config` is unused; `branches` column is:
```
[
  { condition: { type: 'contact_has_tag', tag_id: '...' }, next_step_id: '...' },
  { condition: { type: 'user_reply_matches', match_type: 'contains', patterns: ['yes'] }, next_step_id: '...' },
  { condition: { type: 'custom_field_equals', field: 'plan', value: 'pro' }, next_step_id: '...' },
  { condition: { type: 'default' }, next_step_id: '...' }
]
```
Evaluate in order; first match wins. Always include a `default` branch or the flow errors on no-match.

### `add_tag` / `remove_tag`
`config = { tag_id: '...' }`. Inserts/deletes a row in `contact_tags`. Instant; no pause.

### `set_field`
Set a custom field on the contact. `config = { field: string, value: string | '{{template}}' }`. Updates `contacts.custom_fields`.

### `http_request`
Call an external API. `config = { method, url, headers, body_template, save_response_to_field?: string }`. Response body is stored in `flow_runs.context.http_response_data` for later steps to reference. Wrap in timeout + retry. This is how users integrate with their CRM, Zapier, etc.

### `handoff_to_human`
Mark the contact's conversation as `human_takeover`. From this point, the flow runner stops auto-responding to this contact until a human clears the flag from the inbox. `config = { notify_team: bool, assign_to_user_id?: uuid }`.

### `end_flow`
Explicit terminator. Sets `flow_runs.status = 'completed'`. Optional — reaching a step with `next_step_id = null` is also a clean end.

## The execution engine

The flow runner is a state machine keyed on `flow_runs.id`. One row per (contact × flow trigger event).

### Starting a run

When a trigger dispatches a flow for a contact:

1. Check if an active `flow_runs` row already exists for this (contact, flow). If so — depending on the flow's re-entry policy (config field `restart_if_active: bool`) — either skip, cancel the existing run and start fresh, or ignore. Default: skip.
2. Insert a new `flow_runs` row with `status='active'`, `current_step_id = <flow's first step>`.
3. Enqueue a `run_step` job for this run.

### Running a step

The worker picks up the job and:

1. Loads the run + current step + contact in one transaction.
2. Executes the step by type:
   - `send_message`: render template, enqueue a send job (the send worker handles rate limits and the 24h window). Advance to `next_step_id` and enqueue `run_step` again.
   - `wait_for_reply`: set `status='waiting_for_reply'` and `wait_until = now() + timeout_hours`. Don't enqueue anything.
   - `delay`: set `wait_until = now() + duration_minutes`. Don't enqueue anything; a scheduler picks it up.
   - `branch`: evaluate conditions, pick `next_step_id`, enqueue `run_step`.
   - `add_tag`/`remove_tag`/`set_field`: do the DB write, advance, enqueue.
   - `http_request`: call the API, save the response to context, advance, enqueue.
   - `handoff_to_human`: mark contact, set `flow_runs.status='active_human'`, don't advance.
   - `end_flow` or `next_step_id = null`: set `status='completed'`, `completed_at = now()`.
3. Commit.

Keep step execution transactional. If the worker crashes mid-step, restarting should be safe — either the step completed and advanced (next worker picks up from the new `current_step_id`) or it didn't (next worker retries the same step).

### Waking up delayed/waiting runs

A scheduler runs every 30 seconds and does:

```sql
UPDATE flow_runs
SET status = 'active', wait_until = NULL
WHERE status = 'active' AND wait_until IS NOT NULL AND wait_until <= now()
RETURNING id;
```

For each returned row, enqueue a `run_step` job. (Use `SKIP LOCKED` if you run multiple schedulers.)

For `wait_for_reply` runs that time out:

```sql
SELECT id, on_timeout_next_step FROM flow_runs
WHERE status = 'waiting_for_reply' AND wait_until <= now();
```

Advance each to `on_timeout_next_step` (or end) and enqueue.

### Handling incoming replies mid-flow

When an inbound message arrives for a contact with a `waiting_for_reply` run:

1. Upsert the contact (update `last_inbound_at`).
2. Insert `message_event`.
3. **Before** dispatching to the trigger matcher, check if there's a `waiting_for_reply` run for this contact. If yes:
   - Store the message text in `flow_runs.context.last_user_reply`.
   - Set `status='active'`, `wait_until=NULL`.
   - Enqueue `run_step` to resume.
   - **Do not** dispatch this message to other flow triggers — the user is mid-conversation.
4. If no waiting run, normal trigger matching proceeds.

This is essential. Without it, a user mid-flow who says "yes" to "Do you want pricing info?" could also fire a keyword trigger for "yes" and start a second flow, and they'd get two conflicting messages.

### Human takeover

When a contact is in `human_takeover` mode (either via a `handoff_to_human` step or a manual flag from the inbox):

- No flow triggers fire for this contact.
- Incoming messages still upsert the contact and insert `message_events`, so they show up in the inbox.
- The human operator uses the inbox to reply.
- When the operator clears the human-takeover flag, flows become active for that contact again.

Show this clearly in the inbox UI — a toggle on each conversation: "Bot" / "Human only."

## AI intent triggers

Keyword matching is brittle. "What does this cost?" doesn't match the keyword "price" even though it obviously should. Modern platforms offer **intent matching**: the user defines named intents with examples, and an LLM classifies each incoming message.

### Data shape

Add to `flows`:
- `trigger_type = 'ai_intent'`
- `trigger_config = { intent_name: 'pricing_inquiry', examples: ['how much does it cost', 'what are your rates', 'pricing?', 'is there a fee'], confidence_threshold: 0.7 }`

### Dispatch

On every inbound DM (not comments — too noisy for LLM cost), before or alongside keyword matching:

1. Collect all active flows with `trigger_type = 'ai_intent'` for this connected account.
2. Call an LLM classifier with the message + the list of intents (name + examples).
3. Classifier returns `{ intent: 'pricing_inquiry', confidence: 0.85 }` or `{ intent: null }`.
4. If confidence ≥ the flow's threshold, start that flow.
5. If no intent matches, fall through to keyword matching.

Models: a small classifier (e.g., Haiku-class) is cheap and fast enough. Cache recent classifications per message to avoid reclassifying on retries. Log every classification decision for tuning.

### Hybrid: keyword + intent

Best of both. Keep keyword flows for precise control ("exactly the word `refund` → start refund flow"). Use AI intents for fuzzy user intent ("anything sounding like they want pricing → start pricing flow"). Keyword trumps intent if both match.

### Guardrails

- Confidence threshold configurable per flow; default 0.7 is a reasonable start.
- Always log the classification. Business owners will want to see "this message was classified as X with 0.62 confidence (below your 0.7 threshold), so no flow fired" when debugging.
- Add a "Test intent" tool in the flow editor where the user can paste test messages and see the classification live.
- Consider monthly classification quotas per tier — this is a real cost.

## Gotchas

- **Don't execute flows inline with the webhook.** Webhook returns 200 fast; flow execution happens in the worker.
- **Don't run multiple flows concurrently for one contact per trigger event.** Dispatch picks one flow; the rest are skipped.
- **Idempotency on run start.** If the same webhook event delivers twice and you dispatch both, the first insert of `flow_runs (flow_id, contact_id, triggered_by_message_event_id)` should have a unique key so the second one no-ops.
- **Large flows with many waits need a lot of DB rows.** A flow with 10 steps × 10,000 active contacts = 100,000 `flow_runs` rows. Index `(status, wait_until)` or the scheduler scan gets slow.
- **Context size.** `flow_runs.context` is a jsonb blob that grows with each step's captured data. Cap it (e.g., 16KB) or truncate older entries — otherwise it balloons on long flows with many HTTP responses.

## Simple-rule UI, flow backend

The UX tension: power users want the canvas flow builder; beginners want "when someone says X, reply Y" in 10 seconds. Offer both:

- The **simple-rule editor** is a form (see `references/frontend-patterns.md` → "Simple-rule editor"). On save, it persists a `flows` row with `trigger_type='keyword'` and a single `flow_steps` row of type `send_message`. In the list view, tag it as "Simple" and offer "Convert to flow" to switch to the canvas.
- The **flow builder** is the full canvas for multi-step flows. See `references/frontend-patterns.md` → "Visual flow builder".

Both produce rows in the same `flows`/`flow_steps` tables. The backend doesn't know the difference.
