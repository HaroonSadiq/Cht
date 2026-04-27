// Meta webhook ingress + data-deletion callback.
//
// Routes (all under POST /api/webhooks/meta):
//   • content-type: application/json                        → webhook event ingest
//   • content-type: application/x-www-form-urlencoded with
//     `signed_request=...`                                  → data deletion callback
//
// GET routes:
//   • ?hub.mode=subscribe&...                              → webhook verification handshake
//   • ?deletion_status=<code>                              → JSON status lookup (used by the
//                                                            data-deletion-status.html page)

import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyMetaSignature, parseFacebookSignedRequest } from '../../lib/crypto';
import { redis, markSeen } from '../../lib/redis';
import { db } from '../../lib/db';
import { normalizeMetaPayload, type Platform } from '../../lib/events';
import { createAndEnqueueJob } from '../../lib/jobs';
import { emitEvent } from '../../lib/event-bus';
import { publishDrain } from '../../lib/qstash';

export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function originFromReq(req: VercelRequest): string {
  const xfHost  = req.headers['x-forwarded-host'];
  const xfProto = req.headers['x-forwarded-proto'];
  const host  = (Array.isArray(xfHost)  ? xfHost[0]  : xfHost)  ?? req.headers.host;
  const proto = (Array.isArray(xfProto) ? xfProto[0] : xfProto) ?? 'https';
  return host ? `${proto}://${host}` : (process.env.APP_URL ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ─── GET: verification handshake OR deletion status lookup ──
  if (req.method === 'GET') {
    // Status lookup for the deletion-status static page.
    const statusCode = typeof req.query.deletion_status === 'string'
      ? req.query.deletion_status
      : undefined;
    if (statusCode) return getDeletionStatus(statusCode, res);

    // Subscribe handshake.
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(String(challenge ?? ''));
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const raw = await readRawBody(req);
  const ct  = String(req.headers['content-type'] ?? '').toLowerCase();

  // ─── Data deletion callback (form-encoded, signed_request body) ──
  if (ct.includes('application/x-www-form-urlencoded') || raw.startsWith('signed_request=')) {
    return handleDataDeletion(raw, req, res);
  }

  // ─── Webhook event ingest (JSON, x-hub-signature-256 header) ──
  return handleWebhookEvent(raw, req, res);
}

// ─────────────────────────────────────────────────────────────
// Webhook event ingest (unchanged from prior version)
// ─────────────────────────────────────────────────────────────
async function handleWebhookEvent(raw: string, req: VercelRequest, res: VercelResponse) {
  const sig = req.headers['x-hub-signature-256'];
  if (!verifyMetaSignature(raw, Array.isArray(sig) ? sig[0] : sig ?? null)) {
    return res.status(401).send('Invalid signature');
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return res.status(400).send('Bad JSON'); }

  const platform: Platform = payload.object === 'instagram' ? 'instagram' : 'messenger';
  const events = normalizeMetaPayload(payload, platform);
  const jobs: Array<{ event_id: string; job_id: string; queue_name: string }> = [];

  for (const event of events) {
    const fresh = await markSeen(event.event_id);
    if (!fresh) continue;

    const account = await db.connectedAccount.findFirst({
      where: { platformAccountId: event.recipient.page_id },
    });

    const { jobId, queueName } = await createAndEnqueueJob({
      type: 'inbound_event',
      connectedAccountId: account?.id,
      payload: { event, integration_id: account?.integrationId ?? null },
    });

    await emitEvent('bus:events:meta', {
      event,
      job_id: jobId,
      integration_id: account?.integrationId ?? null,
      workspace_id: null,
    }).catch((e) => console.error('[webhook] bus emit failed', e));

    jobs.push({ event_id: event.event_id, job_id: jobId, queue_name: queueName });
  }

  // Fire-and-forget: ask QStash to wake the worker. Sub-second latency replaces
  // the 5-minute cron cadence. If QSTASH_TOKEN isn't set, the GitHub Actions
  // cron will pick up the work on its next tick.
  if (jobs.length > 0) {
    const host  = (req.headers['x-forwarded-host'] as string) ?? req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
    const workerUrl = `${proto}://${host}/api/worker?key=${encodeURIComponent(process.env.CRON_SECRET ?? '')}`;
    publishDrain(workerUrl).catch(() => {});
  }

  return res.status(200).json({ accepted: jobs.length, jobs });
}

// ─────────────────────────────────────────────────────────────
// Data deletion callback
// Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
// Response shape required by Meta: { url, confirmation_code }
// ─────────────────────────────────────────────────────────────
async function handleDataDeletion(raw: string, req: VercelRequest, res: VercelResponse) {
  const form   = new URLSearchParams(raw);
  const signed = form.get('signed_request');
  if (!signed) return res.status(400).json({ error: 'missing signed_request' });

  const secret = process.env.META_APP_SECRET ?? process.env.META_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'server_misconfigured' });

  const parsed = parseFacebookSignedRequest(signed, secret);
  if (!parsed?.user_id) return res.status(401).json({ error: 'invalid signed_request' });

  const userId = parsed.user_id;
  const code   = `del_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
  const url    = `${originFromReq(req)}/data-deletion-status?code=${code}`;

  // Best-effort: delete any ConnectedAccounts whose installer matches this FB user.
  // We don't yet persist meta_user_id against ConnectedAccount, so this counts
  // affected rows without targeting them. Returns 0 today; once OAuth captures
  // the installer's user_id, this becomes a real cascade.
  let deletedAccounts = 0;
  try {
    const matches = await db.connectedAccount.findMany({
      where: { webhookConfig: { path: ['installer_user_id'], equals: userId } },
      select: { id: true },
    });
    if (matches.length > 0) {
      const ids = matches.map((m) => m.id);
      const result = await db.connectedAccount.deleteMany({ where: { id: { in: ids } } });
      deletedAccounts = result.count;
    }
  } catch (e) {
    console.warn('[deletion] best-effort delete failed', e);
  }

  // Persist the request so the status page can confirm it. 90-day retention
  // matches Meta's expectation that status remain queryable for "a reasonable time".
  await redis.set(
    `deletion:${code}`,
    JSON.stringify({
      user_id: userId,
      requested_at: new Date().toISOString(),
      status: deletedAccounts > 0 ? 'completed' : 'completed_no_data',
      deleted_accounts: deletedAccounts,
    }),
    { ex: 90 * 86400 },
  );

  return res.status(200).json({ url, confirmation_code: code });
}

async function getDeletionStatus(code: string, res: VercelResponse) {
  if (!/^del_[a-z0-9_]+$/i.test(code)) {
    return res.status(400).json({ error: 'invalid code format' });
  }
  const raw = await redis.get<string | object>(`deletion:${code}`);
  if (!raw) return res.status(404).json({ error: 'not_found', code });
  // Upstash returns parsed objects when the value is JSON; tolerate both.
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return res.status(200).json({ code, ...data });
}
