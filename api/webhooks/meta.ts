// Meta webhook ingress.
// Verifies signature → normalizes payload to the canonical event envelope →
// persists a Job per event → enqueues by job_id → ACKs in <2s.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyMetaSignature } from '../../lib/crypto';
import { redis } from '../../lib/redis';
import { markSeen } from '../../lib/redis';
import { db } from '../../lib/db';
import { normalizeMetaPayload, type Platform } from '../../lib/events';
import { createAndEnqueueJob } from '../../lib/jobs';
import { emitEvent } from '../../lib/event-bus';

export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ─── GET verification handshake ───────────────────────────
  if (req.method === 'GET') {
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

  // ─── POST event ingest ────────────────────────────────────
  const raw = await readRawBody(req);
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
    // Idempotency: skip duplicate Meta deliveries.
    const fresh = await markSeen(event.event_id);
    if (!fresh) continue;

    // Resolve the integration by page_id so we attach the job to a tenant.
    const account = await db.connectedAccount.findFirst({
      where: { platformAccountId: event.recipient.page_id },
    });

    const { jobId, queueName } = await createAndEnqueueJob({
      type: 'inbound_event',
      connectedAccountId: account?.id,
      payload: { event, integration_id: account?.integrationId ?? null },
    });

    // Fan-out to the event bus in parallel — analytics, audit, plugins
    // can subscribe without touching the dispatcher path.
    await emitEvent('bus:events:meta', {
      event,
      job_id: jobId,
      integration_id: account?.integrationId ?? null,
      workspace_id: null, // resolved by analytics consumer if needed
    }).catch((e) => console.error('[webhook] bus emit failed', e));

    jobs.push({ event_id: event.event_id, job_id: jobId, queue_name: queueName });
  }

  // Always 200 quickly. Worker handles the rest.
  return res.status(200).json({ accepted: events.length, jobs });
}
