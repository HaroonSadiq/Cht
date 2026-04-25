// ─── Event Bus (Redis Streams) ─────────────────────────────
// Pub/sub fan-out broker, parallel to the job queue.
//
// • Job queue (lib/jobs.ts):  guaranteed-once work execution. ONE consumer
//   per job — pop with RPOP, do the work, mark completed.
//
// • Event bus (this file):    pub/sub fan-out via Redis Streams. Many
//   independent consumer groups can subscribe to the same topic and each
//   process every event independently. Used for analytics, audit, alerting,
//   future plugins (Zapier-out, customer webhooks, etc.) — anything that
//   wants to react to events WITHOUT being on the critical send path.
//
// This is the right shape for high consumer-interaction volume: the webhook
// fans events out to the bus once; many subscribers each scale independently.

import { redis } from './redis';

export type Topic =
  | 'bus:events:meta'
  | 'bus:events:tiktok'
  | 'bus:flow_runs'
  | 'bus:jobs';

const STREAM_MAXLEN = 10_000; // keep last 10k events per topic (bounded memory)

// Emit an event. Returns the stream entry id, e.g. "1745700000000-0".
// All consumer groups will independently see this event.
export async function emitEvent(topic: Topic, payload: Record<string, unknown>): Promise<string> {
  // Upstash REST API XADD signature: xadd(key, id, field-value pairs)
  // We bound the stream so it never grows unbounded.
  const id = await (redis as any).xadd(
    topic,
    { nomkstream: false, trim: { type: 'MAXLEN', threshold: STREAM_MAXLEN, comparison: '~' } },
    '*',
    { data: JSON.stringify(payload), emitted_at: String(Date.now()) },
  );
  return String(id);
}

// Create a consumer group on a topic if it doesn't already exist.
// Idempotent — swallows the BUSYGROUP error if the group already exists.
export async function ensureConsumerGroup(topic: Topic, group: string): Promise<void> {
  try {
    await (redis as any).xgroup(topic, { type: 'CREATE', group, id: '$', options: { MKSTREAM: true } });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!msg.includes('BUSYGROUP')) throw e;
  }
}

// Read up to `count` pending events for a consumer group. Each event must be
// acked with `ackEvent` once successfully processed; otherwise it stays in
// the pending list and can be reclaimed after a timeout.
export async function readEvents(opts: {
  topic: Topic;
  group: string;
  consumer: string;
  count?: number;
  blockMs?: number;
}): Promise<Array<{ id: string; payload: Record<string, unknown>; emittedAt: number }>> {
  const result = await (redis as any).xreadgroup(
    opts.group,
    opts.consumer,
    [{ key: opts.topic, id: '>' }],
    { count: opts.count ?? 50, block: opts.blockMs ?? 0 },
  );
  if (!result || !Array.isArray(result) || !result.length) return [];

  // Format: [ [streamName, [ [id, [field, value, field, value, ...]], ... ]] ]
  const entries = (result[0] as any)?.[1] ?? [];
  return entries.map((e: any) => {
    const [id, fields] = e;
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
    return {
      id: String(id),
      payload: obj.data ? JSON.parse(obj.data) : {},
      emittedAt: Number(obj.emitted_at ?? 0),
    };
  });
}

export async function ackEvent(topic: Topic, group: string, id: string): Promise<void> {
  await (redis as any).xack(topic, group, id);
}

// Lightweight info for ops dashboards: stream length + lag per consumer group.
export async function streamStats(topic: Topic): Promise<{ length: number }> {
  const length = await (redis as any).xlen(topic);
  return { length: Number(length ?? 0) };
}
