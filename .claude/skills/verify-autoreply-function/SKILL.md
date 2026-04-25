---
name: verify-autoreply-function
description: Verify that a new function added to the social-media-autoreply chat-automation project is correctly wired into the system AND actually works. Use this skill whenever the user has just added (or is in the middle of adding) a single function/handler/component to the autoreply project and asks "does this work?", "is this wired up correctly?", "verify this function", "smoke test this", "check the new <handler/step/sender/component>", "did I hook this up right?", "trace through this for me", or similar — anything where the focus is one newly-added piece of the autoreply system rather than a full PR review. Works for any function type in the project: webhook handlers (Meta, TikTok), OAuth callbacks, trigger dispatchers and matchers, flow step executors (send_message, wait_for_reply, delay, branch, add_tag, http_request, handoff_to_human, etc.), the flow runner, the send worker, schedulers (delays, broadcasts), platform clients, AI intent classifiers, contact upserts, tag/segment helpers, crypto helpers (signature verification, token encryption), DB access functions, and frontend components (flow builder nodes, message composers, inbox panels, dashboards). The skill performs three stages — wiring check (where is this called from? where should it be registered?), behavior check (does it respect 24h window, signature verification, idempotency, contact upsert, tenant isolation, etc. as appropriate to its type?), and smoke test (actually exercise it end-to-end with realistic input and confirm expected outcome). Use this AFTER `social-media-autoreply` has helped design the system and BEFORE `pre-commit-review` is run on the broader diff. Distinct from pre-commit-review: that one is a full PR review across many files; this one zooms in on a single newly-added function and traces it deeply.
---

# Verify Autoreply Function

A skill for confirming that a single newly-added function in the social-media-autoreply project is **correctly integrated** and **actually works**. Three stages: wiring check, behavior check, smoke test.

## Prerequisite knowledge

This skill assumes the autoreply project's structure and conventions from the `social-media-autoreply` skill — the 9-table data model (`users`, `connected_accounts`, `contacts`, `tags`, `contact_tags`, `flows`, `flow_steps`, `flow_runs`, `message_events`, `broadcasts`), the six-part mental model (Connect / Receive / Contacts / Trigger / Execute / Send), the 24-hour messaging window, the flow execution state machine, and the platform-specific concerns for Meta and TikTok.

If anything below references an unfamiliar concept, fall back to those design docs.

## When this skill triggers vs. neighboring skills

- `social-media-autoreply` — design or build a new piece of the system. Used *before* the function exists.
- **`verify-autoreply-function`** (this) — verify a single newly-added function is wired correctly and works. Used *after* the function exists, *before* the broader commit.
- `pre-commit-review` — full PR review across many files and concerns. Used at commit time on a complete diff.

If the user shows a single function and asks if it works, use this skill. If they show a multi-file diff and ask for a review, use pre-commit-review.

## Stage 1 — Identify the function

Before checking anything, classify what the function is. The wiring and behavior checks are completely different for a webhook handler vs. a flow step vs. a UI component.

Read `references/function-taxonomy.md` for the full catalog. Quick decision tree:

- **Receives external input from a platform?** → webhook handler or OAuth callback.
- **Decides which flow runs for an event?** → trigger dispatcher or trigger matcher.
- **Implements the behavior of a step inside a flow?** → flow step executor.
- **Calls the platform's API to deliver a message?** → sender (or a wrapper around the platform client).
- **Wakes up runs / fans out broadcasts?** → scheduler / background worker.
- **Reads or writes a domain table?** → DB access function (repository).
- **Encrypts/decrypts tokens or verifies signatures?** → crypto helper.
- **Renders something in the dashboard?** → UI component (further: page, flow node, composer, list, hook).

If a function spans categories (e.g., a webhook handler that also upserts contacts), treat it as the outermost type and verify the inner concerns within. State the classification back to the user.

## Stage 2 — Wiring check

Read `references/wiring-checks.md` for the type-specific integration points. The general questions:

1. **Is this function reachable from a real entry point?** Trace upward — what calls this? What calls that? Continue until you hit a webhook URL, a route handler, a queue job consumer, a scheduled job, a UI render, or a CLI entry. If the chain ends in nothing, the function is orphaned.
2. **Are all the type-specific registrations in place?** A new flow step type needs more than just an executor function — it needs the enum value, the runner case, a config schema, a UI palette entry, etc. The taxonomy file lists these per type.
3. **Are there parallel call sites that should also have been updated?** A new platform that's added to the `platform` enum on `connected_accounts` should also be: handled in the OAuth flow, the webhook receiver, the sender, the dashboard's "connect account" picker, the platform-icon mapper, etc. Find what wasn't updated.
4. **Tenant scoping** — every DB function that touches a tenant-scoped table must filter by `user_id` (directly or via `connected_account_id → user_id`). Missing scope = data leakage.

For each wiring concern, do a real `grep` / search through the codebase to confirm — don't trust intuition. State explicitly what you searched for.

## Stage 3 — Behavior check

Read `references/behavior-checks.md` for the type-specific behavior concerns. The non-negotiables to verify, by type:

- **Webhook handlers**: signature verified on raw body in constant time, idempotency on `(connected_account_id, platform_message_id)`, contact upserted with `last_inbound_at`, returns 200 within ~3s, work happens in a queued job.
- **Senders**: 24h window checked before send (or message tag applied), token validity checked, errors classified (rate limit / auth / permanent / transient), full platform response logged, `last_outbound_at` updated.
- **Flow step executors**: transactional (all-or-nothing), advance `current_step_id` correctly, handle the "interrupted by user reply" case where applicable, idempotent on retry.
- **Flow runner / dispatcher**: respects the dispatch order (mid-flow check → human takeover → AI intent → keyword), only one flow per (contact, trigger event), priority/tiebreak deterministic.
- **Trigger matchers**: regex timeout 100ms, normalization (lowercase + trim) consistent.
- **OAuth callbacks**: `state` verified and consumed, scopes checked against requested set, tokens encrypted before insert, callback domain matches app config.
- **Schedulers**: row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED`) so multiple workers don't double-process, time advances are atomic with status changes.
- **Crypto helpers**: signature comparison is constant-time, raw body (not parsed) is signed/verified, encryption key from env not literal, IV per encryption.
- **AI intent classifiers**: confidence threshold checked, fallback to keyword on low confidence, classification logged for tuning, cost-bounded (cache or rate-limit).
- **DB functions**: tenant-scoped, transactional where multi-statement, indexes match query patterns, `ON CONFLICT` used for upserts.
- **UI components**: respect dark mode, accessibility (labels, focus, keyboard), loading and error states, pagination/virtualization for unbounded lists.

For each applicable concern, **point to the exact line(s)** in the function that satisfy it, or **note its absence**. Don't say "this looks fine" without checking.

## Stage 4 — Smoke test

This is the part most reviews skip. The function might pass static checks but still not work. Read `references/smoke-test-recipes.md` for the recipe per function type.

### Execution mode preference

Prefer in this order:

1. **Run the actual function with mocked external dependencies.** Use the project's test runner if possible. Set up a minimal in-memory or test-DB state, call the function, assert outcomes.
2. **Run the function against a local dev DB / Docker Postgres** if one is configured. Let it write real rows; verify them with SQL.
3. **Trace through the code mentally** if execution isn't possible. Be explicit about what state you're assuming and what would happen at each line.

State which mode is being used at the top of the smoke test section: *"Smoke test: executed against a Vitest in-memory mock"* or *"Smoke test: traced manually because no test runner is configured here."*

### What to verify

For each function type, the recipe defines:
- **Inputs** — what realistic input looks like (sample webhook payload, sample message event, sample flow run, etc.). Includes signed signatures where applicable.
- **Pre-state** — what should be in the DB / system before the call.
- **The call** — exactly how to invoke the function with these inputs.
- **Post-state assertions** — what should be in the DB / system after, including which rows changed, which jobs were enqueued, what was returned, what was logged.

Walk every assertion. If any fails, that's a finding.

### Negative-path smoke tests

The happy path passing isn't enough. Also test:
- Duplicate input (idempotency).
- Input the contact has never sent before (cold-start).
- Input arriving when the contact is mid-flow (`waiting_for_reply`).
- Input arriving when the contact is in human takeover.
- Token-expired condition.
- Outside the 24h window (for senders).
- Rate-limit response from the platform.
- Malformed input.

You don't need every negative path for every function — pick the 2–3 most relevant per the recipe.

## Report format

Use this exact structure:

```markdown
## Verify: <function name>

**Function type:** <classification, e.g. "Webhook handler — Meta">
**Location:** `path/to/file.ts:LINE`

### Wiring

- ✅ <integration point that's correctly hit, with file:line>
- ✅ <another>
- ❌ <integration point that's missing — explain what should be where>
- ⚠️ <suspicious wiring — explain the concern>

### Behavior

- ✅ <concern> — `path/to/file.ts:LINE` (one-line note)
- ❌ <missing concern> — what's missing and what could go wrong
- ⚠️ <partial concern> — what's there and what's not

### Smoke test (<execution mode>)

**Scenario 1 — <name>**
Inputs: <brief>
Result: <what happened>
Verdict: ✅ / ❌ / ⚠️ <one sentence>

**Scenario 2 — <name>**
...

### Findings (severity-ordered)

<Same severity scheme as pre-commit-review: BLOCKING / HIGH / MEDIUM / LOW. List only non-✅ items, with file:line and consequence.>

### Verdict

<One paragraph: "ready to use", "needs the BLOCKING/HIGH items fixed, then ready", or "not ready — significant rework needed". Plus the one or two most important specific things the user should do next.>
```

If everything is clean: skip Findings entirely and write a short Verdict.

## Things to always do

- **State the function type up front.** Wrong classification means the wrong checklist gets applied.
- **Use real `grep` to find call sites.** Never claim wiring is correct without searching for it.
- **Walk both the wiring and the behavior** — a correctly wired function with broken behavior is a working integration of broken logic.
- **Run the smoke test.** A "review" without ever running the function is worth half as much. If you can't run, say so explicitly.
- **Trace negative paths.** Most bugs in this category live there.
- **Be specific.** "The contact upsert is missing on line 23" — not "contacts aren't handled."

## Things to never do

- **Don't assume the function works because it compiles.** TS/Python/Rust compilation is a floor, not proof of correctness.
- **Don't trust your memory of the data model.** Re-check the schema files. Tables and columns evolve.
- **Don't skip the type-specific behavior checks** because "the function is small" — small functions in this project carry a lot of weight (a 30-line webhook handler does signature verification, contact upsert, idempotency, and dispatching).
- **Don't run smoke tests against production** credentials or APIs. Use mocks or a dev environment.
- **Don't mark something ✅ unless you've actually verified it** in this conversation. Half-checked items are how things ship broken.

## Reference files

- `references/function-taxonomy.md` — every function type in the autoreply project: what it is, where it lives, what calls it, what it calls.
- `references/wiring-checks.md` — for each type, the full set of integration points that must be hit when adding one.
- `references/behavior-checks.md` — for each type, the platform/architectural concerns the function must respect.
- `references/smoke-test-recipes.md` — for each type, a recipe to exercise it end-to-end with realistic input and assert the outcome.
