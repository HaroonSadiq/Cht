import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { db } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { normalizeKeywords, findKeywordConflicts } from '../../lib/tenancy';

const UpdateFlow = z.object({
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const flow = await db.flow.findFirst({
    where: { id, connectedAccount: { workspace: { ownerId: userId } } },
    include: { steps: true },
  });
  if (!flow) return res.status(404).json({ error: 'Not found' });

  if (req.method === 'GET') return res.status(200).json(flow);

  if (req.method === 'PATCH') {
    const parsed = UpdateFlow.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const { steps, ...flowUpdate } = parsed.data;

    // If patterns or activation changed, re-derive keywords and recheck per-client conflicts.
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

  res.status(405).json({ error: 'Method Not Allowed' });
}
