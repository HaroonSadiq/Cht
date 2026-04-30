// Worker — drains the three queues with full job-status tracking.
// Triggered every minute by Vercel Cron; secured by CRON_SECRET.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../lib/db';
import { redis, checkRateLimit } from '../lib/redis';
import { safeEqual } from '../lib/crypto';
import { popJobIds, loadJob, markRunning, markCompleted, markFailed } from '../lib/jobs';
import { dispatchInboundMessage, dispatchCommentEvent, executeStep } from '../lib/flow-engine';
import { sendMessage, replyToComment, isWithin24hWindow } from '../lib/meta';
import type { NormalizedEvent } from '../lib/events';
import { ensureConsumerGroup, readEvents, ackEvent } from '../lib/event-bus';
import { refreshExpiringTokens, shouldRefreshNow } from '../lib/token-refresh';
import { verifyQStashSignature } from '../lib/qstash';

const MAX_BATCH = 25;
const MAX_TIME_MS = 55_000;

export const config = { api: { bodyParser: false } };

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Two valid auth modes: ?key=CRON_SECRET (cron + manual) OR a QStash-signed POST.
  const key = (req.query.key as string) ?? '';
  const cronOk = !!process.env.CRON_SECRET && safeEqual(key, process.env.CRON_SECRET);

  let qstashOk = false;
  if (req.method === 'POST') {
    const raw = await readRawBody(req);
    const sig = req.headers['upstash-signature'];
    qstashOk = verifyQStashSignature(raw, Array.isArray(sig) ? sig[0] : sig ?? null);
  }

  if (!cronOk && !qstashOk) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const deadline = Date.now() + MAX_TIME_MS;
  const stats = { inbound: 0, runs: 0, outbound: 0, replies: 0, expired: 0, analytics: 0, errors: 0, tokens_refreshed: 0 };

  // ─── 0. Expire flows whose validUntilAt has passed ───────
  // Cheap one-shot UPDATE; runs every cron tick (1 min).
  const expired = await db.flow.updateMany({
    where: { isActive: true, validUntilAt: { lt: new Date() } },
    data:  { isActive: false },
  });
  stats.expired = expired.count;

  // ─── 1. Drain inbound (event) jobs ───────────────────────
  while (Date.now() < deadline) {
    const ids = await popJobIds('facebook-events', MAX_BATCH);
    if (!ids.length) break;
    for (const id of ids) {
      try {
        await processInboundJob(id);
        stats.inbound++;
      } catch (e) {
        await markFailed(id, String((e as any)?.message ?? e));
        stats.errors++;
      }
    }
  }

  // ─── 2. Wake up delayed flow_runs ────────────────────────
  if (Date.now() < deadline) {
    const now = new Date();
    const ready = await db.flowRun.findMany({
      where: { waitUntil: { lte: now }, status: 'active' },
      orderBy: { waitUntil: 'asc' },
      take: 50,
      include: { contact: true, flow: true },
    });
    for (const run of ready) {
      if (Date.now() > deadline) break;
      try { await advanceRun(run as any); stats.runs++; }
      catch (e) { stats.errors++; console.error('[worker] advanceRun', e); }
    }
  }

  // ─── 3a. Drain comment-reply jobs ────────────────────────
  while (Date.now() < deadline) {
    const ids = await popJobIds('comment-replies', MAX_BATCH);
    if (!ids.length) break;
    for (const id of ids) {
      try { await processCommentReplyJob(id); stats.replies++; }
      catch (e) { await markFailed(id, String((e as any)?.message ?? e)); stats.errors++; }
    }
  }

  // ─── 3b. Drain outbound message jobs ─────────────────────
  while (Date.now() < deadline) {
    const ids = await popJobIds('outbound-messages', MAX_BATCH);
    if (!ids.length) break;
    for (const id of ids) {
      try { await processOutboundJob(id); stats.outbound++; }
      catch (e) { await markFailed(id, String((e as any)?.message ?? e)); stats.errors++; }
    }
  }

  // ─── 3c. Token refresh — extend long-lived FB tokens ─────
  // Rate-limited via Redis to once per 6 hours so a 5-min cron tick
  // doesn't hammer the Graph API. Each run processes up to 25 accounts.
  if (Date.now() < deadline && (await shouldRefreshNow())) {
    try {
      const tokenStats = await refreshExpiringTokens();
      stats.tokens_refreshed = tokenStats.refreshed;
      stats.errors += tokenStats.failed;
      if (tokenStats.errors.length > 0) {
        console.warn('[worker] token refresh errors', tokenStats.errors);
      }
    } catch (e) {
      console.error('[worker] token refresh phase failed', e);
      stats.errors++;
    }
  }

  // ─── 4. Event bus: analytics consumer group ──────────────
  // Reads the pub/sub stream INDEPENDENTLY of the dispatcher.
  // Counters are kept in Redis (HINCRBY) — cheap and high-volume safe.
  // Add more consumer groups (audit, alerting, plugins) the same way.
  if (Date.now() < deadline) {
    try {
      await ensureConsumerGroup('bus:events:meta', 'analytics');
      const events = await readEvents({
        topic: 'bus:events:meta',
        group: 'analytics',
        consumer: 'worker-1',
        count: 100,
        blockMs: 0,
      });
      for (const e of events) {
        const ev = (e.payload as any)?.event;
        const intId = (e.payload as any)?.integration_id ?? 'unknown';
        if (ev?.type) {
          await redis.hincrby(`metrics:integration:${intId}`, ev.type, 1);
          await redis.hincrby(`metrics:integration:${intId}`, 'total', 1);
        }
        await ackEvent('bus:events:meta', 'analytics', e.id);
        stats.analytics++;
      }
    } catch (e) {
      console.error('[worker] analytics consumer failed', e);
      stats.errors++;
    }
  }

  // Diagnostic: surface the last 10 minutes of FAILED jobs so we can see why
  // /replies/outbound counters might tick without actual delivery. The phase
  // counters above (`replies`, `outbound`) increment when the job *processed*,
  // not when it *succeeded* — failures live in jobs.status='failed'.
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const recentFailed = await db.job.findMany({
    where: { status: 'failed', finishedAt: { gte: since } },
    orderBy: { finishedAt: 'desc' },
    take: 8,
    select: { id: true, type: true, error: true, finishedAt: true, connectedAccountId: true },
  });
  const recentCompleted = await db.job.count({
    where: { status: 'completed', finishedAt: { gte: since }, type: { in: ['comment_reply', 'outbound_message'] } },
  });

  return res.status(200).json({
    ok: true,
    stats,
    delivery_last_10min: {
      sent_ok: recentCompleted,
      failed:  recentFailed.length,
      failures: recentFailed.map((j) => ({
        id: j.id, type: j.type, error: j.error,
        finished_at: j.finishedAt?.toISOString() ?? null,
      })),
    },
  });
}

