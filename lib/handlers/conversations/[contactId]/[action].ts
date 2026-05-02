// Combined conversation handler:
//   GET  /api/conversations/:contactId/messages — recent message log
//   POST /api/conversations/:contactId/send     — manual DM (human takeover)

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { createAndEnqueueJob } from '@/lib/jobs';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const contactId = Array.isArray(req.query.contactId) ? req.query.contactId[0] : req.query.contactId;
  const action    = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  if (!contactId || !action) return res.status(400).json({ error: 'Missing contactId or action' });

  if (action === 'messages') return messages(userId, contactId, req, res);
  if (action === 'send')     return send(userId, contactId, req, res);
  return res.status(404).json({ error: `Unknown action: ${action}` });
}

async function messages(userId: string, contactId: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const contact = await db.contact.findFirst({
    where: { id: contactId, connectedAccount: { workspace: { ownerId: userId } } },
    include: { connectedAccount: { select: { platform: true, displayName: true, integrationId: true } } },
  });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const take = Math.min(parseInt(String(req.query.take ?? '50'), 10) || 50, 200);
  const list = await db.messageEvent.findMany({
    where: { contactId },
    orderBy: { receivedAt: 'desc' },
    take,
    select: {
      id: true, channel: true, direction: true, messageText: true, attachments: true,
      platformMessageId: true, receivedAt: true,
    },
  });

  return res.status(200).json({
    contact: {
      id: contact.id,
      display_name: contact.displayName,
      platform_contact_id: contact.platformContactId,
      last_inbound_at: contact.lastInboundAt?.toISOString() ?? null,
      can_dm: !!contact.lastInboundAt && (Date.now() - contact.lastInboundAt.getTime()) <= 24 * 3600_000,
    },
    integration: contact.connectedAccount,
    messages: list.map((m) => ({ ...m, received_at: m.receivedAt.toISOString() })),
  });
}

const SendBody = z.object({ text: z.string().min(1).max(2000) });

async function send(userId: string, contactId: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const parsed = SendBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const contact = await db.contact.findFirst({
    where: { id: contactId, connectedAccount: { workspace: { ownerId: userId } } },
  });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const { jobId, queueName } = await createAndEnqueueJob({
    type: 'outbound_message',
    connectedAccountId: contact.connectedAccountId,
    payload: {
      contactId: contact.id,
      connectedAccountId: contact.connectedAccountId,
      content: { text: parsed.data.text },
    },
  });

  return res.status(202).json({ job_id: jobId, queue_name: queueName, status: 'queued', poll: `/api/jobs/${jobId}` });
}
