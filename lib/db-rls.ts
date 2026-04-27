// RLS-scoped Prisma client.
//
// After applying prisma/manual-migrations/001-row-level-security.sql AND
// switching DATABASE_URL to a NOBYPASSRLS role, every API handler that
// operates in a user session must use `dbWith(userId)` instead of `db`.
//
// Each call wraps the operation in a transaction that SETs the
// `app.user_id` session variable; the RLS policies then check that
// variable against owner_id. The per-tx overhead is small but real
// (~1ms additional latency per query); only worth it once the role
// switch is done.
//
// Webhook + worker + OAuth handlers continue using `db` from lib/db.ts
// (the BYPASSRLS service role) because they legitimately have no user
// context.

import { PrismaClient } from '@prisma/client';
import { db } from './db';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// Run `fn` as `userId` — sets app.user_id for the duration of one transaction.
// All Prisma calls inside `fn` go through `tx` and inherit the session var.
export async function withUser<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!isUuid(userId)) throw new Error('withUser: userId must be a UUID');
  return db.$transaction(async (tx) => {
    // SET LOCAL is parameter-quoted by Postgres for set_config, but
    // current_setting() reads back the literal — use set_config for safety.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

// Convenience: dbWith(userId) returns a thin proxy that wraps each top-level
// model access in a transaction. Fine for one-shot reads/writes; for batches,
// prefer withUser() to share a single tx.
export function dbWith(userId: string) {
  if (!isUuid(userId)) throw new Error('dbWith: userId must be a UUID');
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      // Pass through Prisma's own utility methods unchanged
      if (prop.startsWith('$')) return (db as any)[prop]?.bind(db);
      return new Proxy({} as any, {
        get(_t, op) {
          if (typeof op !== 'string') return undefined;
          return (...args: unknown[]) =>
            withUser(userId, (tx) => (tx as any)[prop][op](...args));
        },
      });
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean { return UUID_RE.test(s); }
