// Generates flwobotdocumentation.pdf — comprehensive technical reference
// for the FlowBot project. Single-pass: run once with `node scripts/gen-doc.mjs`.
//
// Layout primitives (h1/h2/h3/p/bullet/code/table) all consume from a single
// theme object, so the visual style stays consistent across ~30+ pages.

import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';

// ─── Theme ─────────────────────────────────────────────────────────────
const T = {
  ink:   '#0e0e0c',
  ink2:  '#2a2a26',
  mute:  '#6b6b64',
  hair:  '#d4d2ca',
  bg:    '#fafaf7',
  bg2:   '#f1f0ea',
  accent:'#ff5a1f',
  mag:   '#d924e8',
  mint:  '#00c98a',
  amber: '#a8650c',
  err:   '#a83232',
};

const out = 'flwobotdocumentation.pdf';
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 60, bottom: 60, left: 60, right: 60 },
  info: {
    Title: 'FlowBot — Technical Documentation',
    Author: 'Muhammad Haroon Sadiq',
    Subject: 'Architecture, webhooks, APIs, and operations reference',
    Keywords: 'FlowBot, ManyChat, comment-to-DM, Meta, Vercel, Prisma, Supabase, Upstash',
  },
});
doc.pipe(createWriteStream(out));

// ─── Layout helpers ────────────────────────────────────────────────────
const PAGE_W = doc.page.width  - doc.page.margins.left - doc.page.margins.right;
let pageNumber = 1;
const pageNumbers = [];

function addPageNumber() {
  // We'll write footers in a second pass at the end.
  pageNumbers.push({ page: pageNumber, label: `${pageNumber}` });
}
addPageNumber();

doc.on('pageAdded', () => {
  pageNumber++;
  addPageNumber();
  resetTopOfPage();
});

function resetTopOfPage() {
  // Thin accent rule + page header on every page after the cover.
  if (pageNumber === 1) return;
  doc.save();
  doc.fillColor(T.mute).fontSize(8).font('Helvetica');
  doc.text('FlowBot Technical Documentation', 60, 30);
  doc.text(new Date().toISOString().slice(0, 10), 0, 30, { width: doc.page.width - 60, align: 'right' });
  doc.moveTo(60, 48).lineTo(doc.page.width - 60, 48).strokeColor(T.hair).lineWidth(0.5).stroke();
  doc.restore();
  doc.x = 60; doc.y = 60;
}

function spaceBefore(n) { doc.moveDown(n); }

function h1(text) {
  ensureSpace(80);
  doc.moveDown(0.6);
  doc.fillColor(T.ink).font('Helvetica-Bold').fontSize(24).text(text);
  doc.strokeColor(T.accent).lineWidth(2).moveTo(doc.x, doc.y + 4).lineTo(doc.x + 40, doc.y + 4).stroke();
  doc.moveDown(0.8);
}

function h2(text) {
  ensureSpace(40);
  doc.moveDown(0.5);
  doc.fillColor(T.ink).font('Helvetica-Bold').fontSize(15).text(text);
  doc.moveDown(0.3);
}

function h3(text) {
  ensureSpace(28);
  doc.moveDown(0.3);
  doc.fillColor(T.ink2).font('Helvetica-Bold').fontSize(11.5).text(text);
  doc.moveDown(0.15);
}

function p(text, opts = {}) {
  doc.fillColor(T.ink2).font('Helvetica').fontSize(10).text(text, { align: 'left', ...opts });
  doc.moveDown(0.3);
}

function muted(text) {
  doc.fillColor(T.mute).font('Helvetica-Oblique').fontSize(9).text(text);
  doc.moveDown(0.3);
}

function bullets(items) {
  doc.fillColor(T.ink2).font('Helvetica').fontSize(10);
  for (const it of items) {
    ensureSpace(14);
    doc.text('•  ' + it, { indent: 8 });
  }
  doc.moveDown(0.3);
}

function code(text) {
  const lines = text.split('\n');
  const lineHeight = 11;
  const padding = 8;
  const blockHeight = lines.length * lineHeight + padding * 2;
  ensureSpace(blockHeight + 10);
  const x = doc.x, y = doc.y;
  doc.save();
  doc.roundedRect(x, y, PAGE_W, blockHeight, 4).fillColor(T.bg2).fill();
  doc.restore();
  doc.fillColor(T.ink).font('Courier').fontSize(8.5);
  doc.text(text, x + padding, y + padding, { width: PAGE_W - padding * 2 });
  doc.y = y + blockHeight + 8;
  doc.x = x;
}

function inlineCode(text) {
  // Simple inline code formatter — used in p() via `…` markers, but for short
  // standalone identifiers we just use Courier inline.
  doc.font('Courier').fontSize(9.5).fillColor(T.ink).text(text, { continued: true });
}

