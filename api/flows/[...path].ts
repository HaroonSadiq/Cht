// Catch-all flows router. Routes:
//   GET    /api/flows                              — list (filter by ?connectedAccountId=)
//   POST   /api/flows                              — create generic flow
//   POST   /api/flows/comment-to-dm                — convenience: comment-to-DM rule
//   GET    /api/flows/:id                          — get one flow + steps
//   PATCH  /api/flows/:id                          — update flow + replace steps
//   DELETE /api/flows/:id                          — delete
//   POST   /api/flows/:id/extend                   — extend validUntilAt
//   POST   /api/flows/:id/test                     — synthetic comment trigger

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { resolveOwnedAccount, normalizeKeywords, findKeywordConflicts } from '../../lib/tenancy';
import { dispatchCommentEvent } from '../../lib/flow-engine';
import { newEventId } from '../../lib/events';

// Strip the API base prefix and split the remaining path into segments.
// Decodes URL-encoded chars. Returns [] if no remaining segments.
function parsePath(reqUrl: string, prefix: string): string[] {
  const u = new URL(reqUrl, 'http://x');
  let p = u.pathname;
  if (p.startsWith(prefix)) p = p.slice(prefix.length);
  return p.split('/').filter(Boolean).map(decodeURIComponent);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  // Parse path from req.url — req.query.path is unreliable on Vercel Functions
  // catch-all routes (sometimes empty even when sub-paths are present).
  const path = parsePath(req.url ?? '', '/api/flows');
  if (path.length === 1 && path[0] === '_root') path.length = 0;

  if (path.length === 0) {
    if (req.method === 'GET')  return list(userId, req, res);
    if (req.method === 'POST') return create(userId, req, res);
    return res.status(405).end();
  }

  const head = path[0];

  // /api/flows/comment-to-dm — special-cased before treating head as an id
  if (head === 'comment-to-dm') {
    if (req.method !== 'POST') return res.status(405).end();
    return commentToDm(userId, req, res);
  }

  const id  = head;
  const sub = path[1];

  if (!sub) return crud(userId, id, req, res);

  switch (sub) {
    case 'extend': return extend(userId, id, req, res);
    case 'test':   return test(userId, id, req, res);
    default:       return res.status(404).json({ error: `Unknown sub-path: ${sub}` });
  }
}

// ─── list / create ─────────────────────────────────────────
async function list(userId: string, req: VercelRequest, res: VercelResponse) {
  const cid = typeof req.query.connectedAccountId === 'string' ? req.query.connectedAccountId : undefined;
  const flows = await db.flow.findMany({
    where: {
      connectedAccount: { workspace: { ownerId: userId } },
      ...(cid && { connectedAccountId: cid }),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, name: true, isActive: true, priority: true,
      triggerType: true, triggerConfig: true, keywords: true,
      connectedAccountId: true, validFromAt: true, validUntilAt: true,
      createdAt: true, updatedAt: true,
      // Include the first send_message step so the dashboard can show the DM text.
      steps: {
        select: { id: true, stepType: true, config: true },
        orderBy: { id: 'asc' },
        take: 1,
      },
      connectedAccount: { select: { displayName: true, platform: true } },
      _count: { select: { steps: true, runs: true } },
    },
  });
  return res.status(200).json(flows);
}

const CreateBody = z.object({
  connectedAccountId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  triggerType: z.enum(['keyword','comment','story_reply','story_mention','new_follow','ref_url','manual','scheduled','ai_intent']),
  triggerConfig: z.record(z.unknown()).default({}),
  priority: z.number().int().min(0).max(1000).default(100),
});

async function create(userId: string, req: VercelRequest, res: VercelResponse) {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const account = await resolveOwnedAccount({ userId, connectedAccountId: parsed.data.connectedAccountId });
  if (!account) return res.status(404).json({ error: 'Integration not found for this client' });

  const patterns = (parsed.data.triggerConfig as any)?.patterns;
  const keywords = normalizeKeywords(patterns);
  const needsCheck = ['keyword','comment'].includes(parsed.data.triggerType);
  if (needsCheck && keywords.length) {
    const conflicts = await findKeywordConflicts({ connectedAccountId: account.id, keywords });
    if (conflicts.length) {
      return res.status(409).json({
        error: 'keyword_already_in_use',
        message: `Your page "${account.displayName}" already has an active flow using one of these keywords.`,
        conflicts,
      });
    }
  }

  const flow = await db.flow.create({
    data: {
      connectedAccountId: account.id,
      name: parsed.data.name,
      description: parsed.data.description,
      triggerType: parsed.data.triggerType,
      triggerConfig: parsed.data.triggerConfig as any,
      keywords,
      priority: parsed.data.priority,
      isActive: false,
    },
  });
  return res.status(201).json({
    ...flow,
    scope: {
      workspace_id:   account.workspaceId,
      integration_id: account.id,
      page_id:        account.platformAccountId,
      page_name:      account.displayName,
    },
  });
}

