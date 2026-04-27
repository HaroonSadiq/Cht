// Flow engine — stateless DAG traverser.
// Takes a contact's current state + incoming message, picks the next step,
// executes side-effects (send message, update tag, delay), updates state.

import type { Flow, FlowStep, FlowRun, Contact } from '@prisma/client';
import { db } from './db';
import { createAndEnqueueJob } from './jobs';

type StepOutcome =
  | { kind: 'advance'; nextStepId: string | null }
  | { kind: 'wait_for_reply' }
  | { kind: 'delay'; until: Date }
  | { kind: 'done' };

// ─── Trigger matching ──────────────────────────────────────
export function matchKeywordTrigger(
  triggerConfig: any,
  messageText: string,
  channel: 'dm' | 'comment',
): boolean {
  if (triggerConfig?.channel && triggerConfig.channel !== 'both' && triggerConfig.channel !== channel) return false;

  const patterns: string[] = triggerConfig?.patterns ?? [];
  const text = (messageText ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  const matchType = triggerConfig?.match_type ?? 'contains';

  switch (matchType) {
    case 'exact':
      return patterns.some((p) => text === p.toLowerCase());
    case 'contains':
      return patterns.some((p) => text.includes(p.toLowerCase()));
    case 'keyword_any':
      return patterns.some((p) => new RegExp(`\\b${escapeRegex(p)}\\b`, 'i').test(text));
    case 'regex':
      return patterns.some((p) => {
        try {
          // Timeout-guard: cap pattern complexity in a production build.
          return new RegExp(p, 'i').test(text);
        } catch { return false; }
      });
    default:
      return false;
  }
}
function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Pick the entry step in a flow's DAG. The root is the step whose id is
// not referenced by any other step's nextStepId or branches[].next_step_id.
// Falls back to steps[0] for legacy single-step flows.
export function findRootStep(steps: FlowStep[]): FlowStep | undefined {
  if (!steps.length) return undefined;
  const referenced = new Set<string>();
  for (const s of steps) {
    if (s.nextStepId) referenced.add(s.nextStepId);
    const branches = (s.branches as any) ?? [];
    if (Array.isArray(branches)) {
      for (const b of branches) if (b?.next_step_id) referenced.add(b.next_step_id);
    }
  }
  return steps.find((s) => !referenced.has(s.id)) ?? steps[0];
}

// ─── Variable substitution in message text ─────────────────
export function interpolate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const value = path.split('.').reduce((a: any, k: string) => a?.[k], vars);
    return value == null ? '' : String(value);
  });
}