// ───────────────────────────────────────────────────────────
// 1. INBOUND: a normalized event waiting for routing
// ───────────────────────────────────────────────────────────
async function processInboundJob(jobId: string) {
  const job = await loadJob(jobId);
  if (!job) return;
  await markRunning(jobId);

  const payload = job.payload as unknown as { event: NormalizedEvent; integration_id: string | null };
  const event = payload.event;

  if (!job.connectedAccountId) {
    return markCompleted(jobId, { skipped: 'no_matching_integration' });
  }
  const account = await db.connectedAccount.findUnique({ where: { id: job.connectedAccountId } });
  if (!account) return markCompleted(jobId, { skipped: 'integration_deleted' });

  // Don't auto-respond to the page replying to itself
  if (event.sender.user_id === account.platformAccountId) {
    return markCompleted(jobId, { skipped: 'own_message' });
  }

  // Upsert contact
  const isComment = event.type === 'comment_added';
  const contact = await db.contact.upsert({
    where: {
      connectedAccountId_platformContactId: {
        connectedAccountId: account.id,
        platformContactId:  event.sender.user_id,
      },
    },
    update: {
      lastSeenAt:    new Date(),
      // public comments don't open the 24h DM window — only DMs do
      ...(isComment ? {} : { lastInboundAt: new Date() }),
      ...(event.sender.name && { displayName: event.sender.name }),
    },
    create: {
      connectedAccountId: account.id,
      platformContactId:  event.sender.user_id,
      displayName:        event.sender.name,
      lastInboundAt:      isComment ? null : new Date(),
    },
  });

  // Log message_event (idempotent)
  const platformMessageId = event.message?.message_id ?? event.comment?.comment_id ?? event.event_id;
  await db.messageEvent.upsert({
    where: {
      connectedAccountId_platformMessageId: {
        connectedAccountId: account.id,
        platformMessageId,
      },
    },
    update: {},
    create: {
      connectedAccountId: account.id,
      contactId:          contact.id,
      platformMessageId,
      channel:            isComment ? 'comment' : 'dm',
      direction:          'inbound',
      messageText:        event.message?.text ?? event.comment?.text ?? null,
      attachments:        (event.message?.attachments as any) ?? undefined,
    },
  });

  // Dispatch
  let run = null;
  if (event.type === 'message_received' && event.message?.text) {
    run = await dispatchInboundMessage({
      connectedAccountId: account.id,
      contact,
      messageText: event.message.text,
      channel: 'dm',
    });
  } else if (event.type === 'comment_added' && event.comment) {
    run = await dispatchCommentEvent({
      connectedAccountId: account.id,
      contact,
      commentId:   event.comment.comment_id,
      postId:      event.comment.post_id,
      commentText: event.comment.text,
    });
  }

  if (run && run.currentStepId) {
    await advanceRun({ ...run, contact, flow: null } as any);
  }

  await markCompleted(jobId, {
    matched_flow_id: run?.flowId ?? null,
    execution_status: run ? 'queued' : 'no_match',
  }, run?.flowId ?? undefined);
}

