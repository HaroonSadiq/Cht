# Function Taxonomy

Every function type in the social-media-autoreply project, organized by layer. For each: what it does, where it lives, what calls it, what it calls.

The taxonomy below is the same regardless of the user's chosen tech stack — file paths assume the default Next.js layout, but the categories apply equally to a different framework.

## Backend layers

The backend has these layers, from outer to inner:

```
External event → Webhook handler → Queue → Trigger dispatcher → Flow runner → Step executor → Sender → Platform API
                                                                                        ↑
                                                                                   DB access
                                                                                        ↑
                                                                                  Crypto helpers
```

## Webhook handlers

**What:** Public HTTP endpoints that receive events from Meta or TikTok. Verify signature, upsert contact, insert `message_events`, enqueue dispatch.

**Default location:** `app/api/webhooks/meta/route.ts`, `app/api/webhooks/tiktok/route.ts`.

**Called by:** the platform itself (Meta or TikTok, hitting the public URL).

**Calls:** signature verifier, contact upserter, `message_events` insert, queue producer.

**Subtypes:**
- **Meta webhook handler** — handles both Messenger (FB) and Instagram events; same endpoint or split, depending on app config. Also handles the GET verification handshake.
- **TikTok webhook handler** — limited event surface; comments primarily.

## OAuth callback handlers

**What:** Receive the OAuth redirect from a platform, exchange the auth code for tokens, store the connected account.

**Default location:** `app/api/auth/[platform]/callback/route.ts`.

**Called by:** the user's browser (after platform redirects them back).

**Calls:** state validator, token exchanger (calls platform API), token encrypter, `connected_accounts` insert, post-callback page picker UI.

**Subtypes:**
- **Facebook callback** — handles Page selection.
- **Instagram callback** — typically uses the FB callback then queries `/{page-id}?fields=instagram_business_account`.
- **TikTok callback** — separate auth endpoint and token shape.

## Trigger dispatcher

**What:** The orchestrator that decides what happens for each inbound `message_event`. Walks the dispatch order: mid-flow check → human takeover → AI intent → keyword/comment/etc. trigger matching.

**Default location:** `lib/dispatch.ts` or `lib/triggers/dispatcher.ts`.

**Called by:** the queue worker that processes a freshly-inserted `message_event`.

**Calls:** flow_runs lookup (for mid-flow), trigger matchers (one per type), AI intent classifier, flow runner (to start a flow).

**Note:** there is exactly one dispatcher. Changes to it have system-wide blast radius.

## Trigger matchers

**What:** Per-trigger-type predicates. Given an event and a list of flows of one trigger type, return the matching flow (or none).

**Default location:** `lib/triggers/<trigger_type>.ts`, e.g. `lib/triggers/keyword.ts`, `lib/triggers/comment.ts`, `lib/triggers/story_reply.ts`.

**Called by:** the dispatcher.

**Calls:** flows query, the matching primitives (string normalizer, regex tester with timeout).

**One per trigger type:** `keyword`, `comment`, `story_reply`, `story_mention`, `new_follow`, `ref_url`, `manual`, `scheduled`, `ai_intent`. Adding a new trigger type means adding a matcher AND adding it to the dispatcher's list AND adding a UI configurator AND adding a `trigger_type` enum value AND adding a config schema.

## Flow runner

**What:** The state machine that walks a `flow_run` through `flow_steps`. One step at a time; either advances synchronously, sets a wait, or branches.

**Default location:** `lib/flows/runner.ts`.

**Called by:** the dispatcher (to start a flow), the scheduler (to wake delayed runs), the inbound-message path (to resume `waiting_for_reply` runs), the broadcast worker (to send a one-step send).

**Calls:** step executors (one per step type).

## Flow step executors

**What:** Per-step-type executors. Each takes a `flow_run` and a `flow_step`, performs the step's action, and returns a "next step" instruction (continue / wait / end).

**Default location:** `lib/flows/steps/<step_type>.ts`, e.g. `lib/flows/steps/send_message.ts`, `lib/flows/steps/wait_for_reply.ts`, `lib/flows/steps/branch.ts`.

**Called by:** the flow runner.

**Calls:** depends on step:
- `send_message` → sender
- `wait_for_reply` → just sets state and returns
- `delay` → just sets state and returns
- `branch` → evaluates conditions, returns next_step_id
- `add_tag` / `remove_tag` → contact_tags DB
- `set_field` → contacts.custom_fields DB update
- `http_request` → outbound HTTP, store response in flow_runs.context
- `handoff_to_human` → contacts flag update, optionally notification

**One per step type:** `send_message`, `wait_for_reply`, `delay`, `branch`, `add_tag`, `remove_tag`, `set_field`, `http_request`, `handoff_to_human`, `end_flow`. Adding a new step type means adding an executor, a runner case, an enum value, a UI palette node, a config form, and likely an icon/color.

## Sender

**What:** Calls the platform API to deliver a message. Handles 24h window enforcement, rate limits, error classification, response logging.

**Default location:** `lib/senders/<platform>.ts`, e.g. `lib/senders/meta.ts`, `lib/senders/tiktok.ts`. Often there's a thin facade `lib/senders/index.ts` that routes by platform.

**Called by:** flow step executors (for `send_message`), broadcast workers, the live inbox composer (for human-sent messages).

**Calls:** the platform client (low-level HTTP wrapper), the contact's `last_inbound_at` checker, the message_events insert (outbound).

**Subtypes:**
- **Meta sender** — Messenger and IG. Knows about messaging_type, message tags, recipient shapes (PSID vs comment_id).
- **TikTok sender** — comment replies primarily.