// ─── /api/flows/comment-to-dm ──────────────────────────────
const C2DBody = z.object({
  connectedAccountId: z.string().uuid(),
  keyword:     z.string().min(1).max(80),
  dmText:      z.string().min(1).max(2000),
  publicReply: z.string().max(1000).optional(),
  postIds:     z.array(z.string()).optional(),
  name:        z.string().min(1).max(120).optional(),
  matchType:   z.enum(['exact', 'contains', 'keyword_any']).default('contains'),
  activate:    z.boolean().default(true),
  validityDays: z.union([z.number().int().min(1).max(365), z.null()]).default(3),
});

async function commentToDm(userId: string, req: VercelRequest, res: VercelResponse) {
  const parsed = C2DBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
  const data = parsed.data;

  const account = await resolveOwnedAccount({ userId, connectedAccountId: data.connectedAccountId });
  if (!account) return res.status(404).json({ error: 'Integration not found for this client' });
  if (account.platform !== 'facebook' && account.platform !== 'instagram') {
    return res.status(400).json({ error: 'Comment-to-DM is supported on Facebook and Instagram only' });
  }

  const keywords = normalizeKeywords([data.keyword]);
  if (data.activate) {
    const conflicts = await findKeywordConflicts({ connectedAccountId: account.id, keywords });
    if (conflicts.length) {
      return res.status(409).json({
        error: 'keyword_already_in_use',
        message: `Your page "${account.displayName}" already has an active flow using this keyword.`,
        conflicts,
      });
    }
  }

  const flowName = data.name ?? `Comment-to-DM · "${data.keyword}"`;
  const validUntilAt = data.validityDays === null
    ? null
    : new Date(Date.now() + data.validityDays * 86_400_000);

  const flow = await db.$transaction(async (tx) => {
    const f = await tx.flow.create({
      data: {
        connectedAccountId: account.id,
        name: flowName,
        triggerType: 'comment',
        triggerConfig: {
          patterns:    [data.keyword],
          match_type:  data.matchType,
          channel:     'comment',
          post_ids:    data.postIds && data.postIds.length ? data.postIds : 'all',
          public_reply: data.publicReply ?? null,
        } as any,
        keywords,
        isActive: data.activate,
        priority: 100,
        validUntilAt,
      },
    });
    await tx.flowStep.create({
      data: {
        flowId: f.id,
        stepType: 'send_message',
        config: { content: { text: data.dmText } } as any,
        position: { x: 0, y: 0 } as any,
        nextStepId: null,
      },
    });
    return f;
  });

  return res.status(201).json({
    id: flow.id,
    name: flow.name,
    isActive: flow.isActive,
    keywords: flow.keywords,
    scope: {
      workspace_id:   account.workspaceId,
      integration_id: account.id,
      platform:       account.platform,
      page_id:        account.platformAccountId,
      page_name:      account.displayName,
    },
    triggerConfig: flow.triggerConfig,
    validity: {
      valid_from_at:  flow.validFromAt.toISOString(),
      valid_until_at: flow.validUntilAt?.toISOString() ?? null,
      valid_for_days: data.validityDays,
      expires_in_seconds: flow.validUntilAt
        ? Math.max(0, Math.floor((flow.validUntilAt.getTime() - Date.now()) / 1000))
        : null,
    },
    note: data.activate
      ? `Live on "${account.displayName}" for ${data.validityDays ?? 'unlimited'} days. When YOUR audience comments "${data.keyword}", they get YOUR DM.`
      : 'Created in draft. Toggle isActive=true to start receiving triggers.',
  });
}

// ─── /api/flows/:id ────────────────────────────────────────
const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  steps: z.array(z.object({
    id: z.string().uuid().optional(),
    stepType: z.enum(['send_message','wait_for_reply','delay','branch','add_tag','remove_tag','set_field','http_request','handoff_to_human','ai_agent']),
    config: z.record(z.unknown()),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    nextStepId: z.string().uuid().nullable().optional(),
    branches: z.array(z.unknown()).nullable().optional(),
  })).optional(),
});

