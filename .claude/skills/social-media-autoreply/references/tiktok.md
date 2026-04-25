# TikTok

TikTok's API surface for auto-reply is **significantly more restricted** than Meta's. Be upfront with the user about this before writing code — otherwise they'll ship something that doesn't actually work for 90% of their target users.

Always confirm current API capabilities, endpoints, and approval requirements via `web_search` — TikTok's APIs evolve and access policies shift.

## What's actually possible (and what isn't)

**Possible, with work:**

- **OAuth login** for business users via TikTok Login Kit (confirm their identity, link their account to your platform).
- **Read/manage comments** on the business's own videos via the Content Posting API's comment endpoints — which can power a "reply to comments with trigger word" feature.
- **TikTok Shop customer service messaging** — but only for merchants who sell through TikTok Shop, and only via the TikTok Shop Partner API (a separate developer track from the general TikTok for Developers platform).
- **Push notifications/webhooks** for certain events — the specific event types available depend on your app's approved scopes.

**Not generally possible (as of this writing):**

- **Open DM auto-reply** the way Messenger allows. TikTok does not offer a general-purpose third-party API to read and reply to a business account's DMs. Users/creators interacting via DM is not exposed to third-party platforms for automation in the general case.
- **Acting as the business account to send proactive messages to any user.**

**What this means for the product:**

- The TikTok integration will likely be **comment-focused**, not DM-focused.
- For DM automation on TikTok, the honest answer is "not possible via official APIs for general business accounts" — either scope the feature to TikTok Shop merchants only, or set expectations with users that TikTok is comments-only.

## App setup

1. Register at `developers.tiktok.com`.
2. Create an app and request the relevant products: **Login Kit**, **Content Posting API**, and/or **TikTok Shop Partner Platform** if relevant.
3. Complete the business verification for your organization.
4. Go through TikTok's approval process for any scopes beyond basic profile — this includes submitting a use case description and waiting for review.
5. Configure redirect URIs and webhook callback URL if applicable.

## OAuth

TikTok Login Kit flow:

1. Redirect user to TikTok's authorize endpoint with `client_key`, `scope`, `redirect_uri`, `state`, `response_type=code`.
2. User approves → callback with `code` and `state`.
3. Verify `state`.
4. Exchange `code` for an access token at TikTok's token endpoint (takes `client_key`, `client_secret`, `code`, `grant_type=authorization_code`).
5. Response returns `access_token`, `refresh_token`, `expires_in`, `open_id`, `scope`.
6. Store encrypted. Refresh tokens proactively — access tokens expire on the order of 24 hours.

Scopes are modular. Request only what's needed. For comment management on the user's own videos, you'll typically need comment-related scopes within the Content Posting API (verify current names in docs at build time).

## Reading comments

The flow is usually:

1. List the authenticated user's videos.
2. For each video, list comments.
3. Poll on an interval, OR subscribe to a webhook event if the relevant event type is approved for your app.

Polling is more reliable as a starting point — webhook approval for comment events requires a higher tier of app access.

Store each new comment in `message_events` with `channel='comment'` and `platform_message_id` set to TikTok's comment ID, so the idempotency logic from the main architecture works the same way.

## Replying to comments

Post a reply via TikTok's comment reply endpoint, authenticated with the user's token. This creates a reply nested under the original comment. Check that your app's scopes cover comment creation, not just reading.

## Webhooks (if applicable for your app tier)

If your app has webhook event access:

1. Configure callback URL in the app dashboard.
2. Verify incoming requests via TikTok's signature mechanism (check current docs — it differs from Meta's `X-Hub-Signature-256`).
3. Same architectural rules as Meta: verify signature, enqueue fast, return 200.

## Rate limits

TikTok rate limits are per-app and per-user. They're less publicly documented than Meta's; expect to discover them by hitting them. Log all response headers and back off on 429. Keep polling intervals conservative (e.g., every few minutes per account, not every few seconds).

## TikTok Shop (separate track)

If the user is specifically targeting TikTok Shop merchants:

- This is a **different developer portal** (TikTok Shop Partner Platform) with its own app registration, auth, and API surface.
- It offers **merchant-to-customer messaging** APIs for order/shop-related conversations.
- Access is gated — you register as a partner, go through review, and operate under a stricter compliance regime.
- Treat it as a separate integration in the codebase — probably a separate `platform` value like `'tiktok_shop'` in `connected_accounts`.

## Scoping the feature honestly in the UI

On the "connect account" screen, make the TikTok option's description accurate. Something like:

> Connect a TikTok Business Account to auto-reply to **comments** on your videos based on trigger words. DM automation is not currently supported by TikTok's API for general business accounts.

If you're also supporting TikTok Shop:

> Connecting a TikTok Shop merchant account additionally enables auto-replies to customer service messages on your shop.

This saves support tickets later.