// ───────────────────────────────────────────────────────────
// Advance a flow_run — run inline steps until we hit a wait/delay/done
// ───────────────────────────────────────────────────────────
async function advanceRun(run: any) {
  let currentId = run.currentStepId as string | null;
  for (let i = 0; i < 20; i++) {
    if (!currentId) {
      await db.flowRun.update({
        where: { id: run.id },
        data:  { status: 'completed', completedAt: new Date() },
      });
      return;
    }
    const step = await db.flowStep.findUnique({ where: { id: currentId } });
    if (!step) return;

    const contact = run.contact ?? await db.contact.findUnique({ where: { id: run.contactId } });
    if (!contact) return;
    const flow = run.flow ?? await db.flow.findUnique({ where: { id: run.flowId } });
    if (!flow) return;

    const outcome = await executeStep({
      run, step, contact,
      connectedAccountId: flow.connectedAccountId,
      incomingMessage: (run.context as any)?.last_user_reply,
    });
    if (outcome.kind === 'wait_for_reply' || outcome.kind === 'delay' || outcome.kind === 'done') return;

    currentId = outcome.nextStepId ?? null;
    await db.flowRun.update({ where: { id: run.id }, data: { currentStepId: currentId } });
  }
}

// ───────────────────────────────────────────────────────────
// 2. COMMENT REPLY: post a public sub-comment under the trigger comment
// ───────────────────────────────────────────────────────────
async function processCommentReplyJob(jobId: string) {
  const job = await loadJob(jobId);
  if (!job) return;
  await markRunning(jobId);

  const p = job.payload as { commentId: string; text: string; connectedAccountId: string };
  const account = await db.connectedAccount.findUnique({ where: { id: p.connectedAccountId } });
  if (!account) return markFailed(jobId, 'integration_not_found');

  // 30 replies / minute / page
  const rl = await checkRateLimit(`reply:${account.id}`, 30, 60);
  if (!rl.allowed) {
    await redis.lpush('q:comment-replies', jobId); // re-queue
    await markFailed(jobId, 'rate_limited', true);
    return;
  }

  const result = await replyToComment({
    commentId: p.commentId,
    accessTokenEncrypted: account.accessTokenEncrypted,
    text: p.text,
  });
  if (!result.ok) return markFailed(jobId, result.error);
  await markCompleted(jobId, result.raw);
}

