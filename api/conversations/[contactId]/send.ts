// POST /api/conversations/[contactId]/send — manual DM send for human takeover.
// Goes through the same outbound queue + 24h-window guard the engine uses.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/auth';
import { createAndEnqueueJob } from '../../../lib/jobs';

const Body = z.object({
  text: z.string().min(1).max(2000),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const contactId = Array.isArray(req.query.contactId) ? req.query.contactId[0] : req.query.contactId;
  if (!contactId) return res.status(400).json({ error: 'Missing contactId' });

  const parsed = Body.safeParse(req.body);
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

  return res.status(202).json({
    job_id: jobId, queue_name: queueName, status: 'queued',
    poll: `/api/jobs/${jobId}`,
  });
}
