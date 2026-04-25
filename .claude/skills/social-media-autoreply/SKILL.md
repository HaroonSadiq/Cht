---
name: social-media-autoreply
description: Act as a full-stack expert for building social media chat automation platforms — the ManyChat / Chatfuel / MobileMonkey category — where business owners connect their Facebook, Instagram, and TikTok accounts, define trigger words, build multi-step conversational flows, manage a contact list, and automate replies to messages and comments. Use this skill whenever the user is building a social media management dashboard, chatbot SaaS, inbox automation tool, trigger-word based auto-reply system, DM automation, comment-to-DM growth tool, visual flow builder, contact/subscriber management, broadcast messaging, or anything that involves connecting business social accounts and responding to consumers on their behalf — even if they only mention one piece like "auto-reply bot", "Instagram DM automation", "FB page chatbot", "TikTok comment responder", "chat marketing tool", "comment to DM", or "Messenger bot builder". Also trigger on questions about Meta Graph API OAuth flows, the 24-hour messaging window, webhook verification, trigger matching logic, visual flow builder UX, contact tags and segmentation, broadcasts, rich message composers (buttons/cards), multi-tenant social account storage, or the dashboard UI where business owners configure their automations. When in doubt, use this skill — it covers both the frontend (dashboards, flow builder, inbox, rule/flow configuration UI) and the backend (OAuth, webhooks, matching engine, flow execution, contact management, broadcasts, sending replies) in equal depth.
---

# Social Media Chat Automation Platform

A full-stack skill for building SaaS platforms in the **ManyChat / Chatfuel / MobileMonkey** category: business owners connect their Facebook, Instagram, and TikTok accounts, design automated conversation flows triggered by keywords or events, manage their subscriber list, and broadcast messages — all without touching code.

## What this skill is for

The user is building (or working on a piece of) a platform where:

1. A **business owner** signs up on the website.
2. They **connect** one or more social accounts (FB Page, IG Business Account, TikTok Business Account).
3. They **build automated flows** — anything from a simple "when customer says `price`, reply with pricing info" to a multi-step flow with branching, delays, buttons, tagging, and data capture.
4. They **grow their subscriber list** via growth tools: comment-to-DM (someone comments → they get a private DM), follow-to-DM, story-reply triggers, ref URLs, QR codes.
5. The platform **listens** via webhooks, **matches** incoming events against triggers, **executes** the corresponding flow, and **sends** messages via the platform's API.
6. The business owner sees a dashboard with: connected accounts, flow builder, contact list with tags, live inbox for human takeover, broadcast composer, and conversation logs.

Claude's job when this skill triggers is to help design, architect, and implement any piece of this — from a single UI component to the whole system.

**Core primitive is a flow, not a rule.** A simple "trigger → single reply" is just the most common shape of a flow (one step). The architecture should assume flows from day one — don't paint yourself into a corner by hardcoding single-reply rules and then rebuilding when users want a branching conversation.

## Default tech stack

Unless the user specifies otherwise:

- **Framework:** Next.js (App Router) — full-stack in one codebase, serverless-friendly, good for webhooks.
- **Database:** Postgres (via Prisma or Drizzle for type-safe access).
- **Auth:** NextAuth/Auth.js for user login; separate OAuth flows for connecting social accounts.
- **Queue/background jobs:** BullMQ + Redis, or a serverless queue (SQS, Upstash QStash) for processing incoming webhook events asynchronously.
- **Styling:** Tailwind CSS + shadcn/ui for the dashboard.
- **Hosting:** Vercel (with webhooks routed to durable handlers) or a Node host if long-running workers are needed.

Swap any of these if the user prefers — the architecture below is stack-agnostic.

## The core mental model

Six moving parts. Always keep them separate in the code:

| Part | Responsibility |
|---|---|
| **Connect** | OAuth flow to link a business's FB/IG/TikTok account, store encrypted tokens. |
| **Receive** | Webhook endpoints that accept incoming messages/comments/events from each platform, verify them, and enqueue. |
| **Contacts** | Upsert every person who interacts into a contacts table, track tags/custom fields, dedupe across channels. |
| **Trigger** | Match an incoming event (message, comment, story reply, new follow, etc.) against the active triggers for that account and decide which flow (if any) to start. |
| **Execute** | A flow runner that walks a contact through the steps of a flow — send message, wait, branch, tag, capture input, delay — maintaining per-contact execution state. |
| **Send** | The actual call to the platform's API to deliver a message. Handles rate limits, retries, 24-hour window compliance, token expiry. |

