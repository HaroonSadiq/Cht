// POST /api/flows/[id]/test — fire a synthetic comment event through the
// real dispatcher to confirm the flow matches and queues a DM. Tenant-scoped.
//
// Body: { commentText?: string, commenterId?: string, commenterName?: string }
// commentText defaults to the first keyword on the flow.
//
// Result: returns the matched flow id (should be the one being tested) and
// the queued job ids so you can poll /api/jobs/[id] to verify execution.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../../lib/db';
import { requireUser } from '../../../lib/auth';
import { dispatchCommentEvent } from '../../../lib/flow-engine';
import { newEventId } from '../../../lib/events';

const Body = z.object({
  commentText:   z.string().min(1).max(500).optional(),
  commenterId:   z.string().min(1).max(120).optional(),
  commenterName: z.string().max(120).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const userId = await requireUser(req, res);
  if (!userId) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const parsed = Body.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const flow = await db.flow.findFirst({
    where: { id, connectedAccount: { workspace: { ownerId: userId } } },
    include: { connectedAccount: true },
  });
  if (!flow) return res.status(404).json({ error: 'Flow not found' });
  if (flow.triggerType !== 'comment') {
    return res.status(400).json({ error: 'Only comment triggers can be tested with this endpoint' });
  }

  const commentText = parsed.data.commentText ?? (flow.keywords[0] ?? 'test');
  const commenterId = parsed.data.commenterId ?? `test_user_${Date.now()}`;

  // Synthetic contact (will be upserted; flagged via custom_fields.synthetic)
  const contact = await db.contact.upsert({
    where: {
      connectedAccountId_platformContactId: {
        connectedAccountId: flow.connectedAccountId,
        platformContactId:  commenterId,
      },
    },
    update: { lastSeenAt: new Date() },
    create: {
      connectedAccountId: flow.connectedAccountId,
      platformContactId:  commenterId,
      displayName:        parsed.data.commenterName ?? 'Test Commenter',
      customFields:       { synthetic: true } as any,
    },
  });

  const fakeCommentId = `synthetic_cmt_${newEventId()}`;
  const run = await dispatchCommentEvent({
    connectedAccountId: flow.connectedAccountId,
    contact,
    commentId:   fakeCommentId,
    postId:      'synthetic_post',
    commentText,
  });

  return res.status(200).json({
    matched: !!run,
    matched_flow_id:  run?.flowId ?? null,
    expected_flow_id: flow.id,
    contact_id:       contact.id,
    test_comment:     { comment_id: fakeCommentId, text: commentText },
    note: run
      ? `Triggered. Public reply + DM jobs were queued. Worker will process within ~1 min. Note: actual Meta calls will fail because comment_id "${fakeCommentId}" is synthetic.`
      : 'No flow matched. Check that the test text contains a configured keyword and the flow is active and within its validity window.',
  });
}
