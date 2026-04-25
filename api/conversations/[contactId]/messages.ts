// GET /api/conversations/[contactId]/messages — recent message log for a contact.
// Used by the inbox view.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const contactId = Array.isArray(req.query.contactId) ? req.query.contactId[0] : req.query.contactId;
  if (!contactId) return res.status(400).json({ error: 'Missing contactId' });

  // Tenant guard
  const contact = await db.contact.findFirst({
    where: { id: contactId, connectedAccount: { workspace: { ownerId: userId } } },
    include: { connectedAccount: { select: { platform: true, displayName: true, integrationId: true } } },
  });
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const take = Math.min(parseInt(String(req.query.take ?? '50'), 10) || 50, 200);
  const messages = await db.messageEvent.findMany({
    where: { contactId },
    orderBy: { receivedAt: 'desc' },
    take,
    select: {
      id: true, channel: true, direction: true,
      messageText: true, attachments: true,
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
    messages: messages.map((m) => ({
      ...m,
      received_at: m.receivedAt.toISOString(),
    })),
  });
}
