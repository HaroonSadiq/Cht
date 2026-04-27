# Manual database migrations

Migrations in this directory are **not** auto-applied by `prisma db push` or `prisma migrate`. Apply them by hand against your database when you're ready, in order.

## Why manual?

These migrations change the security or operational posture of the database in ways that require coordinated code changes. Auto-applying them would break the deployed app.

## Rollout order

### 001 · Row-Level Security

**File:** `001-row-level-security.sql`

**What it does:** Enables Postgres RLS on every owner-scoped table and creates policies that check `app.user_id` against the row owner.

**Why:** Defense-in-depth backstop for the application's `where: { ownerId: userId }` filter. If a future API handler forgets that clause, RLS catches the cross-tenant leak.

**Three-step rollout:**

1. **Apply the SQL.**
   ```bash
   # via psql
   psql "$DIRECT_URL" -f prisma/manual-migrations/001-row-level-security.sql
   # or paste it into Supabase SQL Editor
   ```
   At this point RLS is enabled, but Prisma still connects as the `postgres` role which has `BYPASSRLS` — so the app keeps working as before.

2. **Create a non-bypassing role and grant it minimum privileges.**
   ```sql
   CREATE ROLE flowbot_app NOINHERIT LOGIN PASSWORD '<random>';
   GRANT CONNECT ON DATABASE postgres TO flowbot_app;
   GRANT USAGE ON SCHEMA public TO flowbot_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flowbot_app;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO flowbot_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flowbot_app;
   ALTER ROLE flowbot_app NOBYPASSRLS;
   ```
   Build a connection string for `flowbot_app` against the same Supabase pooler. Set it as `DATABASE_URL_APP` in Vercel env (alongside the existing `DATABASE_URL`, which becomes the service-role string).

3. **Switch session-scoped API handlers from `db` to `dbWith(userId)`.**

   In each handler that runs inside a user session (anything using `requireUser()`):
   ```ts
   // before
   import { db } from '../lib/db';
   const flows = await db.flow.findMany({ where: { connectedAccount: { workspace: { ownerId: userId } } }});

   // after
   import { dbWith } from '../lib/db-rls';
   const tx = dbWith(userId);
   const flows = await tx.flow.findMany();   // RLS does the tenant filter
   ```

   The webhook ingest, worker, and OAuth callback continue importing `db` directly (they're service paths with no session).

**Verifying it works:**

After the rollout, this query should return nothing for the wrong user:
```sql
SET app.user_id = '00000000-0000-0000-0000-000000000000';
SELECT * FROM flows;  -- should be empty even if rows exist
```

And this should return the user's own rows:
```sql
SET app.user_id = '<real-user-uuid>';
SELECT * FROM flows;
```

**Reverting:** Each `ENABLE` is reversible with `DISABLE`. Drop the policies with `DROP POLICY ... ON ...`. Drop the role with `DROP ROLE flowbot_app`.