The dashboard UI sits on top of this: flow builder, contact manager, inbox, broadcasts, analytics.

## The default data model

Nine tables. The jump from "trigger + reply" to "flow + contact + execution" is where most of the architectural richness lives — don't skip the contacts and flow tables even for an MVP, they're load-bearing.

```
users                       -- the business owner who signs up
  id, email, password_hash, name, created_at

connected_accounts          -- each social account they've linked
  id, user_id, platform ('facebook'|'instagram'|'tiktok'|'tiktok_shop'),
  platform_account_id, display_name,
  access_token_encrypted, refresh_token_encrypted, token_expires_at,
  scopes (text[]), status ('active'|'expired'|'revoked'),
  connected_at

contacts                    -- every person who's interacted with a connected account
  id, connected_account_id,
  platform_contact_id,            -- FB PSID, IG-scoped ID, TikTok open_id, etc.
  display_name, profile_image_url, locale,
  first_seen_at, last_seen_at,
  last_inbound_at,                -- critical for 24-hour window compliance (Meta)
  custom_fields (jsonb),          -- business-defined key/value store per contact
  is_subscribed (bool),
  UNIQUE (connected_account_id, platform_contact_id)

tags                        -- labels a business defines for segmenting contacts
  id, user_id, name, color, created_at
  UNIQUE (user_id, name)

contact_tags                -- many-to-many between contacts and tags
  contact_id, tag_id, applied_at, applied_by ('flow'|'manual'|'import')
  PRIMARY KEY (contact_id, tag_id)

flows                       -- the top-level automation unit
  id, connected_account_id,
  name, description,
  trigger_type ('keyword'|'comment'|'story_reply'|'new_follow'|'ref_url'|'manual'|'scheduled'),
  trigger_config (jsonb),         -- e.g. { match_type: 'contains', patterns: ['price'], channel: 'dm' }
  is_active (bool), priority (int),
  created_at, updated_at

flow_steps                  -- the nodes inside a flow (DAG)
  id, flow_id, step_type ('send_message'|'wait_for_reply'|'delay'|'branch'|'add_tag'|'remove_tag'|'set_field'|'http_request'|'handoff_to_human'),
  config (jsonb),                 -- step-specific config (message content, branch conditions, delay duration, etc.)
  position (jsonb),               -- { x, y } for rendering the canvas
  next_step_id (nullable),        -- for linear steps
  branches (jsonb, nullable),     -- for branch steps: [{ condition, next_step_id }, ...]
  INDEX (flow_id)

flow_runs                   -- one row per (contact, flow_execution) — tracks progress through a flow
  id, flow_id, contact_id,
  current_step_id,
  status ('active'|'waiting_for_reply'|'completed'|'errored'|'cancelled'),
  started_at, completed_at,
  context (jsonb),                -- variables captured during the run (user_reply, http_response_data, etc.)
  wait_until (timestamptz, nullable)   -- for delays/timeouts
  INDEX (contact_id, status), INDEX (wait_until) WHERE status IN ('waiting_for_reply','active' AND wait_until IS NOT NULL)

message_events              -- every incoming message/comment we received
  id, connected_account_id, contact_id, platform_message_id,
  channel ('dm'|'comment'|'story_reply'|'postback'),
  direction ('inbound'|'outbound'),
  message_text, attachments (jsonb),
  received_at,
  triggered_flow_run_id (nullable)
  UNIQUE (connected_account_id, platform_message_id)

broadcasts                  -- mass messages sent to a segment of contacts
  id, user_id, connected_account_id,
  name, message_content (jsonb),
  audience_filter (jsonb),        -- e.g. { tags: ['customer'], last_seen_within_days: 30 }
  schedule_at (timestamptz),
  status ('draft'|'scheduled'|'sending'|'completed'|'failed'),
  stats (jsonb)                   -- { sent: N, delivered: N, opened: N, failed: N }
```

**Key indexes:** `contacts(connected_account_id, last_inbound_at DESC)`, `flow_runs(wait_until) WHERE wait_until IS NOT NULL` (for the scheduler that wakes up delayed runs), `message_events(contact_id, received_at DESC)`.