// ───────────────────────────────────────────────────────────
// 3. OUTBOUND MESSAGE: send a DM (with comment-to-DM support)
// ───────────────────────────────────────────────────────────
async function processOutboundJob(jobId: string) {
  const job = await loadJob(jobId);
  if (!job) return;
  await markRunning(jobId);

  const p = job.payload as { contactId: string; connectedAccountId: string; content: any; recipientCommentId?: string };
  const contact = await db.contact.findUnique({ where: { id: p.contactId }, include: { connectedAccount: true } });
  if (!contact) return markFailed(jobId, 'contact_not_found');

  const account = contact.connectedAccount;
  const rl = await checkRateLimit(`send:${account.id}`, 200, 60);
  if (!rl.allowed) {
    await redis.lpush('q:outbound-messages', jobId);
    await markFailed(jobId, 'rate_limited', true);
    return;
  }

  // Routing rule:
  //   - If the contact has DM'd us before (lastInboundAt set), use the PSID
  //     path. Meta allows this for everyone INCLUDING the page admin, and the
  //     24h window covers most cases; ACCOUNT_UPDATE tag covers the rest.
  //   - Otherwise (first-time commenter, no DM history), fall back to the
  //     comment_id path. Allowed for 7 days post-comment, but Meta blocks
  //     this path when the commenter == page admin (returns code=1).
  // This restores the pre-regression behavior: admins who'd DM'd the page
  // before still get DMs via PSID; new public commenters still get DMs via
  // comment_id.
  const useCommentRecipient = !!p.recipientCommentId && !contact.lastInboundAt;
  const within = isWithin24hWindow(contact.lastInboundAt);
  const platform = account.platform === 'instagram' ? 'instagram' : 'messenger';

  const result = await sendMessage({
    platform,
    platformAccountId:    account.platformAccountId,
    accessTokenEncrypted: account.accessTokenEncrypted,
    recipientId:          useCommentRecipient ? undefined : contact.platformContactId,
    recipientCommentId:   useCommentRecipient ? p.recipientCommentId : undefined,
    content:              p.content,
    messagingType:        useCommentRecipient || within ? 'RESPONSE' : 'MESSAGE_TAG',
    tag:                  useCommentRecipient || within ? undefined : 'ACCOUNT_UPDATE',
  });

  await db.messageEvent.create({
    data: {
      connectedAccountId: account.id,
      contactId:          contact.id,
      platformMessageId:  result.ok ? result.messageId : undefined,
      channel:            'dm',
      direction:          'outbound',
      messageText:        p.content?.text ?? null,
      attachments:        result.ok ? undefined : ({ error: (result as any).error } as any),
    },
  });

  if (!result.ok) {
    if ((result as any).code === 190) {
      await db.connectedAccount.update({ where: { id: account.id }, data: { status: 'expired' } });
    }
    // Capture full Meta error envelope so we can see subcode + fbtrace_id
    // when triaging — the bare message ("Please reduce the amount of data...")
    // is identical for several distinct failure modes.
    const r: any = result;
    const fbErr = r.raw?.error ?? {};
    const detail = [
      r.error ?? 'send_failed',
      fbErr.code      != null ? `code=${fbErr.code}`      : null,
      fbErr.error_subcode != null ? `subcode=${fbErr.error_subcode}` : null,
      fbErr.error_user_title ? `title=${fbErr.error_user_title}`     : null,
      fbErr.error_user_msg   ? `user_msg=${fbErr.error_user_msg}`    : null,
      fbErr.fbtrace_id       ? `trace=${fbErr.fbtrace_id}`           : null,
      `mode=${useCommentRecipient ? 'comment_id' : 'psid'}`,
    ].filter(Boolean).join(' | ');
    return markFailed(jobId, detail);
  }
  await markCompleted(jobId, result.raw);
}
