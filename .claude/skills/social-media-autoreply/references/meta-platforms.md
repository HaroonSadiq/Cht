# Meta Platforms: Facebook & Instagram

Facebook and Instagram share the same underlying Graph API, the same OAuth infrastructure (Facebook Login), and most of the same developer app setup. Build them together in the codebase — they differ mostly in which scopes you request and which endpoints you hit when sending.

Always confirm current API versions, scope names, and endpoints via `web_search` before building. Meta deprecates versions on a schedule. This reference gives you the structure and the gotchas; endpoints change.

## App setup (prerequisite)

Before any code works, the user needs:

1. A Meta developer account at `developers.facebook.com`.
2. A new **App** of type "Business".
3. Products added to the app: **Facebook Login**, **Messenger**, **Instagram Graph API** (or the current equivalent for IG Messaging).
4. A **Business Verification** completed for the app's business.
5. Webhook callback URL configured and verified.
6. For production: **App Review** submitted and approved for each messaging-related permission.

Tell the user which of these are done vs. pending before writing integration code.

## OAuth: connecting a user's page/account

Use Facebook Login as the outer OAuth layer for both Facebook Pages and Instagram Business accounts — Instagram Business accounts are always linked to a Facebook Page, so the flow goes through Facebook.

### Flow

1. Redirect user to:
   `https://www.facebook.com/<api-version>/dialog/oauth?client_id=<APP_ID>&redirect_uri=<CALLBACK>&scope=<SCOPES>&state=<CSRF_TOKEN>`
2. User approves → callback with `code` and `state`.
3. Verify `state` matches a server-stored value for that user session.
4. Exchange `code` for a **short-lived user access token** at `/oauth/access_token`.
5. Exchange short-lived token for a **long-lived user token** (~60 days).
6. Call `/me/accounts` with the long-lived token to list the Pages the user manages.
7. For each Page the user wants to connect, get the **Page access token** from that response — Page tokens from a long-lived user token are effectively non-expiring.
8. For Instagram: call `/{page-id}?fields=instagram_business_account` to get the connected IG Business Account ID.
9. Encrypt and store the Page token in `connected_accounts`.

### Scopes

Request only what's needed for the feature being built. Common ones for this platform:

- `pages_show_list` — list the user's Pages.
- `pages_manage_metadata` — subscribe the Page to webhooks.
- `pages_messaging` — send/receive messages as the Page.
- `pages_read_engagement` — read comments on Page posts.
- `pages_manage_engagement` — reply to comments.
- `instagram_basic` — basic IG account info.
- `instagram_manage_messages` — send/receive IG DMs.
- `instagram_manage_comments` — read/reply to IG comments.

Every scope that touches messaging or comments requires App Review.

## Webhooks: receiving messages and comments

Webhooks are how the platform tells you "a user sent a message to this Page." Set them up once per app; then for each connected Page, subscribe the Page to the relevant fields.

### Verification handshake (one-time, during setup)

When you register a webhook URL in the app dashboard, Meta sends a `GET` to that URL with:

```
?hub.mode=subscribe&hub.verify_token=<YOUR_TOKEN>&hub.challenge=<RANDOM_STRING>
```

Respond with `hub.challenge` as plain text if `hub.verify_token` matches the token you configured.

### Signature verification (every incoming event)

On every `POST` to the webhook, verify the `X-Hub-Signature-256` header:

```
expected = "sha256=" + HMAC_SHA256(app_secret, raw_request_body)
```

Compare in constant time against the header value. **If it doesn't match, return 401 and do nothing else.** Use the raw body, not the parsed JSON.

### Payload shape (Messenger & IG DMs)

Top-level: `object` ("page" or "instagram"), `entry` array.
Each entry: `id` (Page or IG account ID), `time`, `messaging` array (for DMs) or `changes` array (for comments).
Each messaging event: `sender.id`, `recipient.id`, `timestamp`, `message.text` (or `message.attachments`, `postback`, etc.).

Important:
- `sender.id` is a **Page-scoped ID (PSID)** — unique per Page, not the user's real FB ID.
- Treat attachments and postbacks separately; don't assume `message.text` exists.
- Events can be batched — loop through `entry` and within each, loop through `messaging`.

### Per-Page subscription

After the user connects a Page, call:

```
POST /{page-id}/subscribed_apps
  ?subscribed_fields=messages,messaging_postbacks,feed
  &access_token=<PAGE_ACCESS_TOKEN>
```

For Instagram, subscribe the IG Business Account similarly via the Page it's connected to, with fields like `messages`, `comments`, `mentions`.

### Handler skeleton

Webhook handler must:

1. Verify signature on raw body.
2. Parse the payload.
3. For each event, insert a `message_events` row (or upsert, keyed by `platform_message_id`, to handle retries).
4. Enqueue a job to process the event (do not process inline).
5. Return 200 within 3 seconds.

If step 4 fails, still return 200 if step 3 succeeded — the row in `message_events` is the recovery point, a reconciliation job can retry later. Returning non-200 causes Meta to retry aggressively and eventually disable the webhook.

## Sending replies

### Messenger (Facebook Page DMs)

```
POST /{page-id}/messages
Body: {
  "recipient": { "id": "<PSID>" },
  "messaging_type": "RESPONSE",      // when replying within 24h
  "message": { "text": "<reply>" }
}
Authorization: Page Access Token
```

For sending outside the 24-hour window, you need `messaging_type: "MESSAGE_TAG"` with a valid tag — see the "24-hour window" section below. Auto-reply to an incoming message is always within the window (you're responding to their message), so `RESPONSE` is the right type for reactive flows.

### Instagram DMs

Same `/{ig-user-id}/messages` shape, called via the connected Page's access token, with the IG Business Account ID.

### Rich messages (buttons, cards, quick replies)

Messenger supports multiple message structures beyond plain text:

- **Quick replies** — inline pill buttons shown below a message. Up to 13. Each has a `title` and a `payload` that comes back as a postback when tapped.
  ```json
  "message": {
    "text": "How can I help?",
    "quick_replies": [
      { "content_type": "text", "title": "Pricing", "payload": "QR_PRICING" },
      { "content_type": "text", "title": "Support", "payload": "QR_SUPPORT" }
    ]
  }
  ```
- **Button template** — message with up to 3 `postback`, `web_url`, or `phone_number` buttons.
- **Generic template** — horizontal carousel of cards, each with image, title, subtitle, up to 3 buttons. Up to 10 cards.
- **Media template** — image or video as the message body.

Instagram supports a subset (quick replies, generic templates with some restrictions). Test on IG specifically — not every Messenger template renders there.

Postbacks (button taps) come in on the webhook as `postback` events with the `payload` you set. Treat them as a separate `channel = 'postback'` in your pipeline and use them as flow triggers or to resume `wait_for_reply` steps.

### Facebook comment replies

```
POST /{comment-id}/comments
Body: { "message": "<reply>" }
```

### Instagram comment replies

```
POST /{comment-id}/replies
Body: { "message": "<reply>" }
```

### Private DM reply to a public comment (comment-to-DM)

This is Meta's signature growth tool — someone comments on your Page post, and you privately DM them. Requires the commenter's consent (implicit on FB via the `pages_messaging` permission; slightly different on IG). The call is still `POST /{page-id}/messages` for Messenger, but the recipient is specified differently:

```
POST /{page-id}/messages
Body: {
  "recipient": { "comment_id": "<comment-id>" },   -- target by comment, not PSID
  "message": { "text": "Thanks for commenting! Here's the info you asked about..." }
}
```

Meta resolves the `comment_id` to the commenter's PSID on their side and delivers the DM. After the first DM is sent this way, you get the PSID back in the response and can continue the conversation normally. See "Growth tools and event triggers" below.

## 24-hour window

Meta's single most important rule for this whole category. Breaking it gets Pages restricted.

### The rule

- A **user message to your Page** (DM, reply to a story, comment that gets answered via comment-to-DM) opens a **24-hour window**.
- Within that window, you can send any content freely with `messaging_type: 'RESPONSE'`.
- **Outside** the window, you can only send:
  - A message with an approved `MESSAGE_TAG` matching one of Meta's allowed use cases (e.g., `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`). Each tag has strict content rules; promotional content is never allowed.
  - A paid `HUMAN_AGENT` tag message (allows 7-day response window for human support, requires the `human_agent` permission which has a separate review).
  - A paid `NEWS` message (for news Pages only, very restricted).
  - Sponsored Messages (paid ads, different flow).

### Operational enforcement

Every outbound send passes through a check:

```ts
function canSendFreely(contact: Contact): boolean {
  if (!contact.last_inbound_at) return false;
  const hoursSince = (Date.now() - contact.last_inbound_at.getTime()) / 3_600_000;
  return hoursSince < 24;
}
```

- If `canSendFreely` → use `messaging_type: 'RESPONSE'`, ship it.
- If outside the window → either refuse the send (log as `skipped: 'outside_24h_window'`) or, if the flow author marked the send step as a tagged message, use `messaging_type: 'MESSAGE_TAG'` with the specified tag. Tags must be honest; sending promotional content under a `CONFIRMED_EVENT_UPDATE` tag is what gets Pages restricted.

### UI implications

- The flow builder's send-message step needs a UI affordance for "outside the 24h window, this message will fail unless you tag it as..." — let the author pick a tag from a list with help text for each.
- The broadcast composer needs to warn: "Only contacts who messaged you in the last 24 hours will receive this unless you tag it." Show the audience segment split: "1,243 contacts in audience → 87 within 24h window (will receive), 1,156 outside (will be skipped unless tagged)."
- The contacts list can show a "window status" dot next to each contact: green if within 24h, gray otherwise.

### Instagram differences

IG Messaging follows the same 24-hour window principle but has a narrower set of message tags. Confirm current Instagram-specific tags via `web_search` at build time — Meta updates these.

## Growth tools and event triggers

These are the features that differentiate the platform category. All of them funnel social engagement (comments, follows, mentions) into the DM channel, where flows can run richly.

### Comment-to-DM

**Setup:**
1. Subscribe the Page/IG account to the `feed` webhook field (FB) or `comments` field (IG).
2. When a `comment` event comes in: the webhook payload contains the comment ID, the commenter's info, and the post it's on.
3. Match the comment against active flows with `trigger_type='comment'` — check `post_ids` filter and optionally a keyword filter on the comment text.
4. For each match: send a DM to the commenter using the `"recipient": { "comment_id": "..." }` form above.
5. Optionally: also reply publicly to the comment (e.g., "Check your DMs!") to prove the bot worked.

**UX in the flow builder:** the trigger block asks "Which post(s)?" (multi-select from recent posts, or "All posts"), "Keyword filter?" (optional), "Also reply publicly?" (text field).

**Gotcha:** Meta requires the user to have interacted with the Page (liked/followed/messaged before) for some comment-to-DM paths on IG. Test on a fresh account to see what works for your permission level.

### Follow-to-DM (Instagram)

When someone follows the IG Business Account, trigger a welcome DM. Requires a specific webhook field subscription and works only if the IG account meets certain size/access requirements. Check current doc at build time for eligibility.

### Story reply

When someone replies to an IG story with a DM, that comes in via the normal `messages` webhook but with a `story_mention` or `story_reply` field set. Use `trigger_type='story_reply'` flows to respond to specific stories (or all).

### Story mention

When someone mentions the business in their own story, you get a `story_mention` event with a reference to the mentioning user's story. A common pattern: DM them to thank them and send a coupon.

### Ref URLs (m.me links with parameters)

`https://m.me/<page-username>?ref=<code>` or `https://ig.me/<page-username>?ref=<code>` — when a user taps this link and opens a conversation, the first webhook event includes the `ref` parameter. Use `trigger_type='ref_url'` flows keyed to the `ref` code.

This is how businesses run campaigns: QR codes, landing-page links, ads all generate ref URLs with unique codes that start specific flows. Essential for attribution ("which campaign drove this subscriber?").

### Paid ads → Messenger

Meta's "Click-to-Messenger" ads (run in Ads Manager) deposit clickers into a Messenger conversation. The first message the user sends (or the ad's "welcome message") triggers normal flow matching. You can tie this to ref URLs for attribution.

