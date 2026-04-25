# Frontend Patterns

The dashboard is the only part of this product the business owner actually sees. It's where they'll decide if the platform is worth paying for. Default to **Tailwind + shadcn/ui**, keep it clean, and optimize for the five jobs a business owner actually comes here to do.

## The five jobs

1. **Connect a new social account** (once per platform).
2. **Build or edit automations** — simple rules for quick wins, visual flows for multi-step.
3. **Manage contacts** — view the subscriber list, tag people, look at conversations.
4. **Handle conversations live** — the inbox, where humans take over from the bot.
5. **Send broadcasts** — reach a segment of tagged contacts with a one-off message.

Check "what the bot has been saying" is a sixth job, but it lives inside #3 and #4 as conversation views — don't give it its own top-level nav.

## Suggested page structure

```
/login, /signup
/onboarding                — first-run wizard: connect your first account
/dashboard                 — home: connected accounts + recent activity + key metrics
/accounts                  — list of connected accounts, connect new, disconnect
/accounts/:id              — single account overview
/accounts/:id/automations  — list of flows + simple rules for this account
/accounts/:id/automations/new           — picker: "Simple rule" or "Visual flow"
/accounts/:id/automations/:id/edit      — the flow builder canvas OR rule form
/accounts/:id/contacts     — subscriber list with filtering and tag management
/accounts/:id/contacts/:contactId       — single contact profile + conversation history
/accounts/:id/inbox        — live chat inbox: open conversations needing attention
/accounts/:id/broadcasts   — broadcast list + composer
/accounts/:id/broadcasts/new
/accounts/:id/templates    — starter-flow gallery
/settings                  — profile, billing, team
```

Scope everything to the selected connected account. Business owners with multiple Pages shouldn't have to mentally filter global lists.

## The "connect an account" flow

This is where users will drop off most. Every extra click costs you.

### Screen 1: Pick a platform

A row of three cards: Facebook, Instagram, TikTok. Each shows an icon, the platform name, a one-line description, and a "Connect" button.

For TikTok, be honest:

> Auto-reply to comments on your videos. (DM automation not supported by TikTok for general business accounts.)

### Screen 2: OAuth redirect

Redirect to the platform's OAuth URL immediately. Don't show a loading spinner on your own screen first — adds a frame of friction.

### Screen 3: Post-callback account picker

For Facebook: checkbox list of Pages with name + profile image + category + IG-linked indicator.

For Instagram: the list comes from Pages with an IG Business Account attached. If none, show a help panel: "Instagram auto-reply requires a Business or Creator account linked to a Facebook Page. [Guide]."

### Screen 4: Success

Redirect to `/accounts/:id` for the newly connected account, with a success toast. Pre-populate it with a template gallery: "Get started with a ready-made automation — Welcome message, Pricing FAQ, Out-of-office."

## Automations list (rules + flows together)

One list, two shapes. Each row:

- **Name + "Simple" or "Flow" badge**.
- **Trigger preview** — "Keyword: price, cost, how much" or "New Instagram follower" or "Comment on any post."
- **Steps count** — "1 step" for simple, "6 steps" for a flow.
- **Active toggle** (instant, don't require save).
- **Stats** — triggered N times today / this week.
- **Actions** — edit, duplicate, delete.

"New automation" button opens a picker: **Simple rule** (form) or **Visual flow** (canvas). Both save to the same `flows` table; the UI shape is a user-facing choice.

## Simple-rule editor

For the 80% case. One screen, no tabs. Form fields in order:

1. **Name** (optional) — for the owner's reference.
2. **Trigger** — radio: "When someone sends a DM" / "When someone comments on a post" / "When someone replies to a story" / "When someone new follows me."
3. **Match criteria** (if DM or comment): radio for match type (Contains / Exact / Mentions / Advanced regex) + a tag-input for the patterns.
4. **Reply** — rich message composer (see below).
5. **Optional: Add a tag to this contact when this rule fires** — select from user's tags or create new.
6. **Live preview card** — renders the rendered reply with fake sender name.
7. **Priority** — number with helper text.
8. **Save** / **Cancel** — save persists a `flows` row with `trigger_type='keyword'` and a single `send_message` step.

A "Convert to flow" secondary action switches to the canvas builder for the same row.

Default `is_active = false` on save.

## Visual flow builder

The killer feature. Power users will live here. Invest in it.

### Canvas layout

- **Left sidebar:** palette of step types to drag onto the canvas. Grouped: Send (Message, Quick replies, Card), Wait (Wait for reply, Delay), Logic (Branch, HTTP request), Contact actions (Add tag, Remove tag, Set field), End (Handoff to human, End flow).
- **Center:** the canvas — a zoom/pan surface with draggable nodes connected by arrows (use **React Flow** / `@xyflow/react`; don't build from scratch).
- **Right sidebar:** when a node is selected, shows its config form. Otherwise, shows the flow's trigger settings.
- **Top bar:** Flow name, active toggle, "Save", "Test" button.

### Node rendering

Each node type has a distinct color and icon:

- **Trigger node** (always one, at the top, locked position): green, shows trigger type and summary.
- **Send message:** blue, previews first line of the text + attachment/button indicator.
- **Wait for reply:** amber, shows timeout.
- **Delay:** amber, shows duration.
- **Branch:** purple, shows number of branches, labels on outgoing arrows.
- **Tag operations:** gray, shows tag name.
- **HTTP request:** gray with a globe icon.
- **Handoff / End:** red/red-orange.

Arrows between nodes. Branch nodes have multiple outgoing arrows with condition labels.

### Interaction

- Drag from sidebar onto canvas to add.
- Click to select → config panel opens on right.
- Drag between nodes to reorder.
- Connect by dragging from a node's output handle to another's input handle.
- Keyboard: Delete removes selected, Cmd/Ctrl-D duplicates, Cmd/Ctrl-Z undoes.
- "Auto-arrange" button to tidy up the layout.
- Mini-map in the bottom-right corner for large flows.

### Validation on save

- Every non-terminal node must have `next_step_id` set.
- Every `branch` must have a `default` case.
- Warn if the flow has orphan nodes (not reachable from the trigger).
- Warn if any `send_message` step has empty content.

### Test mode

A "Test this flow" button that steps through the flow in a preview panel, letting the author simulate user replies and see which path the flow takes. This is a huge trust-builder. Ship it in v1 if possible.

## Rich message composer

Used by the simple-rule editor, every `send_message` step in the flow builder, and the broadcast composer. Must be consistent across all three.

### Components

- **Text area** — message body. Variable chips (`{{contact.first_name}}`, `{{contact.custom_fields.<field>}}`) insertable via a "+" menu.
- **Media attachment** — upload image or video, or paste a URL. Shows thumbnail preview.
- **Quick replies** — add up to 13 pill buttons. Each has a label + payload. Drag to reorder.
- **Buttons** — add up to 3 buttons of type URL (opens link), Postback (triggers a flow), or Phone (call number).
- **Generic template (cards)** — a horizontal carousel of up to 10 cards, each with image, title, subtitle, and up to 3 buttons. Use for product catalogs, menu options.

### Preview

A phone-frame preview on the right or below, showing the rendered message as it would appear in Messenger / Instagram. Swap between platforms with a tab — IG renders some elements differently.

### Character limits

Platform-imposed limits (text length, button label length). Show live count with warning when close to limit.

## Contacts list

The subscriber view. Table with:

- Avatar + display name
- Tags (as chips, max 3 shown + "+N more")
- Custom fields (configurable columns)
- Last inbound (with a colored dot: green if <24h, gray otherwise — the 24h window indicator)
- First seen, last seen
- Subscribed status (opt-out toggle)

Filters/search: by tag (multi-select), by custom field, by last-inbound range, by flow they've been through, free-text search on name. Bulk actions: add tag to N, remove tag from N, export CSV, start a flow manually.

Click a row → contact profile page.

## Contact profile page

- Header: avatar, display name, platform, link to the profile on that platform.
- Tags manager: chips + "Add tag" input.
- Custom fields: editable list of key/value pairs.
- Conversation history: full thread of messages (both directions), chronological, with flow-step annotations ("Sent by flow: Pricing inquiry → Step 2").
- Actions: Start a flow manually (select from list), Send a one-off message, Toggle human takeover, Unsubscribe.

## Live inbox

Where human operators take over.

### Layout

Classic three-pane inbox:

- **Left:** conversation list. Each item: avatar, name, last message preview, timestamp, unread indicator, platform icon, status pill (Bot / Human / Waiting).
- **Center:** the selected conversation — messages, scrollable, with a composer at the bottom.
- **Right:** contact details sidebar — tags, custom fields, connected account, recent flow activity, "Start flow" quick action.

### Conversation composer

Text input, send button, attachment button, "Pause bot for this contact" toggle (sets human takeover on), "Resolve" button (closes the conversation, bot can take over again).

### Filters

- Status: Open / Waiting for human / All / Resolved.
- Assigned to: me / team / unassigned.
- Tag filter.
- Time filter.

### Assignment

For multi-operator teams: assign a conversation to a specific operator. Show the assignee's avatar on the conversation list item.

## Broadcast composer

Three steps, same page:

1. **Audience** — pick a connected account, then build a filter: tags (AND/OR), custom fields, last inbound window. Show live count: "1,243 contacts match. 87 are within the 24h messaging window (free send). 1,156 outside — **will be skipped unless you pick a Message Tag**."
2. **Message** — the rich message composer.
3. **Send** — "Send now" or "Schedule for...". If "Schedule", date/time picker. If outside-window contacts exist, require an explicit Message Tag choice from a dropdown with help text per tag.

Post-send, show a live progress panel: "Sending… 412 / 1,243 sent, 3 failed."

## Templates / starter flows

A gallery at `/accounts/:id/templates`. Each template is a pre-built flow the business owner can clone into their account with one click.

Default templates to ship:

- **Welcome message for new followers** (IG)
- **Pricing inquiry** (keyword flow)
- **Business hours / out-of-office**
- **Thanks for commenting → DM the info** (comment-to-DM)
- **Lead capture** (ask for email → save to custom field → tag as 'lead')
- **Appointment booking** (multi-step with branches)
- **Abandoned cart recovery** (for ecommerce integrations)

Each template card: name, short description, preview of the flow structure, "Use this template" button.

## Dashboard home

The first screen after login. Not a blank "welcome" — show actual numbers:

- Connected accounts (with status dots).
- **Activity today**: inbound messages, flows triggered, messages sent, failed sends.
- **Active flows**: top 3 by trigger count this week.
- **Needs attention**: expired tokens, failed sends above a threshold, conversations waiting for human reply.
- Quick actions: "New automation", "New broadcast", "Open inbox."

Keep it one screen. Don't put tabs or sub-nav on the home.

## Empty states

Every list view has an empty state. Every empty state teaches and offers an action:

- No connected accounts: "Connect a Facebook Page, Instagram, or TikTok to get started." + Connect button.
- No automations: "Create your first automation, or browse templates." + two buttons.
- No contacts: "Contacts appear here once someone messages your connected account." (For new users with no activity, explain rather than apologize.)
- No broadcasts: "Send your first broadcast to engage your contacts." + button.

## Onboarding

Three steps, skippable:

1. Welcome + one-sentence value prop.
2. Connect your first account.
3. Pick a starter template and activate it (instead of making them build from scratch).

Track drop-off per step.

## Components to use from shadcn/ui

- `Button`, `Card`, `Badge`, `Switch`, `Input`, `Textarea`, `Select` — everywhere.
- `Dialog` — confirmations for disconnect, delete, and destructive actions.
- `Toast` / `Sonner` — save confirmations, copy-to-clipboard, errors.
- `Tabs` — fine for the single-account page (Automations / Contacts / Inbox / Broadcasts).
- `Table` or `DataTable` — contacts list, broadcast list, message log.
- `Form` + `zod` — every form, with inline validation.
- `Command` — for searchable dropdowns (pick a flow to start, pick a template).
- `Sheet` — the contact details side panel and the node config panel in the flow builder.

Plus **React Flow** (`@xyflow/react`) for the flow builder canvas — do not build this from scratch.

## Accessibility basics

- Every form input has a `<label>`.
- Focus states visible (don't override Tailwind rings without replacement).
- Status pills use text, not only color.
- Tab order is natural top-to-bottom.
- Modals trap focus and close on Escape.
- The flow builder canvas has keyboard alternatives for mouse-only actions (delete, duplicate, connect).

## Dark mode

On by default in shadcn/ui — keep it enabled.

## What to avoid

- **Making users choose simple rule vs. flow at the start of every automation.** Default to simple rule; let them "Convert to flow" when they need more.
- **Building the flow canvas from scratch.** Use React Flow.
- **Hiding the 24-hour window status.** Surface it on the contacts list, the contact profile, and the broadcast composer. It's the single biggest source of "why didn't my message send?" confusion.
- **Modals for editing flows or composing broadcasts.** Full pages.
- **Auto-activating new automations on save.** Default off. Users must toggle on.
- **Ignoring empty states.** Every empty state is a teaching opportunity, not a failure screen.
