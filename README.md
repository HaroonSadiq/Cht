# FlowBot — Serverless Chat Automation SaaS

Multi-tenant chat marketing platform in the ManyChat / Chatfuel category. Business owners connect Instagram, WhatsApp, Messenger and TikTok accounts, build automated flows, and manage contacts — all behind a serverless pipeline.

## Architecture (event-driven, serverless)

```
 Meta / TikTok webhook
        │
        ▼
 Vercel Edge Fn   (api/webhooks/meta.ts, tiktok.ts)
   • verifies HMAC signature
   • idempotency key via Redis SET-NX
   • enqueues job → returns 200 in <2s
        │
        ▼
 Upstash Redis     (lists: q:inbound, q:outbound)
        │
        ▼
 Vercel Cron (1 min)  →  api/worker.ts
   • drains q:inbound  → flow-engine.dispatch → executeStep loop
   • wakes delayed flow_runs (waitUntil ≤ now)
   • drains q:outbound → rate-limited Meta Graph API send
        │
        ▼
 Postgres (Supabase)  +  Meta Graph API
```

Five stages, exactly as spec'd in the PDFs. Everything is stateless between invocations — state lives in Postgres + Redis.

## Tech stack

| Layer | Technology |
|---|---|
| Hosting | **Vercel** (static hosting for `index.html`, Serverless Functions for `/api/*`) |
| Database | **Postgres** via Supabase, Prisma Client |
| Queue / cache | **Upstash Redis** (serverless) |
| Auth | **JWT** (jose), bcryptjs, httpOnly cookie |
| Encryption at rest | **AES-256-GCM** (`lib/crypto.ts`) for OAuth tokens |
| Messaging APIs | **Meta Graph API v20** (FB Pages, Messenger, Instagram), TikTok |
| Validation | **Zod** on every inbound body |

## File map

```
/
├── index.html                          Public marketing landing page
├── prisma/schema.prisma                9-table multi-tenant data model
│
├── api/
│   ├── webhooks/
│   │   ├── meta.ts                     Signature verify → enqueue
│   │   └── tiktok.ts
│   ├── worker.ts                       Cron-triggered queue drain
│   ├── auth/
│   │   ├── signup.ts
│   │   └── signin.ts
│   ├── oauth/meta/
│   │   ├── start.ts                    Redirect to Meta consent
│   │   └── callback.ts                 Code exchange → encrypted token
│   ├── flows/
│   │   ├── index.ts                    GET list, POST create
│   │   └── [id].ts                     GET, PATCH (steps), DELETE
│   └── contacts/index.ts               GET list (filter by tenant)
│
└── lib/
    ├── db.ts                           Prisma client singleton
    ├── redis.ts                        Upstash client + queue helpers
    ├── crypto.ts                       HMAC verify + AES-256-GCM envelope
    ├── meta.ts                         Graph API client + 24h-window check
    ├── flow-engine.ts                  DAG traverser + dispatcher
    └── auth.ts                         JWT session helpers
```

## Data model — 9 tables

| Table | Purpose |
|---|---|
| `users` | Tenants (business owners signing up) |
| `connected_accounts` | FB Pages / IG / TikTok per tenant. Tokens **encrypted at rest**. |
| `contacts` | Every person who's messaged a connected account. `last_inbound_at` powers the 24h window check. |
| `tags` + `contact_tags` | Segmentation for broadcasts & branching |
| `flows` | Top-level automations: trigger + priority + active |
| `flow_steps` | Nodes (send/wait/branch/delay/tag/etc.) in a DAG |
| `flow_runs` | Per-contact execution state — the state machine |
| `message_events` | Every inbound + outbound. Idempotent on `platform_message_id`. |
| `broadcasts` | Mass messages to tag-filtered segments |

Full schema: `prisma/schema.prisma`.

## Local setup

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL, UPSTASH_*, META_*, JWT_SECRET, ENCRYPTION_KEY

npx prisma db push          # create tables
npm run dev                 # vercel dev — local serverless runtime
```

Generate the two 32-byte keys:
```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 32   # JWT_SECRET
```

## Deploy to Vercel

```bash
vercel
vercel env add DATABASE_URL         # paste from Supabase
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
vercel env add META_APP_ID
vercel env add META_APP_SECRET
vercel env add META_WEBHOOK_SECRET
vercel env add META_VERIFY_TOKEN
vercel env add META_REDIRECT_URI
vercel env add ENCRYPTION_KEY
vercel env add JWT_SECRET
vercel env add CRON_SECRET
vercel --prod
```

Cron is declared in `vercel.json` (`* * * * *`) — the queue drains every minute without any extra infra.

## Webhook configuration

In the Meta app dashboard → Webhooks:

- **Callback URL**: `https://<your-domain>/api/webhooks/meta`
- **Verify token**: value of `META_VERIFY_TOKEN`
- **Subscribed fields** (Page): `messages`, `messaging_postbacks`, `messaging_optins`, `feed`
- **Subscribed fields** (Instagram): `messages`, `messaging_postbacks`, `comments`

## Why serverless?

- **Webhook SLA** — Meta requires <3s response. Vercel Edge replies in ~50ms, before any processing.
- **Bursty traffic** — a creator's viral post can drive 10k DMs in 10 minutes. Lambdas scale instantly; a single worker box would drop messages.
- **Zero idle cost** — the entire platform costs cents/month at zero traffic.
- **No infra to run** — Redis is Upstash, Postgres is Supabase, functions are Vercel. One `vercel --prod` ships the whole stack.

## Security

- **HMAC-SHA256** verification on every webhook (`verifyMetaSignature`) using timing-safe compare.
- **AES-256-GCM envelope encryption** on OAuth tokens at rest — cipher + IV + auth tag stored together (`encryptToken`).
- **Per-tenant data isolation** — every query joins via `connectedAccount.userId`; session middleware (`requireUser`) gates all authenticated endpoints.
- **Cron endpoint** gated by a constant-time compared secret.
- **Zod validation** on every POST/PATCH body.
- **httpOnly, SameSite=Lax, Secure** cookies for sessions.

## Roadmap (see landing `#roadmap`)

1. ✅ Webhook ingress + queue + worker
2. ✅ Flow engine + keyword triggers + single-step reply
3. ✅ Visual flow builder (JSON persistence) — *frontend still to ship*
4. 🟡 Growth tools: comment-to-DM, ref URLs, story replies
5. 🟡 AI Agent step type + broadcasts
6. 🔜 Stripe billing + ClickHouse funnel analytics

## License

Proprietary — internal, pre-release.