## Rate limits

Meta rate-limits per app and per Page. The specific numbers change — check current docs — but assume low hundreds of calls per Page per hour is safe, and build in exponential backoff on any `4` or `17` error codes. Log every `x-app-usage` / `x-page-usage` header response so you can see how close you are.

## App Review: what the user actually has to do

For the messaging scopes to work on accounts other than the developer's own, the app must pass App Review. This requires:

- A **public-facing privacy policy URL**.
- A **terms of service URL**.
- **Screencast videos** demonstrating each requested permission in use, showing the exact UX the business owner sees.
- A written **use case description** for each permission.
- **Business Verification** completed.
- Sometimes a domain verification (DNS TXT record).

Review can take days to weeks and is iterative — Meta often asks for changes. Tell users to start this early, not at launch. In development mode, only users with roles in the app (admin, developer, tester) can use the integration.

## Common errors and what they mean

- `(#200) Permissions error` — the scope isn't granted or the app isn't approved for it. Check the token's granted scopes via `/debug_token`.
- `(#10) Application does not have permission` — the Page owner hasn't given the app access to that Page, or the token is a user token not a Page token.
- `(#100) Invalid parameter` — usually a malformed recipient ID (did you use a PSID vs. a real user ID?) or missing field.
- `(#17) User request limit reached` — back off.
- `OAuthException code 190` — token expired or revoked. Mark the connected account as `expired` and prompt reconnection.

Always log the full error response body — Meta's error messages are the only way to debug what actually went wrong.