**Why a contacts table at all, if the platform has the user IDs?** Because (a) tags and custom fields need somewhere to live, (b) `last_inbound_at` powers the 24-hour messaging window check on every outbound send, (c) the inbox view needs "recent conversations" ordered by last activity, and (d) broadcasts need to segment by tags.

## Working on any piece of this

When the user asks about a specific part, go deep but keep the rest of the system in mind. Below is where to find depth on each area. Read the relevant reference file(s) before writing code for that area — they contain platform-specific quirks and gotchas that will break the implementation if skipped.

### OAuth / connecting accounts
- **Facebook & Instagram:** read `references/meta-platforms.md`. Both use the Meta Graph API, share Facebook Login, and have overlapping but distinct permission scopes.
- **TikTok:** read `references/tiktok.md`. Very different — limited messaging capability, stricter app review, different OAuth endpoint.

### Webhooks (receiving messages, comments, events)
Read `references/meta-platforms.md` for FB/IG Messenger & IG Graph webhooks, signature verification, and the subscribe flow — including the event types behind comment-to-DM, story replies, and postbacks. Read `references/tiktok.md` for TikTok's more limited webhook surface. General webhook architecture (queuing, retries, idempotency) is in `references/architecture.md`.

### Trigger matching and flow execution
Read `references/flows.md`. Covers: the trigger-to-flow dispatch logic, how multi-step flows execute (the state machine), per-contact run state, waking up delayed/waiting runs, handling the user replying mid-flow, and the step types (send/wait/branch/tag/delay/etc.).

### Growth tools (comment-to-DM, follow-to-DM, story-reply, ref URLs, QR codes)
See `references/meta-platforms.md` → "Growth tools and event triggers". These are the highest-conversion features in the whole category — don't treat them as afterthoughts.