// ─── Execute a single step ─────────────────────────────────
export async function executeStep(args: {
  run: FlowRun;
  step: FlowStep;
  contact: Contact;
  connectedAccountId: string;
  incomingMessage?: string;
}): Promise<StepOutcome> {
  const { run, step, contact, connectedAccountId, incomingMessage } = args;
  const config = step.config as any;

  switch (step.stepType) {
    case 'send_message': {
      const vars = {
        contact: { first_name: contact.displayName?.split(' ')[0] ?? '', ...((contact.customFields ?? {}) as object) },
        flow: { context: run.context },
      };
      const content = config.content ?? { text: '' };
      if (content.text) content.text = interpolate(content.text, vars);

      await createAndEnqueueJob({
        type: 'outbound_message',
        connectedAccountId,
        payload: { contactId: contact.id, connectedAccountId, content },
      });

      return { kind: 'advance', nextStepId: step.nextStepId };
    }

    case 'wait_for_reply': {
      const timeoutHours = config.timeout_hours ?? 24;
      await db.flowRun.update({
        where: { id: run.id },
        data: {
          status: 'waiting_for_reply',
          waitUntil: new Date(Date.now() + timeoutHours * 3_600_000),
        },
      });
      return { kind: 'wait_for_reply' };
    }

    case 'delay': {
      const mins = config.duration_minutes ?? 5;
      const until = new Date(Date.now() + mins * 60_000);
      await db.flowRun.update({
        where: { id: run.id },
        data: { waitUntil: until, currentStepId: step.nextStepId ?? step.id },
      });
      return { kind: 'delay', until };
    }

    case 'branch': {
      const branches: Array<{ condition: any; next_step_id: string }> = (step.branches as any) ?? [];
      for (const b of branches) {
        if (evaluateCondition(b.condition, { contact, run, incomingMessage })) {
          return { kind: 'advance', nextStepId: b.next_step_id };
        }
      }
      return { kind: 'advance', nextStepId: step.nextStepId };
    }

    case 'add_tag': {
      if (config.tag_id) {
        await db.contactTag.upsert({
          where:  { contactId_tagId: { contactId: contact.id, tagId: config.tag_id } },
          update: { appliedBy: 'flow' },
          create: { contactId: contact.id, tagId: config.tag_id, appliedBy: 'flow' },
        });
      }
      return { kind: 'advance', nextStepId: step.nextStepId };
    }

    case 'remove_tag': {
      if (config.tag_id) {
        await db.contactTag.deleteMany({
          where: { contactId: contact.id, tagId: config.tag_id },
        });
      }
      return { kind: 'advance', nextStepId: step.nextStepId };
    }

    case 'set_field': {
      if (config.key) {
        const current = (contact.customFields ?? {}) as Record<string, unknown>;
        await db.contact.update({
          where: { id: contact.id },
          data:  { customFields: { ...current, [config.key]: config.value } },
        });
      }
      return { kind: 'advance', nextStepId: step.nextStepId };
    }

    case 'http_request': {
      // Fire-and-forget external request. Short timeout, captures response into context.
      try {
        const r = await fetch(config.url, {
          method:  config.method ?? 'GET',
          headers: config.headers,
          body:    config.body ? JSON.stringify(config.body) : undefined,
          signal:  AbortSignal.timeout(5000),
        });
        const data = await r.json().catch(() => null);
        await db.flowRun.update({
          where: { id: run.id },
          data:  { context: { ...(run.context as object), http_response: data } },
        });
      } catch (e) { /* swallow; flow continues */ }
      return { kind: 'advance', nextStepId: step.nextStepId };
    }

    case 'handoff_to_human': {
      await db.flowRun.update({
        where: { id: run.id },
        data:  { status: 'completed', completedAt: new Date() },
      });
      return { kind: 'done' };
    }

    case 'ai_agent': {
      await createAndEnqueueJob({
        type: 'outbound_message',
        connectedAccountId,
        payload: {
          contactId: contact.id,
          connectedAccountId,
          content: { text: config.fallback_text ?? 'One moment — let me check on that for you.' },
        },
      });
      return { kind: 'advance', nextStepId: step.nextStepId };
    }

    default:
      return { kind: 'advance', nextStepId: step.nextStepId };
  }
}

function evaluateCondition(
  condition: any,
  ctx: { contact: Contact; run: FlowRun; incomingMessage?: string },
): boolean {
  if (!condition) return true;
  switch (condition.type) {
    case 'contact_has_tag':
      return false; // requires extra query; omitted for brevity
    case 'user_reply_matches':
      return matchKeywordTrigger(condition, ctx.incomingMessage ?? '', 'dm');
    case 'custom_field_equals': {
      const v = (ctx.contact.customFields as any)?.[condition.key];
      return v === condition.value;
    }
    default:
      return false;
  }
}