## Platform clients

**What:** Low-level HTTP wrappers around platform APIs. Decoupled from business logic; just wraps endpoints and handles retries/headers.

**Default location:** `lib/clients/meta.ts`, `lib/clients/tiktok.ts`.

**Called by:** senders, OAuth callbacks (token exchange), webhook subscribers (post-OAuth subscribe call), connected_account refreshers.

**Calls:** `fetch` / HTTP library.

## Schedulers / background workers

**What:** Periodic or queue-driven workers that do background work.

**Default location:** depends on queue choice — `app/api/jobs/<job-name>/route.ts` for QStash-style HTTP-triggered, or `workers/<job-name>.ts` for BullMQ-style.

**Subtypes:**
- **Wake-delayed-runs scheduler** — every 30s, finds `flow_runs` with `wait_until <= now()` and re-enqueues them.
- **Wait-for-reply timeout scheduler** — finds `waiting_for_reply` runs past their timeout, advances them.
- **Broadcast fan-out worker** — consumes a broadcast, fans out per-contact send jobs.
- **Per-contact send job** — produced by the broadcast fan-out, calls the sender for one contact.
- **Token refresher** — refreshes connected_accounts whose tokens are nearing expiry (TikTok, IG long-lived).
- **Reconciliation worker** — finds `message_events` rows that didn't dispatch and retries.

**Called by:** the queue scheduler / cron / queue worker.

**Calls:** the relevant subsystem (flow runner, sender, etc.).

## DB access functions / repositories

**What:** Functions that read or write specific tables. Should be the only callers of raw SQL or ORM queries; everything above this layer should call repositories.

**Default location:** `lib/db/<entity>.ts`, e.g. `lib/db/contacts.ts`, `lib/db/flows.ts`, `lib/db/connected-accounts.ts`.

**Called by:** any backend code that needs to read/write that entity.

**Calls:** the database driver / ORM (Prisma, Drizzle, etc.).

**Tenant scoping is mandatory** — every function takes a `userId` (or `connectedAccountId`, which transitively scopes by user) and filters by it.

## Crypto helpers

**What:** Signature verification, signature creation, token encryption/decryption, secure random.

**Default location:** `lib/crypto.ts`, `lib/security.ts`.

**Called by:** webhook handlers (verify), OAuth flows (state generation), connected_accounts repo (encrypt/decrypt tokens).

**Calls:** Node `crypto` (or platform equivalent). Reads encryption key from env.

**Specific functions:**
- `verifyMetaSignature(rawBody, header, appSecret)`
- `verifyTikTokSignature(rawBody, header, appSecret)` — different algorithm
- `encryptToken(plaintext)` / `decryptToken(ciphertext)`
- `generateOAuthState()` / `verifyAndConsumeState(state)`
- `timingSafeStringCompare(a, b)`

## Contact upsert helper

**What:** The canonical "I just received an inbound event from this person on this account" function. Upserts the contact, advances `last_inbound_at`, returns the contact row. Called from every webhook handler.

**Default location:** `lib/contacts.ts` → `upsertContactOnInbound(...)`.

**Called by:** every webhook handler (Meta DMs, IG DMs, comments, story replies, etc.).

**Calls:** `contacts` repo with `INSERT ... ON CONFLICT DO UPDATE`.

## Tag and segment helpers

**What:** Apply/remove tags, evaluate segment filters into contact lists.

**Default location:** `lib/tags.ts`, `lib/segments.ts`.

**Called by:** flow step executors (`add_tag`, `remove_tag`), broadcast composer (audience preview), contacts list page (filtering).

**Calls:** repos (`contact_tags`, `contacts`).

## AI intent classifier

**What:** Takes a message text + a list of `(intent_name, examples)` tuples; returns the best-match intent + confidence (or null).

**Default location:** `lib/ai/intent.ts`.

**Called by:** the dispatcher (only for DMs, not comments — too noisy/expensive).

**Calls:** an LLM API (Anthropic, OpenAI, etc.). Caches recent classifications.

## Frontend components

**What:** UI components in the dashboard.

**Default location:** `app/<route>/page.tsx`, `app/<route>/<components>.tsx`, `components/ui/*` (shadcn).

**Subtypes worth distinguishing:**
- **Page** — a top-level route with its own URL (`app/accounts/[id]/page.tsx`).
- **Flow builder canvas node** — a React Flow node component for one step type. Lives in `components/flow-builder/nodes/<step_type>.tsx`. Adding a new step type means adding a node component, registering it in the node-types map, and adding it to the palette.
- **Rich message composer subcomponent** — text/buttons/cards/quick-replies/media. Lives in `components/composer/*`.
- **Connect-account flow component** — platform picker, post-callback Page selector.
- **Live inbox panel** — conversation list, chat panel, contact details.
- **Contacts list / contact profile** — table, tag chips, custom fields editor.
- **Broadcast composer** — audience filter, message, schedule.
- **Form component** — rule editor, broadcast composer, etc.
- **Hook** — `useFlows`, `useContacts`, `useConnectedAccount`. Wraps data fetching.
- **Utility/helper** — variable substitution renderer, time formatter, status pill.

**Called by:** parent components or routes.

**Calls:** API routes (via fetch / a typed client), UI primitives.

## How to classify a function

When the user shows you a function, ask:
1. What does it return / produce?
2. What does it take as input?
3. What does it call?
4. Where is it defined?

Then map to the taxonomy above. If nothing matches cleanly, the function may be a *helper* — small, generic, no autoreply-specific concerns. Helpers still need wiring (used somewhere) and behavior (no obvious bugs), but the type-specific checklists below mostly don't apply.