### Sending replies, broadcasts, and the 24-hour messaging window
Platform-specific sending endpoints are in the respective platform reference. The **24-hour messaging window** (Meta's rule: you can only freely message a user within 24h of their last message to you; outside that window requires message tags with specific use cases) is covered in `references/meta-platforms.md` → "24-hour window" and operationalized in `references/architecture.md` → "Send worker". Broadcast architecture (segmenting, scheduling, rate-limited fan-out) is in `references/architecture.md` → "Broadcasts".

### Contacts, tags, segmentation
See `references/architecture.md` → "Contacts and tags".

### Dashboard UI (flow builder, inbox, contact manager, rule editor, composer)
See `references/frontend-patterns.md`. Covers: onboarding, connect-account flow, **the visual flow builder** (canvas UX — the hardest piece), simple-rule editor (shortcut for single-step flows), rich message composer (buttons, cards, images), contacts list with tag management, live inbox for human takeover, broadcast composer, templates/starter flows, message log, empty states.

### Security, multi-tenancy, secrets
See `references/architecture.md` → "Security". Covers token encryption at rest, webhook signature verification, per-tenant data isolation, and secret rotation.

### AI intents (matching by meaning, not keywords)
See `references/flows.md` → "AI intent triggers". Modern alternative to keyword matching, typically routed through an LLM classifier.

## Things to always do

- **Verify webhook signatures** on every platform. Never trust incoming webhook payloads without verifying the signature header against your app secret. This is non-negotiable — skipping it means anyone can trigger flows.
- **Encrypt access tokens at rest.** Use `pgcrypto` or application-layer encryption with a key from a secret manager. Never store tokens in plain text.
- **Make webhook handlers respond fast (<3 seconds).** Platforms retry or disable webhooks that are slow. Handlers should: verify signature, upsert the contact, insert the `message_event`, enqueue a flow-dispatch job, return 200. The matching and sending happens in a worker.
- **Respect the 24-hour messaging window (Meta).** Every outbound message to a contact must check `last_inbound_at`. Within 24h: free to send (`messaging_type: RESPONSE`). Outside 24h: only allowed with an approved `message_tag` matching a legitimate use case (account update, confirmed event reminder, etc.) or via a paid `HUMAN_AGENT` tag. Broadcasts to cold contacts will fail — plan around this.
- **Be idempotent.** The same webhook event can be delivered more than once. Key off `platform_message_id` and skip duplicates. Flow runs should also be idempotent per (contact, flow, trigger_event) to avoid double-executing.
- **Upsert contacts on every inbound event.** `INSERT ... ON CONFLICT (connected_account_id, platform_contact_id) DO UPDATE SET last_inbound_at = now(), last_seen_at = now(), display_name = EXCLUDED.display_name`. Everything downstream depends on a contact row existing.
- **Scope token permissions minimally.** Only request the OAuth scopes actually needed.
- **Log every send attempt** with the full platform response. Business owners need this for debugging and trust.
- **Plan for token expiry.** When a send returns an auth error, flip `connected_account.status` to `expired` and surface a reconnect banner in the dashboard.
- **Default new flows to inactive.** `is_active = false` on save. The business owner toggles on after verifying the flow does what they expect — otherwise the first real customer triggers an untested automation.

## Things to flag to the user, early

These bite people building this kind of platform. Surface them up front, don't wait for the user to hit them:

1. **Meta's App Review is a real hurdle.** To use `pages_messaging` or `instagram_manage_messages` in production (not just your own test account), the app must pass Meta's App Review, which requires a business verification, a privacy policy, screencasts, and can take weeks. Build with this in mind.
2. **TikTok's messaging API is extremely limited.** TikTok does not offer a general-purpose DM auto-reply API to third parties the way Meta does. Most "TikTok auto-reply" tools work on comments (via the Content Posting / Research APIs) or via TikTok Shop's customer service API for shop owners only. Be honest with the user about what's feasible.
3. **Auto-replies on social platforms are policy-sensitive.** Meta restricts what you can send within 24 hours of a user's last message vs. outside that window (the "24-hour messaging window" and "Message Tags"). Replies that look like spam get pages restricted.
4. **Instagram Business vs. Creator accounts matter.** Only Instagram Business accounts connected to a Facebook Page can use the Messaging API. Tell users this upfront on the "connect account" screen.

## If the user hasn't specified a piece yet

Reasonable starting points, in order:

1. Set up the Next.js project, Prisma schema for the full data model above (yes, including contacts and flows from day one), and basic auth.
2. Build the "Connect Facebook Page" flow end-to-end (OAuth → store encrypted token → show connected page in dashboard).
3. Build the webhook receiver for FB Messenger — verify signature, upsert contact, insert `message_event`, enqueue.
4. Build the **simple rule editor** as a front-door UX: "when keyword X, reply Y." Under the hood, save it as a one-step flow.
5. Build the flow runner: executes single-step flows against incoming messages.
6. Add comment-to-DM as a growth tool (trigger_type = 'comment', step_type = 'send_message' to the commenter's DM).
7. Add the **visual flow builder** so users can go beyond single-step flows: delays, branches, tags, buttons.
8. Add the contacts list with tags, and the live inbox for human takeover.
9. Add Instagram (reuses most of the Meta code).
10. Add broadcasts to segments of tagged contacts.
11. Add TikTok (with honest scoping of what's actually possible — comments primarily).
12. Add AI intent matching as an alternative to keyword matching.
13. Add analytics/funnel view.

Stop at step 5 for an MVP demo; steps 1–8 for a functional alpha comparable to a stripped-down ManyChat.

## Output style

- Write **real, runnable code** — not pseudocode, not "you would do something like". Include imports, types, and error handling.
- Show **file paths** for every snippet so the user knows where it goes (`app/api/webhooks/meta/route.ts`, `lib/crypto.ts`, etc.).
- When introducing a new piece, show **how it connects** to the rest (what calls it, what it calls).
- For UI components, use **Tailwind + shadcn/ui** by default and keep them accessible (proper labels, focus states, keyboard nav).
- If the user's request touches a platform-specific detail, **read the reference file first**, then answer — don't guess at API endpoints or scope names.

## Reference files

- `references/meta-platforms.md` — Facebook + Instagram: Graph API, OAuth scopes, Messenger webhooks, reply APIs, **growth tools** (comment-to-DM, follow-to-DM, story replies, ref URLs), **24-hour messaging window** and message tags, App Review.
- `references/tiktok.md` — TikTok: what's actually possible, OAuth, comment/message handling, limitations, TikTok Shop as a separate track.
- `references/flows.md` — flow data model, flow execution engine (state machine), step types, handling waits and delays, branching, AI intent triggers.
- `references/architecture.md` — matching/dispatch logic, send worker, contacts and tags, broadcasts, queues, retries, security, token encryption, multi-tenancy.
- `references/frontend-patterns.md` — dashboard layout, **visual flow builder** canvas UX, simple-rule editor, rich message composer (buttons/cards/images), contacts and inbox, broadcast composer, templates, connect-account flow, empty states.