// ─── Dispatch: start a flow for an inbound message ─────────
// Looks at the active flows on this account, picks the first matching keyword flow,
// and creates a FlowRun seeded on its first step.
export async function dispatchInboundMessage(args: {
  connectedAccountId: string;
  contact: Contact;
  messageText: string;
  channel: 'dm' | 'comment';
}): Promise<FlowRun | null> {
  const { connectedAccountId, contact, messageText, channel } = args;

  // 1. Is this contact already mid-flow waiting for reply? Resume it instead.
  const active = await db.flowRun.findFirst({
    where: { contactId: contact.id, status: 'waiting_for_reply' },
    orderBy: { startedAt: 'desc' },
  });
  if (active) {
    await db.flowRun.update({
      where: { id: active.id },
      data: {
        status: 'active',
        waitUntil: null,
        context: { ...(active.context as object), last_user_reply: messageText },
      },
    });
    return active;
  }

  // 2. Find matching keyword flow — strictly scoped to THIS connected account
  //    AND inside its validity window (default 3 days from creation).
  const now = new Date();
  const text = (messageText ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  const flows = await db.flow.findMany({
    where: {
      connectedAccountId,           // tenant scope
      isActive: true,
      triggerType: 'keyword',
      validFromAt: { lte: now },
      OR: [{ validUntilAt: null }, { validUntilAt: { gt: now } }],
    },
    orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    include: { steps: true },
  });

  for (const flow of flows) {
    // Belt-and-braces: assert the flow really belongs to the integration we
    // were dispatched for. This can never be false unless the DB itself lies.
    if (flow.connectedAccountId !== connectedAccountId) continue;

    if (matchKeywordTrigger(flow.triggerConfig, text, channel)) {
      const firstStep = findRootStep(flow.steps);
      if (!firstStep) continue;
      return db.flowRun.create({
        data: {
          flowId: flow.id,
          contactId: contact.id,
          currentStepId: firstStep.id,
          status: 'active',
          context: { trigger_message: messageText },
        },
      });
    }
  }

  return null;
}

// ───────────────────────────────────────────────────────────
// Dispatch: a public COMMENT was posted on one of our pages.
// This is the comment-to-DM growth tool — the highest-conversion
// feature in the whole category (per the blueprints).
//
// Flow:
//   1. Find active flows with triggerType='comment' on this account.
//   2. Filter by post_ids (or 'all').
//   3. Match the comment text against the keyword patterns.
//   4. If matched:
//      a. Enqueue a public reply to the comment (if `public_reply` set).
//      b. Enqueue an outbound DM via `recipient: { comment_id }`
//         — this is allowed for first-DM-from-comment within 7 days.
//      c. Create a flow_run so subsequent steps execute normally.
// ───────────────────────────────────────────────────────────
export async function dispatchCommentEvent(args: {
  connectedAccountId: string;
  contact: Contact;
  commentId: string;
  postId: string;
  commentText: string;
}): Promise<FlowRun | null> {
  const { connectedAccountId, contact, commentId, postId, commentText } = args;

  const now = new Date();
  const flows = await db.flow.findMany({
    where: {
      connectedAccountId,           // tenant scope: only THIS client's flows
      isActive: true,
      triggerType: 'comment',
      validFromAt: { lte: now },
      OR: [{ validUntilAt: null }, { validUntilAt: { gt: now } }],
    },
    orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    include: { steps: true },
  });

  for (const flow of flows) {
    if (flow.connectedAccountId !== connectedAccountId) continue; // belt-and-braces
    const cfg: any = flow.triggerConfig ?? {};

    // Filter by post — accept either an explicit list or 'all'/empty.
    const postFilter = cfg.post_ids;
    if (Array.isArray(postFilter) && postFilter.length > 0 && !postFilter.includes(postId)) {
      continue;
    }

    if (!matchKeywordTrigger(cfg, commentText, 'comment')) continue;

    // (a) Public auto-reply on the post (optional)
    if (cfg.public_reply && typeof cfg.public_reply === 'string' && cfg.public_reply.trim()) {
      await createAndEnqueueJob({
        type: 'comment_reply',
        connectedAccountId,
        payload: { connectedAccountId, commentId, text: cfg.public_reply.trim() },
      });
    }

    // (b) DM the commenter — first message uses recipient.comment_id
    const firstStep = flow.steps[0];
    if (firstStep && firstStep.stepType === 'send_message') {
      const stepCfg: any = firstStep.config ?? {};
      const dmContent = stepCfg.content ?? { text: cfg.dm_text ?? '' };

      await createAndEnqueueJob({
        type: 'outbound_message',
        connectedAccountId,
        payload: {
          contactId: contact.id,
          connectedAccountId,
          content: dmContent,
          recipientCommentId: commentId,
        },
      });
    }

    // (c) Create a flow_run starting at the SECOND step
    //     (the first step has been hand-executed above to attach comment_id).
    const nextAfterFirst = firstStep?.nextStepId ?? null;
    return db.flowRun.create({
      data: {
        flowId: flow.id,
        contactId: contact.id,
        currentStepId: nextAfterFirst,
        status: nextAfterFirst ? 'active' : 'completed',
        completedAt: nextAfterFirst ? null : new Date(),
        context: {
          trigger: 'comment',
          comment_id: commentId,
          post_id: postId,
          trigger_message: commentText,
        },
      },
    });
  }

  return null;
}