async function crud(userId: string, id: string, req: VercelRequest, res: VercelResponse) {
  const flow = await db.flow.findFirst({
    where: { id, connectedAccount: { workspace: { ownerId: userId } } },
    include: { steps: true },
  });
  if (!flow) return res.status(404).json({ error: 'Not found' });

  if (req.method === 'GET') return res.status(200).json(flow);

  if (req.method === 'PATCH') {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });
    const { steps, ...flowUpdate } = parsed.data;

    const newPatterns = (flowUpdate.triggerConfig as any)?.patterns;
    const willBeActive = flowUpdate.isActive ?? flow.isActive;
    let nextKeywords: string[] | undefined;
    if (newPatterns !== undefined) nextKeywords = normalizeKeywords(newPatterns);

    if (willBeActive && (nextKeywords ?? flow.keywords).length) {
      const conflicts = await findKeywordConflicts({
        connectedAccountId: flow.connectedAccountId,
        keywords: nextKeywords ?? flow.keywords,
        excludeFlowId: flow.id,
      });
      if (conflicts.length) {
        return res.status(409).json({
          error: 'keyword_already_in_use',
          message: 'Another active flow on this page already uses one of these keywords.',
          conflicts,
        });
      }
    }

    await db.$transaction(async (tx) => {
      await tx.flow.update({
        where: { id },
        data: { ...(flowUpdate as any), ...(nextKeywords !== undefined && { keywords: nextKeywords }) },
      });
      if (steps) {
        await tx.flowStep.deleteMany({ where: { flowId: id } });
        if (steps.length) {
          await tx.flowStep.createMany({
            data: steps.map((s) => ({
              flowId: id,
              stepType: s.stepType,
              config: s.config as any,
              position: s.position ?? { x: 0, y: 0 },
              nextStepId: s.nextStepId ?? null,
              branches: s.branches as any,
            })),
          });
        }
      }
    });
    return res.status(200).json(await db.flow.findUnique({ where: { id }, include: { steps: true } }));
  }

  if (req.method === 'DELETE') {
    await db.flow.delete({ where: { id } });
    return res.status(204).end();
  }

  return res.status(405).end();
}

// ─── /api/flows/:id/extend ─────────────────────────────────
const ExtendBody = z.object({
  days:  z.number().int().min(1).max(365).optional(),
  until: z.string().datetime().optional(),
}).refine((b) => b.days || b.until, { message: 'Provide `days` or `until`' });

async function extend(userId: string, id: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const parsed = ExtendBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const flow = await db.flow.findFirst({
    where: { id, connectedAccount: { workspace: { ownerId: userId } } },
  });
  if (!flow) return res.status(404).json({ error: 'Flow not found' });

  let newUntil: Date;
  if (parsed.data.until) {
    newUntil = new Date(parsed.data.until);
  } else {
    const base = flow.validUntilAt && flow.validUntilAt > new Date() ? flow.validUntilAt : new Date();
    newUntil = new Date(base.getTime() + (parsed.data.days! * 86_400_000));
  }
  const updated = await db.flow.update({
    where: { id: flow.id },
    data:  { validUntilAt: newUntil, isActive: true },
  });
  return res.status(200).json({
    id: updated.id, isActive: updated.isActive,
    valid_until_at: updated.validUntilAt?.toISOString() ?? null,
    expires_in_seconds: updated.validUntilAt
      ? Math.max(0, Math.floor((updated.validUntilAt.getTime() - Date.now()) / 1000))
      : null,
  });
}

// ─── /api/flows/:id/test — synthetic dispatcher fire ───────
const TestBody = z.object({
  commentText:   z.string().min(1).max(500).optional(),
  commenterId:   z.string().min(1).max(120).optional(),
  commenterName: z.string().max(120).optional(),
});

async function test(userId: string, id: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const parsed = TestBody.safeParse(req.body ?? {});
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

  const contact = await db.contact.upsert({
    where: { connectedAccountId_platformContactId: { connectedAccountId: flow.connectedAccountId, platformContactId: commenterId } },
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
      ? `Triggered. Public reply + DM jobs queued. Worker runs every 5 min via GitHub Actions. Note: actual Meta calls will fail because comment_id "${fakeCommentId}" is synthetic.`
      : 'No flow matched. Check that the test text contains a configured keyword and the flow is active and within its validity window.',
  });
}
