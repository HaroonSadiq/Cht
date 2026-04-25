// Durable job tracking — every queued event/send creates a Job row
// (matches the JSON contract's `queue` block: queue_name, job_id, status).
//
// Fast-path queueing is still in Redis lists; this gives queryable status,
// retries, and an audit trail.

import { db } from './db';
import { redis } from './redis';
import { newJobId } from './events';

export type JobType = 'inbound_event' | 'outbound_message' | 'comment_reply';

const QUEUE_NAMES: Record<JobType, string> = {
  inbound_event:    'facebook-events',
  outbound_message: 'outbound-messages',
  comment_reply:    'comment-replies',
};

// Create + enqueue in one shot. Returns { jobId, queueName }.
export async function createAndEnqueueJob(opts: {
  type: JobType;
  connectedAccountId?: string;
  payload: unknown;
}): Promise<{ jobId: string; queueName: string }> {
  const jobId = newJobId();
  const queueName = QUEUE_NAMES[opts.type];

  await db.job.create({
    data: {
      id:                 jobId,
      queueName,
      type:               opts.type,
      status:             'waiting',
      payload:            opts.payload as any,
      connectedAccountId: opts.connectedAccountId,
    },
  });

  // Push the job_id onto Redis (worker pulls by id, then loads from Postgres)
  await redis.lpush(`q:${queueName}`, jobId);

  return { jobId, queueName };
}

export async function popJobIds(queueName: string, max = 10): Promise<string[]> {
  const raws = await redis.rpop(`q:${queueName}`, max);
  if (!raws) return [];
  return Array.isArray(raws) ? (raws as string[]) : [raws as string];
}

export async function loadJob(jobId: string) {
  return db.job.findUnique({ where: { id: jobId } });
}

export async function markRunning(jobId: string) {
  return db.job.update({
    where: { id: jobId },
    data:  { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
}

export async function markCompleted(jobId: string, result?: unknown, matchedFlowId?: string) {
  return db.job.update({
    where: { id: jobId },
    data: {
      status:         'completed',
      finishedAt:     new Date(),
      result:         result as any,
      matchedFlowId:  matchedFlowId ?? undefined,
    },
  });
}

export async function markFailed(jobId: string, error: string, retry = false) {
  return db.job.update({
    where: { id: jobId },
    data: {
      status:     retry ? 'retrying' : 'failed',
      finishedAt: retry ? null : new Date(),
      error,
    },
  });
}