function ensureSpace(needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function divider() {
  ensureSpace(20);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.strokeColor(T.hair).lineWidth(0.5).moveTo(doc.x, y).lineTo(doc.x + PAGE_W, y).stroke();
  doc.moveDown(0.4);
}

function kvTable(rows) {
  const colWidths = [Math.floor(PAGE_W * 0.32), PAGE_W - Math.floor(PAGE_W * 0.32)];
  doc.font('Helvetica').fontSize(9.5);
  for (const [k, v] of rows) {
    ensureSpace(20);
    const startY = doc.y;
    const startX = doc.x;
    doc.fillColor(T.mute).text(k, startX, startY, { width: colWidths[0], continued: false });
    const kHeight = doc.y - startY;
    doc.fillColor(T.ink2).text(v, startX + colWidths[0], startY, { width: colWidths[1] });
    const vHeight = doc.y - startY;
    doc.y = startY + Math.max(kHeight, vHeight) + 2;
    doc.strokeColor(T.hair).lineWidth(0.3).moveTo(startX, doc.y).lineTo(startX + PAGE_W, doc.y).stroke();
    doc.moveDown(0.15);
  }
}

function table(header, rows, weights) {
  const totalW = PAGE_W;
  const cols = weights.map((w) => Math.floor(totalW * w));
  cols[cols.length - 1] = totalW - cols.slice(0, -1).reduce((a, b) => a + b, 0);
  // Header
  ensureSpace(28);
  doc.save();
  doc.rect(doc.x, doc.y, totalW, 18).fillColor(T.bg2).fill();
  doc.restore();
  doc.fillColor(T.ink).font('Helvetica-Bold').fontSize(9);
  let x = doc.x, y = doc.y + 5;
  for (let i = 0; i < header.length; i++) {
    doc.text(header[i], x + 6, y, { width: cols[i] - 8 });
    x += cols[i];
  }
  doc.y = y + 14;
  // Rows
  doc.font('Helvetica').fontSize(9).fillColor(T.ink2);
  for (const row of rows) {
    const startY = doc.y;
    let maxH = 0;
    let cx = doc.x;
    for (let i = 0; i < row.length; i++) {
      doc.text(String(row[i] ?? ''), cx + 6, startY + 4, { width: cols[i] - 8 });
      const h = doc.y - startY;
      if (h > maxH) maxH = h;
      cx += cols[i];
    }
    doc.y = startY + maxH + 4;
    doc.strokeColor(T.hair).lineWidth(0.3).moveTo(doc.x, doc.y).lineTo(doc.x + totalW, doc.y).stroke();
    ensureSpace(28);
  }
  doc.moveDown(0.4);
}

function callout(title, body, kind = 'info') {
  const color = kind === 'warn' ? T.amber : kind === 'err' ? T.err : T.accent;
  const blockH = 50 + (body.length / 80) * 12;
  ensureSpace(blockH);
  const x = doc.x, y = doc.y;
  doc.save();
  doc.roundedRect(x, y, PAGE_W, blockH, 6).fillColor(T.bg).fill();
  doc.rect(x, y, 3, blockH).fillColor(color).fill();
  doc.restore();
  doc.fillColor(color).font('Helvetica-Bold').fontSize(9.5).text(title.toUpperCase(), x + 14, y + 10);
  doc.fillColor(T.ink2).font('Helvetica').fontSize(9.5).text(body, x + 14, y + 25, { width: PAGE_W - 24 });
  doc.y = y + blockH + 8;
  doc.x = x;
}

// ─── COVER ─────────────────────────────────────────────────────────────
doc.fillColor(T.ink);
doc.rect(0, 0, doc.page.width, 220).fillColor(T.ink).fill();
doc.fillColor('#fff').font('Helvetica-Bold').fontSize(40).text('FlowBot', 60, 80);
doc.fillColor(T.accent).fontSize(14).font('Helvetica').text('Comment-to-DM automation SaaS', 60, 130);
doc.fillColor('#9a988f').fontSize(11).text('Multi-tenant. Serverless. Production-grade.', 60, 152);

doc.fillColor(T.ink).font('Helvetica-Bold').fontSize(32).text('Technical', 60, 260);
doc.text('Documentation', 60, 295);
doc.fillColor(T.mute).font('Helvetica').fontSize(12);
doc.text('Architecture · Webhooks · APIs · Operations Reference', 60, 348);

doc.fillColor(T.ink2).fontSize(10).font('Helvetica-Bold').text('PROJECT', 60, 460);
doc.font('Helvetica').fillColor(T.ink2).text('FlowBot SaaS — comment-to-DM automation for Facebook, Instagram, and TikTok', 60, 478, { width: PAGE_W });

doc.font('Helvetica-Bold').text('OWNER', 60, 520);
doc.font('Helvetica').text('Muhammad Haroon Sadiq · mharoonsadiq8@gmail.com', 60, 538);

doc.font('Helvetica-Bold').text('LIVE DEPLOYMENT', 60, 560);
doc.font('Helvetica').text('https://chtmodel.vercel.app', 60, 578);

doc.font('Helvetica-Bold').text('REPOSITORY', 60, 600);
doc.font('Helvetica').text('https://github.com/HaroonSadiq/Cht', 60, 618);

doc.font('Helvetica-Bold').text('VERSION', 60, 640);
doc.font('Helvetica').text(`0.1.0 — generated ${new Date().toISOString().slice(0, 10)}`, 60, 658);

doc.fillColor(T.mute).fontSize(8).font('Helvetica-Oblique').text(
  'This document is for personal use to cross-verify the implementation. It mirrors the live ' +
  'codebase as of the generation date. Where the code and this document disagree, the code is authoritative.',
  60, 720, { width: PAGE_W }
);

doc.addPage();

// ─── TABLE OF CONTENTS ─────────────────────────────────────────────────
h1('Contents');
const toc = [
  ['1.  Executive Summary',                            null],
  ['2.  System Architecture',                          null],
  ['3.  External Resources & Services',                null],
  ['4.  Environment Variables',                        null],
  ['5.  Database Schema',                              null],
  ['6.  Webhook Implementations',                      null],
  ['     6.1  Meta Webhook (Facebook + Instagram)',    null],
  ['     6.2  TikTok Webhook',                         null],
  ['     6.3  Data Deletion Callback',                 null],
  ['7.  REST API Surface',                             null],
  ['8.  OAuth Flow (Facebook Login for Business)',     null],
  ['9.  The Worker (queue + cron)',                    null],
  ['10. Flow Engine & Trigger Matching',               null],
  ['11. Frontend (Website + Dashboard)',               null],
  ['12. Security Architecture',                        null],
  ['13. Deployment & CI/CD',                           null],
  ['14. End-to-End Workflow',                          null],
  ['15. Operations & Smoke Tests',                     null],
  ['16. Meta App Review',                              null],
  ['17. Known Limitations & Roadmap',                  null],
];
doc.fillColor(T.ink2).font('Helvetica').fontSize(11);
for (const [label] of toc) {
  ensureSpace(18);
  doc.text(label);
}

doc.addPage();

// ─── 1. EXECUTIVE SUMMARY ──────────────────────────────────────────────
h1('1. Executive Summary');
p(
  'FlowBot is a multi-tenant comment-to-DM automation SaaS in the same product category as ManyChat ' +
  'and Chatfuel. Page admins connect their Facebook/Instagram Page through Facebook Login for Business, ' +
  'configure keyword-triggered automation rules, and FlowBot reacts to incoming comments by posting a ' +
  'public reply and sending a private DM — all within ~10 seconds of the comment landing.'
);
p(
  'The implementation is fully serverless on Vercel (12 functions on the Hobby plan), with PostgreSQL ' +
  'hosted on Supabase, Redis on Upstash, and OAuth/webhook integrations against Meta Graph API v22 and ' +
  'TikTok Open API. The architecture is designed to be drop-in upgradable to Vercel Pro / dedicated ' +
  'workers without changing application code.'
);

h3('Key product capabilities');
bullets([
  'Comment-to-DM automation on Facebook Pages, Instagram Business accounts, and TikTok',
  'Per-tenant keyword uniqueness with denormalized keyword arrays for fast lookup',
  'Time-bounded rules (validFromAt / validUntilAt) auto-expire after 3 days by default',
  'Public reply + private DM in a single rule, written via the dashboard form',
  'Multi-page workspaces — one user can manage multiple Pages via separate ConnectedAccount records',
  '24-hour Standard Messaging window enforcement; comment-to-DM uses comment_id recipient mode',
  'Real-time analytics via Redis HINCRBY counters and Redis Streams event bus',
  'Idempotent webhook delivery (markSeen with TTL) so duplicate Meta deliveries are no-ops',
  'AES-256-GCM envelope encryption of access tokens at rest',
  'JWT session auth (jose) with HTTP-only secure cookies',
]);

h3('Key engineering invariants');
bullets([
  'Every API query is filtered by user_id (tenant key) at the application layer',
  'Every webhook POST verifies HMAC-SHA256 against the platform secret before any work',
  'Every outbound DM is rate-limited per ConnectedAccount (200/min sends, 30/min replies)',
  'Every long operation is queued and ACK\'d in <2 seconds; the worker runs the actual send',
  'Every TypeScript file passes tsc --noEmit; offline smoke tests cover all crypto + parsing logic',
]);

doc.addPage();

// ─── 2. SYSTEM ARCHITECTURE ────────────────────────────────────────────
h1('2. System Architecture');
p(
  'FlowBot follows a fan-in / queue / fan-out pattern. The fan-in side is the webhook ingress: every ' +
  'event from Meta or TikTok arrives at /api/webhooks/* where it is HMAC-verified, normalized to a ' +
  'common envelope, persisted to the jobs table, and pushed to a Redis list. The handler ACKs to Meta ' +
  'in <2 seconds (Meta\'s requirement) and exits — no business logic runs in the request path.'
);
p(
  'The queue is drained by /api/worker, which Vercel Cron triggers daily and a GitHub Actions cron ' +
  'triggers every 5 minutes. The worker pops jobs in batches, runs the flow-matching dispatcher, and ' +
  'enqueues any resulting comment-replies + outbound DMs into separate queues. It then drains those ' +
  'queues too, calling Meta Graph API to perform the actual sends.'
);

h3('Request topology');
code(
`Client (browser)
   ↓ HTTPS
Vercel Edge ──→ Static (index.html, dashboard.html, …)
   ↓
Vercel Functions (api/*)
   ↓                    ↓
Postgres (Supabase)   Redis (Upstash)
                        ↓
            Streams: bus:events:meta
            Queues:  q:inbound, q:outbound, q:comment-replies
                        ↑
            Worker (cron-triggered) → Meta Graph API`
);

h3('Component map');
table(
  ['Component', 'Tech', 'Responsibility'],
  [
    ['Edge / static',     'Vercel CDN',                   'Serves landing, dashboard, privacy, terms, deletion-status pages and the assistant widget.'],
    ['API functions',     'Vercel Serverless (Node 20)',  '12 TypeScript handlers under api/. Each handler is one entry point; catch-all routes consolidate URLs.'],
    ['Database',          'PostgreSQL on Supabase',       '10-table schema. Connection via Supabase Transaction Pooler (port 6543).'],
    ['Cache + queue',     'Upstash Redis (REST)',         'Idempotency seen-set, three job queues, Redis Streams event bus, per-tenant rate-limit buckets.'],
    ['Worker scheduler',  'Vercel Cron + GitHub Actions', 'Vercel daily cron (Hobby limit) plus GitHub Actions every 5 minutes for production cadence.'],
    ['Object storage',    'None (not yet used)',          'Future: Cloudflare R2 / Vercel Blob for media attachments.'],
    ['Auth',              'jose JWT + HTTP-only cookie',  'Email + bcrypt password. JWT signed with JWT_SECRET. 30-day expiry.'],
    ['Token encryption',  'AES-256-GCM (Node crypto)',    'OAuth access tokens encrypted at rest with ENCRYPTION_KEY (32-byte base64).'],
    ['CDN fonts',         'Google Fonts',                 'Inter, Instrument Serif, JetBrains Mono — preconnected for fast first paint.'],
  ],
  [0.18, 0.22, 0.6]
);

h3('Tenant isolation model');
p('Three-level hierarchy: User → Workspace → ConnectedAccount → Flow.');
bullets([
  'User: auth identity. Owns one or more workspaces.',
  'Workspace: tenant scope. Has a slug like ws_1jkqs7. Owner has full CRUD on contained resources.',
  'ConnectedAccount: a single Page integration. One user can connect multiple Pages — each becomes a separate ConnectedAccount. Carries the encrypted access token.',
  'Flow: an automation rule scoped to one ConnectedAccount. Two flows on the same Page cannot share a keyword (uniqueness check at create time).',
]);
callout('Tenancy invariant',
  'Every database query in the API layer must include a where: { ... ownerId: userId } clause via the resolveOwnedAccount helper in lib/tenancy.ts. There is no shared-superuser query path.');

doc.addPage();

// ─── 3. EXTERNAL RESOURCES ─────────────────────────────────────────────
h1('3. External Resources & Services');

h3('Hosting & infrastructure');
table(
  ['Service', 'Used for', 'Plan'],
  [
    ['Vercel',                   'Serverless functions, static hosting, edge CDN, daily cron',     'Hobby (free)'],
    ['Supabase',                 'PostgreSQL database (transaction + session poolers)',            'Free tier'],
    ['Upstash',                  'Redis (REST API): seen-set, queues, streams, rate limits',      'Free tier'],
    ['GitHub',                   'Source control + Actions cron (every 5 min)',                    'Free'],
    ['GitHub Actions',           'Replaces Vercel\'s daily-cron Hobby limit with 5-min cadence',  'Free (within minute limits)'],
    ['Google Fonts',             'Inter, Instrument Serif, JetBrains Mono web fonts',              'Free'],
  ],
  [0.22, 0.55, 0.23]
);

h3('Identity & messaging providers');
table(
  ['Service',                          'Used for'],
  [
    ['Meta Graph API v22',             'Page enumeration, page tokens, page subscriptions, send messages, post comment replies'],
    ['Facebook Login for Business',    'OAuth dialog with config_id 2728012970932296 — replaces scope-based OAuth'],
    ['Meta App Webhooks',              'Page-level subscriptions for feed, messages, messaging_postbacks, message_deliveries'],
    ['Instagram Graph API',            'Comments + DMs on Instagram Business accounts (linked via FB Page)'],
    ['TikTok Open API',                'Comment events + TikTok Shop CS messages (HMAC-SHA256 with TIKTOK_CLIENT_SECRET)'],
  ],
  [0.32, 0.68]
);

h3('npm packages');
table(
  ['Package',                 'Purpose'],
  [
    ['@prisma/client',         'PostgreSQL ORM with type-safe queries'],
    ['@upstash/redis',         'Upstash Redis REST client (works in serverless without persistent connections)'],
    ['@vercel/node',           'Vercel function types (VercelRequest, VercelResponse)'],
    ['bcryptjs',               'Password hashing (cost factor 12)'],
    ['jose',                   'JWT signing + verification (HS256) for session cookies'],
    ['zod',                    'Runtime validation of request bodies + query params'],
    ['typescript',             'Static type-checking; tsc --noEmit gates every change'],
    ['prisma',                 'CLI for schema migrations and client generation'],
    ['@resvg/resvg-js',        'SVG → PNG rasterization for app icon generation'],
    ['pdfkit (one-shot)',      'This documentation generator (installed --no-save)'],
  ],
  [0.32, 0.68]
);

doc.addPage();

// ─── 4. ENVIRONMENT VARIABLES ──────────────────────────────────────────
h1('4. Environment Variables');
muted(
  'All variables live in .env locally and in the Vercel project Settings → Environment Variables for ' +
  'Production. Names only are shown below — values are confidential and stored outside this document.'
);

h3('Database');
table(
  ['Variable', 'Purpose', 'Example shape'],
  [
    ['DATABASE_URL',  'Postgres connection (transaction pooler, port 6543, pgbouncer mode). Used by Prisma at runtime.', 'postgresql://postgres.xxx:xxx@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'],
    ['DIRECT_URL',    'Direct/session-pooler URL (port 5432). Used by Prisma migrate / db push only.',  'postgresql://postgres.xxx:xxx@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'],
  ],
  [0.18, 0.42, 0.4]
);

h3('Redis');
table(
  ['Variable', 'Purpose'],
  [
    ['UPSTASH_REDIS_REST_URL',   'Upstash REST endpoint, typically https://xxxx.upstash.io'],
    ['UPSTASH_REDIS_REST_TOKEN', 'Bearer token for the Upstash REST API'],
  ],
  [0.32, 0.68]
);

h3('Crypto & sessions');
table(
  ['Variable', 'Purpose', 'Format'],
  [
    ['ENCRYPTION_KEY',  'Symmetric key for AES-256-GCM token encryption at rest', 'base64-encoded 32 bytes (44 chars)'],
    ['JWT_SECRET',      'Symmetric secret for jose JWT HS256 session signing',     'base64 random secret (44 chars)'],
    ['CRON_SECRET',     'Authorizes calls to /api/worker. Must match ?key= param', 'random hex string'],
  ],
  [0.18, 0.5, 0.32]
);

h3('Meta');
table(
  ['Variable', 'Purpose'],
  [
    ['META_APP_ID',          'Numeric Meta App ID from developers.facebook.com'],
    ['META_APP_SECRET',      'App secret. Used for webhook HMAC + signed_request verification'],
    ['META_VERIFY_TOKEN',    'Arbitrary string Meta echoes during the GET /api/webhooks/meta handshake'],
    ['META_WEBHOOK_SECRET',  'Same value as META_APP_SECRET (kept separate so they can be rotated independently if needed)'],
    ['META_REDIRECT_URI',    'OAuth callback. Now derived from request host but kept as fallback'],
    ['META_CONFIG_ID',       'Facebook Login for Business Configuration ID — currently 2728012970932296'],
  ],
  [0.28, 0.72]
);

h3('TikTok');
table(
  ['Variable', 'Purpose'],
  [
    ['TIKTOK_CLIENT_KEY',     'TikTok app client key from developers.tiktok.com'],
    ['TIKTOK_CLIENT_SECRET',  'TikTok app secret. Used for HMAC-SHA256 webhook signature on tiktok-signature header'],
    ['TIKTOK_REDIRECT_URI',   'OAuth callback for TikTok login (currently unused — coming with TikTok Login flow)'],
  ],
  [0.28, 0.72]
);

h3('Misc');
table(
  ['Variable', 'Purpose'],
  [
    ['APP_URL', 'Fallback origin when x-forwarded-host header is missing. Set to https://chtmodel.vercel.app'],
  ],
  [0.18, 0.82]
);

callout('Rotation notes',
  'ENCRYPTION_KEY must NEVER be rotated without a re-encryption migration: existing access tokens in connected_accounts.access_token_encrypted are sealed with the current key. JWT_SECRET rotation invalidates all sessions (acceptable). META_APP_SECRET rotation requires updating Meta App settings simultaneously to avoid signature failures.', 'warn');

doc.addPage();

// ─── 5. DATABASE SCHEMA ────────────────────────────────────────────────
h1('5. Database Schema');
p('Prisma schema at prisma/schema.prisma. PostgreSQL backend on Supabase. 10 tables.');

h3('Entity relationship summary');
code(
`User (1) ──< Workspace (1) ──< ConnectedAccount (1) ──< Flow (1) ──< FlowStep
                                          │
                                          ├──< Contact (1) ──< MessageEvent
                                          │             └──< FlowRun
                                          ├──< Job
User (1) ──< Broadcast
Workspace (1) ──< Tag (M)──< ContactTag >──(M) Contact`
);

h3('Tables');
table(
  ['Table', 'Purpose', 'Cascade'],
  [
    ['users',              'Auth identity (email + bcrypt password hash + name)',                    '— '],
    ['workspaces',         'Tenant scope. owner_id → users.id',                                       'on delete cascade from user'],
    ['connected_accounts', 'Per-platform Page connection. Unique (workspace_id, platform, page_id). Encrypted access token. webhook_config JSON includes installer_user_id.', 'cascade from workspace'],
    ['contacts',           'Every customer who has interacted with the Page. last_inbound_at powers the 24h messaging window.', 'cascade from connected_account'],
    ['tags',               'Workspace-scoped segmentation labels',                                    'cascade from workspace'],
    ['contact_tags',       'M:M between contacts and tags. applied_by tracks origin (flow/manual/import).', 'cascade'],
    ['flows',              'Automation rule. Denormalized keywords[] for fast per-page lookup. validUntilAt for expiry.', 'cascade from connected_account'],
    ['flow_steps',         'Steps in a flow DAG. step_type enum covers send_message, wait_for_reply, delay, branch, add_tag, etc.', 'cascade from flow'],
    ['flow_runs',          'Per-contact execution state machine. status: active | waiting_for_reply | completed | errored | cancelled.', 'cascade'],
    ['message_events',     'Every inbound + outbound message. Unique (connected_account_id, platform_message_id) for idempotency.', 'cascade from contact'],
    ['broadcasts',         'Mass messages to a tagged segment. status: draft | scheduled | sending | completed | failed.', 'cascade from user'],
    ['jobs',               'Durable queue-job tracking. Mirrors the Redis fast path so admins can inspect status + audit trail.', 'set null from connected_account'],
  ],
  [0.18, 0.62, 0.2]
);

h3('Critical indexes');
bullets([
  'flows.keywords (GIN) — fast keyword-array containment for per-page trigger matching',
  'flows.validUntilAt — used by the periodic expire-stale-flows sweeper',
  'contacts (connected_account_id, last_inbound_at DESC) — recent-activity queries',
  'message_events.UNIQUE (connected_account_id, platform_message_id) — webhook idempotency',
  'jobs (status, created_at) — worker drains by status + age',
]);

doc.addPage();

// ─── 6. WEBHOOK IMPLEMENTATIONS ────────────────────────────────────────
h1('6. Webhook Implementations');

// ── 6.1 META ──
h2('6.1 Meta Webhook (Facebook + Instagram)');
p('Path: POST /api/webhooks/meta · Source: api/webhooks/meta.ts');

h3('GET handshake');
p('Meta verifies subscription ownership with a GET request: ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…. The handler returns the challenge if verify_token matches META_VERIFY_TOKEN, otherwise 403.');

h3('POST event ingestion (JSON body)');
bullets([
  'Reads raw body (bodyParser disabled so signature verification matches byte-exact body)',
  'Verifies x-hub-signature-256 header against HMAC-SHA256(rawBody, META_WEBHOOK_SECRET) — constant-time compare',
  'On signature failure: 401',
  'Parses payload as JSON',
  'Detects platform: payload.object === "instagram" → instagram, else messenger',
  'normalizeMetaPayload (lib/events.ts) flattens entry[].messaging[] and entry[].changes[] into a list of NormalizedEvent',
  'For each event: markSeen(event_id) — Redis SET NX EX 86400. If duplicate → skip',
  'Resolves ConnectedAccount by platformAccountId (page_id) so the job is tagged with the tenant',
  'createAndEnqueueJob → row in jobs table + LPUSH to facebook-events queue',
  'emitEvent to Redis Stream bus:events:meta (for analytics consumer + future plugins)',
  'Returns 200 with { accepted: jobs.length, jobs: [...] }',
]);

h3('Subscribed fields');
bullets([
  'feed (FB) — comments on Page posts',
  'messages — incoming DMs',
  'messaging_postbacks — button click payloads',
  'message_deliveries — delivery receipts',
  'comments (IG) — Instagram comment events',
]);

h3('POST data deletion callback (form-encoded body)');
p('Same endpoint — content-type detection routes form-encoded bodies with signed_request= to handleDataDeletion(). See section 6.3.');

// ── 6.2 TIKTOK ──
h2('6.2 TikTok Webhook');
p('Path: POST /api/webhooks/tiktok · Source: api/webhooks/tiktok.ts');
bullets([
  'Reads raw body (bodyParser disabled)',
  'Verifies tiktok-signature header against HMAC-SHA256(rawBody, TIKTOK_CLIENT_SECRET) — constant-time compare',
  'Parses JSON, derives idempotency key from payload.event_id (or synthetic timestamp+random)',
  'markSeen → on duplicate, returns 200 immediately',
  'Otherwise enqueueInbound to q:inbound for the worker to process',
  'Returns 200 OK',
]);
muted('TikTok integration today is partial: comment events + TikTok Shop CS messages are accepted, but the TikTok-side flow engine paths are not yet plumbed end-to-end.');

// ── 6.3 DELETION ──
h2('6.3 Data Deletion Callback (Meta-required)');
p('Path: POST /api/data-deletion (rewritten to /api/webhooks/meta) · Source: api/webhooks/meta.ts → handleDataDeletion()');
bullets([
  'Meta sends application/x-www-form-urlencoded body with field signed_request=…',
  'Format: base64url(HMAC-SHA256(payload, app_secret)) "." base64url(payload_json)',
  'parseFacebookSignedRequest (lib/crypto.ts) verifies the signature with constant-time compare and returns the decoded { algorithm, user_id, issued_at } payload',
  'Looks up ConnectedAccounts where webhookConfig.installer_user_id matches the user_id (captured during OAuth)',
  'Hard-deletes matching ConnectedAccount rows — cascades remove all flows, contacts, message_events, flow_runs',
  'Stores the deletion record in Redis for 90 days at key deletion:<code>',
  'Returns Meta\'s required JSON: { url: "https://chtmodel.vercel.app/data-deletion-status?code=…", confirmation_code: "del_…" }',
]);
p('GET /api/webhooks/meta?deletion_status=<code> serves the JSON status lookup that the user-facing /data-deletion-status page calls.');

doc.addPage();

// ─── 7. REST API SURFACE ───────────────────────────────────────────────
h1('7. REST API Surface');
p('All 12 Vercel functions and the routes they serve. URLs marked auth-gated require a valid session cookie; webhook endpoints require HMAC signature verification.');

table(
  ['File', 'Path(s)', 'Method', 'Auth'],
  [
    ['api/health.ts',                              '/api/health',                           'GET',          'Public'],
    ['api/webhooks/meta.ts',                       '/api/webhooks/meta',                    'GET, POST',    'HMAC (POST)'],
    ['',                                            '/api/data-deletion (rewrite)',          'POST',         'signed_request'],
    ['api/webhooks/tiktok.ts',                     '/api/webhooks/tiktok',                  'POST',         'HMAC'],
    ['api/worker.ts',                              '/api/worker?key=…',                     'GET',          'CRON_SECRET'],
    ['api/auth/[action].ts',                       '/api/auth/signup',                      'POST',         'Public'],
    ['',                                            '/api/auth/signin',                      'POST',         'Public'],
    ['',                                            '/api/auth/signout',                     'POST',         'Session'],
    ['',                                            '/api/auth/me',                          'GET',          'Session'],
    ['api/oauth/meta/[step].ts',                   '/api/oauth/meta/start',                 'GET',          'Session'],
    ['',                                            '/api/oauth/meta/callback',              'GET',          'state token'],
    ['api/integrations/[...path].ts',              '/api/integrations',                     'GET',          'Session'],
    ['',                                            '/api/integrations/:id',                 'GET, PATCH, DELETE', 'Session'],
    ['',                                            '/api/integrations/:id?_action=posts',   'GET',          'Session'],
    ['',                                            '/api/integrations/:id?_action=metrics', 'GET',          'Session'],
    ['',                                            '/api/integrations/:id?_action=resubscribe', 'POST',     'Session'],
    ['api/flows/[...path].ts',                     '/api/flows',                            'GET',          'Session'],
    ['',                                            '/api/flows/comment-to-dm',              'POST',         'Session'],
    ['',                                            '/api/flows/:id',                        'GET, PATCH, DELETE', 'Session'],
    ['',                                            '/api/flows/:id?_action=test',           'POST',         'Session'],
    ['',                                            '/api/flows/:id?_action=extend',         'POST',         'Session'],
    ['api/conversations/[contactId]/[action].ts',  '/api/conversations/:contactId/messages','GET',          'Session'],
    ['',                                            '/api/conversations/:contactId/send',    'POST',         'Session'],
    ['api/contacts.ts',                            '/api/contacts',                         'GET',          'Session'],
    ['api/events.ts',                              '/api/events?take=N',                    'GET',          'Session'],
    ['api/jobs/[id].ts',                           '/api/jobs/:id',                         'GET',          'Session'],
  ],
  [0.22, 0.42, 0.18, 0.18]
);

callout('Vercel routing quirks',
  'The required catch-all [...path].ts pattern silently 404s on multi-segment URLs at the platform level. Action sub-paths therefore use ?_action=name query params instead of /name path segments. The dashboard calls /api/flows/_root and /api/integrations/_root because plain /api/flows produces a 404 from the platform itself.', 'warn');

doc.addPage();

// ─── 8. OAUTH FLOW ─────────────────────────────────────────────────────
h1('8. OAuth Flow (Facebook Login for Business)');
p('Source: api/oauth/meta/[step].ts. Two steps: /start kicks off the Meta consent dialog, /callback exchanges the code for tokens.');

h3('Step 1 — /api/oauth/meta/start (GET, session-required)');
bullets([
  'Generates a 24-byte base64url state token',
  'Stores oauth:<state> → userId in Redis with 600-second TTL (CSRF defense)',
  'Builds the OAuth URL using FBLfB Configuration ID (META_CONFIG_ID = 2728012970932296) — config_id replaces the legacy scope= parameter',
  'redirect_uri is derived from x-forwarded-host (avoids the bug where APP_URL gets stale after a project rename)',
  'Returns 302 to https://www.facebook.com/v22.0/dialog/oauth?client_id=…&config_id=…&state=…',
]);

h3('Step 2 — /api/oauth/meta/callback (GET)');
bullets([
  'Reads ?code= and ?state= from the redirect',
  'Validates state via Redis (atomic GET + DEL)',
  'Exchanges code → short-lived user token (Graph API /oauth/access_token)',
  'Exchanges short-lived → long-lived (~60 day) user token (fb_exchange_token grant)',
  'Fetches /me?fields=id to capture the installer\'s FB user_id (used by the data-deletion callback)',
  'Enumerates /me/accounts → list of Pages the user administers',
  'For each Page: checks for an associated instagram_business_account',
  'Upserts a ConnectedAccount row per Page (and per IG account if linked) with AES-256-GCM encrypted access token',
  'POSTs to /:pageId/subscribed_apps with subscribed_fields to register the Page for webhooks',
  'Stores installer_user_id in webhookConfig JSON for deletion lookups',
  'Redirects to /dashboard?connected=meta',
]);

h3('Token refresh strategy');
p('Long-lived Page tokens issued via fb_exchange_token are typically valid ~60 days. There is currently no automated refresh — when a token expires, outbound DM sends fail with Graph API code 190, which the worker catches and marks the ConnectedAccount.status = "expired". The user re-OAuths to refresh.');

doc.addPage();

// ─── 9. WORKER ─────────────────────────────────────────────────────────
h1('9. The Worker (queue + cron)');
p('Source: api/worker.ts. Single function drains all queues. Triggered by Vercel daily cron AND GitHub Actions every 5 minutes (the latter compensates for Vercel Hobby\'s daily-only cron limit).');

h3('Auth');
p('GET /api/worker?key=<CRON_SECRET>. Constant-time string comparison via safeEqual(). 401 on mismatch.');

h3('Five-phase drain');
table(
  ['Phase', 'What it does'],
  [
    ['0. Expire flows',     'Single UPDATE on flows where validUntilAt < now AND isActive=true → isActive=false. Runs every tick.'],
    ['1. Drain inbound',    'Pops jobs from facebook-events queue in batches of 25. For each: upsert contact, log message_event, dispatch to flow engine.'],
    ['2. Wake delayed runs', 'Loads up to 50 flow_runs where waitUntil ≤ now AND status=active. Calls advanceRun() to step the state machine.'],
    ['3a. Comment replies',  'Pops from q:comment-replies. Calls Meta Graph API to post a sub-comment under the trigger comment. Rate-limited to 30/min/Page.'],
    ['3b. Outbound DMs',     'Pops from q:outbound-messages. Calls Meta Send API. Rate-limited to 200/min/Page. Detects the 24h window vs comment-to-DM (recipient: { comment_id }) automatically.'],
    ['4. Analytics',         'Reads from Redis Stream bus:events:meta in the analytics consumer group. HINCRBY counters keyed by integration_id and event type.'],
  ],
  [0.18, 0.82]
);

h3('Time budget');
p('MAX_TIME_MS = 55_000. Worker exits early if the deadline is hit, leaving remaining jobs for the next tick. Vercel Hobby max function duration is 60s.');

h3('Error handling');
bullets([
  'Each per-job try/catch increments stats.errors and calls markFailed(jobId, message)',
  'Rate-limited jobs are re-queued (LPUSH back to the same queue) and marked retrying',
  'Token-expired sends (Graph error code 190) flip ConnectedAccount.status to expired',
  'Worker always returns 200 with { ok: true, stats: { inbound, runs, outbound, replies, expired, analytics, errors } }',
]);

doc.addPage();

// ─── 10. FLOW ENGINE ───────────────────────────────────────────────────
h1('10. Flow Engine & Trigger Matching');
p('Source: lib/flow-engine.ts. Two dispatcher entry points (DM and comment), one step executor, and a handful of pure-logic primitives (keyword matching, template interpolation).');

h3('dispatchInboundMessage()');
p('Input: connectedAccountId, contact, messageText, channel. Searches for an active flow whose triggerType is keyword AND whose denormalized keywords[] array overlaps with the lowercased message text. Validity window enforced via SQL WHERE: validFromAt ≤ now AND (validUntilAt IS NULL OR validUntilAt > now). Creates a FlowRun pointing at the first step.');

h3('dispatchCommentEvent()');
p('Same shape as above but triggered from comment_added events. Creates a FlowRun whose context contains the original comment_id (used later by the outbound job to send the DM in comment-to-DM mode).');

h3('executeStep()');
p('Returns one of four outcomes:');
bullets([
  '{ kind: "next", nextStepId } — proceed to the linked next step',
  '{ kind: "wait_for_reply" } — pause until the user sends a reply (FlowRun.status = waiting_for_reply)',
  '{ kind: "delay", waitUntil } — pause until a future timestamp',
  '{ kind: "done" } — flow completed, mark run as completed',
]);

h3('Step types implemented');
bullets([
  'send_message — enqueues an outbound DM job. config.content carries text/attachments; respects 24h window automatically',
  'add_tag / remove_tag — mutates contact_tags',
  'set_field — writes a key into Contact.customFields (JSON)',
  'delay — schedules waitUntil',
  'wait_for_reply — pauses for the user\'s next message; the dispatcher resumes the run when a matching event arrives',
  'branch — evaluates conditions[] and chooses the matching next_step_id',
]);

h3('Keyword matching primitives');
table(
  ['Mode', 'Behavior'],
  [
    ['contains',   'Lowercased text includes the lowercased pattern (substring match)'],
    ['exact',      'Lowercased text strictly equals the pattern'],
    ['keyword_any','Word-boundary match (pattern surrounded by \\b on both sides)'],
  ],
  [0.22, 0.78]
);

h3('Template variables');
p('Outbound message text supports {{contact.first_name}} interpolation. Resolution: dotted path lookup against the Contact + custom_fields object. Missing variables resolve to empty string (no template-leak strings like "{{undefined}}" appear in user-facing output).');

doc.addPage();

// ─── 11. FRONTEND ──────────────────────────────────────────────────────
h1('11. Frontend (Website + Dashboard)');

h3('Pages');
table(
  ['File', 'Route', 'Purpose'],
  [
    ['index.html',                 '/',                       'Marketing landing page. Hero, features, pricing ($49/mo), social proof.'],
    ['dashboard.html',             '/dashboard',              'In-app SPA. Auth overlay + form-based flow creation + integrations list + activity feed.'],
    ['privacy.html',               '/privacy',                'Privacy policy (required by Meta App Review).'],
    ['terms.html',                 '/terms',                  'Terms of service.'],
    ['data-deletion-status.html',  '/data-deletion-status',   'User-facing deletion request lookup page. Fetches /api/webhooks/meta?deletion_status=…'],
  ],
  [0.32, 0.25, 0.43]
);

h3('FlowBot Assistant widget');
p('Self-contained chat widget at assistant.css + assistant.js. Loaded on every public-facing page (skipped on dashboard to avoid toast collision). 14-entry knowledge base covering product, T&C, pricing, deletion, support. Pure client-side keyword-scoring matcher with title-substring fallback. Floating button bottom-right, expandable 380×560px panel with typing indicator + suggestion chips.');

h3('Design system');
bullets([
  'Color tokens: --ink #0e0e0c, --accent #ff5a1f, --mag #d924e8, --bg #fafaf7, --hair #e4e2da',
  'Fonts: Inter (400/500/600/700), Instrument Serif (italic), JetBrains Mono — all preconnected',
  'Radius: --r 14px, --r-lg 22px',
  'Shadows: --shadow-sm 0 1px 2px / 0 4px 14px; --shadow-md 0 8px 28px -12px',
  'Easing: cubic-bezier(.2,.8,.2,1)',
]);

h3('Dashboard data flow');
code(
`Browser load
   ↓
fetch /api/auth/me
   ↓ (401? show overlay)
Promise.all:
   • fetch /api/integrations/_root  → page selector
   • fetch /api/flows/_root         → rule cards
   • fetch /api/events?take=10      → activity feed`
);

doc.addPage();

// ─── 12. SECURITY ──────────────────────────────────────────────────────
h1('12. Security Architecture');

h3('At rest');
bullets([
  'OAuth access tokens: AES-256-GCM envelope encryption. Each token uses a fresh random 12-byte IV and is stored as base64(IV ‖ AuthTag ‖ Ciphertext)',
  'Passwords: bcrypt with cost factor 12',
  'Database: Supabase\'s default at-rest encryption; pgbouncer connection pooled',
  'Redis: Upstash TLS in transit; data is ephemeral (queues + seen-set + counters)',
]);

h3('In transit');
bullets([
  'All API endpoints served over HTTPS via Vercel',
  'Cookies: HTTP-only, Secure, SameSite=Lax',
  'OAuth state token: 24 random bytes, single-use, 10-minute Redis TTL',
]);

h3('Webhook integrity');
bullets([
  'Meta: HMAC-SHA256 of raw body against META_WEBHOOK_SECRET, compared via crypto.timingSafeEqual',
  'TikTok: HMAC-SHA256 of raw body against TIKTOK_CLIENT_SECRET, same constant-time compare',
  'Body parser is disabled on signature-verifying routes so the byte-exact body is hashed (not a re-serialized JSON.stringify)',
  'Idempotency: every event_id is markSeen()ed in Redis with a 24h TTL — duplicate Meta deliveries are silently dropped',
  'Data deletion callback: signed_request HMAC verified the same way, plus algorithm field in payload must equal "HMAC-SHA256"',
]);

h3('Multi-tenancy enforcement');
bullets([
  'lib/tenancy.ts: resolveOwnedAccount(userId, accountId) returns null if the integration is owned by another user — every protected route uses this',
  'Per-tenant keyword uniqueness: findKeywordConflicts(connectedAccountId, keywords) prevents two active rules sharing a keyword on the same Page',
  'Cron endpoint: separate CRON_SECRET, never accepts session cookies — prevents an authenticated user from triggering the worker',
]);

h3('CSRF & XSS');
bullets([
  'OAuth state parameter prevents CSRF on the consent → callback handoff',
  'Dashboard input rendered through escapeHtml() in all dynamic HTML construction (rule cards, integration list, etc.)',
  'X-Content-Type-Options: nosniff and Referrer-Policy: strict-origin-when-cross-origin headers set on /api/* via vercel.json',
]);

doc.addPage();

// ─── 13. DEPLOYMENT ────────────────────────────────────────────────────
h1('13. Deployment & CI/CD');

h3('Build pipeline');
bullets([
  'GitHub repo: HaroonSadiq/Cht (main branch)',
  'Vercel auto-deploys on push to main',
  'Build command: npm run build → prisma generate (no bundle step; Vercel handles the function build)',
  'Output directory: . (root) — outputDirectory in vercel.json',
  'TypeScript transpilation handled by @vercel/node',
]);

h3('Vercel function configuration');
table(
  ['Function', 'maxDuration'],
  [
    ['api/health.ts',                              '5s'],
    ['api/webhooks/meta.ts',                       '10s'],
    ['api/webhooks/tiktok.ts',                     '10s'],
    ['api/worker.ts',                              '60s'],
    ['api/auth/[action].ts',                       '10s'],
    ['api/oauth/meta/[step].ts',                   '15s'],
    ['api/integrations/[...path].ts',              '30s'],
    ['api/flows/[...path].ts',                     '30s'],
    ['api/conversations/[contactId]/[action].ts',  '10s'],
    ['api/contacts.ts',                            '10s'],
    ['api/events.ts',                              '10s'],
    ['api/jobs/[id].ts',                           '10s'],
  ],
  [0.6, 0.4]
);

h3('Cron schedule');
bullets([
  'Vercel cron (Hobby plan, daily-only): 0 0 * * * → /api/worker?key=$CRON_SECRET',
  'GitHub Actions cron (every 5 min): .github/workflows/worker-cron.yml. This is the production cadence — Vercel\'s daily tick is the safety net.',
]);

h3('URL rewrites (vercel.json)');
table(
  ['Source', 'Destination'],
  [
    ['/',                          '/index.html'],
    ['/dashboard',                 '/dashboard.html'],
    ['/privacy',                   '/privacy.html'],
    ['/terms',                     '/terms.html'],
    ['/data-deletion-status',      '/data-deletion-status.html'],
    ['/api/data-deletion',         '/api/webhooks/meta'],
  ],
  [0.45, 0.55]
);

doc.addPage();

// ─── 14. END-TO-END WORKFLOW ───────────────────────────────────────────
h1('14. End-to-End Workflow');
p('A complete trace of one comment-to-DM round trip: from user gesture in Facebook to DM landing in their inbox.');

h3('Setup phase (one-time per Page)');
code(
`1. Page admin → /dashboard → Sign Up
   POST /api/auth/signup → User + Workspace created → JWT cookie set

2. Click "Connect Facebook Page"
   GET /api/oauth/meta/start
     ↓ Redis SET oauth:<state> = userId (TTL 600s)
   302 → Facebook OAuth dialog (config_id = 2728012970932296)

3. User grants permissions
   GET /api/oauth/meta/callback?code=…&state=…
     ↓ Redis GET+DEL oauth:<state>
     ↓ POST /v20.0/oauth/access_token (code → short-lived token)
     ↓ POST /v20.0/oauth/access_token (short → long-lived ~60d)
     ↓ GET /v20.0/me?fields=id (capture installer_user_id)
     ↓ GET /v20.0/me/accounts (enumerate Pages)
     ↓ For each Page: encrypt token (AES-256-GCM), upsert ConnectedAccount,
       POST /v20.0/<pageId>/subscribed_apps (register webhooks)
   302 → /dashboard?connected=meta

4. Create rule
   POST /api/flows/comment-to-dm
     ↓ findKeywordConflicts() — reject if duplicate keyword on same Page
     ↓ db.$transaction: insert Flow + first FlowStep (send_message)
     ↓ Default validUntilAt = now + 3 days`
);

h3('Runtime phase (every comment)');
code(
`1. Customer comments "PRICE" on a Page post

2. Meta POSTs to /api/webhooks/meta with x-hub-signature-256 header
     ↓ verifyMetaSignature(rawBody, header) — constant-time HMAC compare
     ↓ normalizeMetaPayload → NormalizedEvent[]
     ↓ For each event:
         markSeen(event_id)            ← idempotency
         findFirst ConnectedAccount    ← tenant lookup
         createAndEnqueueJob → row in jobs + LPUSH facebook-events
         emitEvent → Redis Stream bus:events:meta
   200 OK to Meta in <2s

3. Worker tick (5-min GitHub Actions cron)
   GET /api/worker?key=<CRON_SECRET>
     ↓ Phase 0: expire stale flows
     ↓ Phase 1: pop facebook-events jobs, processInboundJob(id):
         upsert Contact (lastSeenAt; no lastInboundAt for comments)
         upsert MessageEvent (idempotent on platform_message_id)
         dispatchCommentEvent → finds Flow with matching keyword in
           validity window → creates FlowRun pointing at first step
         advanceRun → executeStep("send_message"):
           enqueue outbound DM job with recipientCommentId set
         enqueue comment-reply job with the configured public reply text
     ↓ Phase 3a: pop comment-replies, POST /v20.0/<commentId>/comments
     ↓ Phase 3b: pop outbound-messages:
         contact has no lastInboundAt → use comment-to-DM mode
         POST /v20.0/me/messages with recipient: { comment_id }
     ↓ Phase 4: analytics consumer reads Redis Stream, HINCRBY counters

4. Customer sees public reply ("Just sent you a DM 👀") + DM in inbox
   Total wall-clock: ~10 seconds from comment submission`
);

doc.addPage();

// ─── 15. OPS & SMOKE TESTS ─────────────────────────────────────────────
h1('15. Operations & Smoke Tests');

h3('Test suites');
table(
  ['Script', 'Coverage', 'When to run'],
  [
    ['scripts/smoke-offline.mjs',  '42 pure-logic tests: HMAC, AES-GCM, signed_request parsing, Meta payload normalization, keyword matching, template interp, ID generators, env-var presence',  'Before every commit'],
    ['scripts/smoke.sh',           '~28 live HTTP tests against a live deployment: health, static assets, both webhooks (handshake + signed POST + bad-sig + idempotency), worker auth, deletion callback, status page, auth-gated endpoints',  'After every deploy'],
  ],
  [0.32, 0.5, 0.18]
);

h3('Health check');
p('GET /api/health returns 200 with per-component checks { db: { ok, ms }, redis: { ok, ms } }, or 503 if either is degraded.');

h3('Manually triggering the worker');
code(
`curl https://chtmodel.vercel.app/api/worker?key=$CRON_SECRET`
);

h3('Inspecting jobs');
bullets([
  'GET /api/jobs/<jobId> returns the job row from Postgres including status, attempts, error, result',
  'jobs.payload is the Redis-side payload; jobs.result is the Meta API response on success',
  'Failed jobs stay in the table — query db.job.findMany({ where: { status: "failed" }}) for triage',
]);

h3('Common failure modes');
table(
  ['Symptom', 'Likely cause', 'Fix'],
  [
    ['inbound: 0 in worker stats',         'Webhook subscription off OR signature failing',  'Check Page subscription in Meta Dashboard; verify META_WEBHOOK_SECRET matches App Secret'],
    ['outbound errors: code 190',          'Long-lived Page token expired',                   'Status flips to "expired"; user must re-OAuth'],
    ['outbound errors: code 10',           'Outside 24h window AND no comment_id available', 'Expected when DMing a contact whose only interaction was old; flow won\'t fire'],
    ['runs: 0 with inbound > 0',           'No flow matches the keyword on the tagged Page',  'Verify rule active, validity window not expired, page_id matches'],
    ['504 on /api/flows/:id?_action=test', 'Cold start + cross-region DB latency',           'maxDuration bumped to 30s; consider migrating Vercel functions to Singapore region'],
  ],
  [0.32, 0.32, 0.36]
);

doc.addPage();

// ─── 16. APP REVIEW ────────────────────────────────────────────────────
h1('16. Meta App Review');
p('Submission packet at app-review/. Four documents: submission-checklist.md, permission-justifications.md, screencast-script.md, test-credentials.md.');

h3('Permissions requested (all Advanced Access)');
table(
  ['Permission', 'Used for'],
  [
    ['pages_show_list',         'List the Pages a user manages so they can pick one'],
    ['pages_manage_metadata',   'Subscribe the Page to webhook events'],
    ['pages_read_engagement',   'Receive comment events from feed webhook'],
    ['pages_read_user_content', 'Read comment text to match against trigger keywords'],
    ['pages_manage_engagement', 'Post the public reply under the comment'],
    ['pages_messaging',         'Send the private DM (24h window or comment-to-DM mode)'],
    ['business_management',     'Required by Facebook Login for Business config'],
  ],
  [0.32, 0.68]
);

h3('Submission gate');
bullets([
  'Business Verification (1–3 business days) — requires a document with Muhammad Haroon Sadiq\'s name',
  'App Settings filled out: privacy URL, terms URL, app icon, contact email, data deletion callback',
  'Data Use Checkup completed in App Dashboard',
  'Two real Facebook accounts ready (page admin + commenter) — Test Users do NOT pass review',
  '90–120s screencast showing OAuth → rule creation → real comment → public reply → DM in inbox',
]);

h3('App Review URLs (paste into App Settings)');
table(
  ['Field', 'Value'],
  [
    ['Privacy Policy URL',                  'https://chtmodel.vercel.app/privacy'],
    ['Terms of Service URL',                'https://chtmodel.vercel.app/terms'],
    ['Data Deletion Request Callback URL',  'https://chtmodel.vercel.app/api/data-deletion'],
    ['Data Deletion Instructions URL',      'https://chtmodel.vercel.app/data-deletion-status'],
    ['App Domains',                         'chtmodel.vercel.app'],
    ['Site URL',                            'https://chtmodel.vercel.app'],
  ],
  [0.42, 0.58]
);

callout('Pre-publish behavior',
  'Until the Meta App is published (Live mode), production webhook events are NOT delivered for any user — including app admins and testers. Only the dashboard Test Webhook button or the synthetic /api/flows/:id?_action=test trigger will exercise the flow logic. This is documented Meta behavior, not a FlowBot bug.', 'warn');

doc.addPage();

// ─── 17. KNOWN LIMITATIONS ─────────────────────────────────────────────
h1('17. Known Limitations & Roadmap');

h3('Current limitations');
bullets([
  'Vercel Hobby 12-function cap — adding new endpoints requires consolidating into existing catch-alls',
  'Vercel Hobby cron — only daily granularity; production cadence is provided by GitHub Actions cron',
  'No automated long-lived token refresh; relies on user re-OAuth when token expires (~60d)',
  'TikTok flow engine paths are partial — webhook ingest works but flow matching for TikTok-specific events is not yet wired',
  'Cross-region latency: Vercel functions in US, Postgres + Redis in Singapore — cold-start spikes can hit 504. Mitigation: bumped catch-all maxDuration to 30s; long-term fix is region migration to Singapore',
  'No multi-step flow editor in the UI — flows currently created via the comment-to-DM form only; manual flow_step rows can express delays/branches but no visual editor exists',
  'No team-member roles within a workspace — owner-only access today',
  'No billing integration — pricing page advertises $49/mo but no Stripe/payment flow is wired',
]);

h3('Near-term roadmap');
bullets([
  'Meta App Review submission (Business Verification → screencast → submit)',
  'Stripe billing integration with $49/mo Pro plan + free trial',
  'Visual flow editor (DAG canvas) replacing the single-rule form',
  'Token refresh automation: nightly check of token validity, prompt user via dashboard banner before expiry',
  'TikTok end-to-end: TikTok Login OAuth, comment-event flow engine, TikTok Send Message API integration',
  'AI assistant upgrade: optional LLM-backed answers (Claude API) for off-KB questions',
  'Region migration: move Vercel functions to Singapore (sin1) to match DB region',
]);

h3('Architectural inflection points to watch');
bullets([
  'When ConnectedAccount count exceeds ~100K, the keyword-array GIN index will need partitioning',
  'When event throughput exceeds ~5K/min, queue concurrency must move from 1 worker to a worker pool (currently single-cron)',
  'When user count exceeds Hobby plan limits or function count needs to grow, migrate to Vercel Pro (or refactor into a single Express server on a long-running compute provider)',
]);

doc.addPage();

// ─── APPENDIX ──────────────────────────────────────────────────────────
h1('Appendix · File Map');
p('Quick reference of where each piece of the system lives in the repo.');

table(
  ['Path', 'Purpose'],
  [
    ['api/health.ts',                              'Liveness check'],
    ['api/webhooks/meta.ts',                       'Meta webhook ingest + data deletion callback + status lookup'],
    ['api/webhooks/tiktok.ts',                     'TikTok webhook ingest'],
    ['api/worker.ts',                              'Cron-triggered queue drainer'],
    ['api/auth/[action].ts',                       'signup / signin / signout / me'],
    ['api/oauth/meta/[step].ts',                   'OAuth start + callback for Facebook Login for Business'],
    ['api/integrations/[...path].ts',              'List, detail, pause/resume, disconnect, posts, metrics, resubscribe'],
    ['api/flows/[...path].ts',                     'List, comment-to-dm, get/patch/delete, test, extend'],
    ['api/conversations/[contactId]/[action].ts',  'Conversation history + manual send'],
    ['api/contacts.ts',                            'Contact list'],
    ['api/events.ts',                              'Recent activity feed'],
    ['api/jobs/[id].ts',                           'Single job lookup'],
    ['lib/auth.ts',                                'JWT issue + verify, cookie helpers, requireUser'],
    ['lib/crypto.ts',                              'HMAC verify, AES-GCM encrypt/decrypt, signed_request parser, safeEqual'],
    ['lib/db.ts',                                  'Prisma client singleton'],
    ['lib/event-bus.ts',                           'Redis Streams wrapper (xadd/xreadgroup/xack)'],
    ['lib/events.ts',                              'Type definitions + Meta payload normalizer + ID generators'],
    ['lib/flow-engine.ts',                         'Dispatcher + step executor + matcher primitives'],
    ['lib/jobs.ts',                                'Job persistence + queue helpers (createAndEnqueueJob, popJobIds, mark*)'],
    ['lib/meta.ts',                                'Meta Graph API client (sendMessage, replyToComment, isWithin24hWindow)'],
    ['lib/redis.ts',                               'Upstash client + queue/seen/rate-limit helpers'],
    ['lib/tenancy.ts',                             'resolveOwnedAccount, normalizeKeywords, findKeywordConflicts'],
    ['prisma/schema.prisma',                       '10-table data model'],
    ['vercel.json',                                'Function config, cron, rewrites, headers'],
    ['scripts/smoke.sh',                           'Live HTTP smoke test'],
    ['scripts/smoke-offline.mjs',                  'Offline pure-logic smoke test (42 cases)'],
    ['scripts/gen-doc.mjs',                        'This documentation generator'],
    ['index.html',                                 'Marketing landing page'],
    ['dashboard.html',                             'In-app dashboard SPA'],
    ['privacy.html / terms.html',                  'Legal pages'],
    ['data-deletion-status.html',                  'User-facing deletion request lookup'],
    ['assistant.css / assistant.js',               'FlowBot Assistant chat widget'],
    ['app-review/',                                'Meta App Review submission packet'],
    ['.github/workflows/worker-cron.yml',          'GitHub Actions cron (every 5 min)'],
  ],
  [0.42, 0.58]
);

// ─── END ───────────────────────────────────────────────────────────────
doc.end();
console.log(`Generated ${out}`);
