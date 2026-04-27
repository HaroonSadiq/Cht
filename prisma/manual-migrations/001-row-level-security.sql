-- ────────────────────────────────────────────────────────────
-- 001 · Row-Level Security
-- Defense-in-depth backstop for the application's tenant filter.
--
-- THIS IS A MANUAL MIGRATION. Apply it in three steps:
--   1. Run this SQL against the database (psql / Supabase SQL editor)
--   2. Switch all session-scoped API handlers from `db` to `dbWith(userId)`
--      from lib/db-rls.ts (or wrap in setUserContext())
--   3. Webhook + worker + OAuth handlers continue using the postgres role,
--      which has BYPASSRLS — they perform writes on behalf of users without
--      a session context.
--
-- Reversal:
--   Each ENABLE ROW LEVEL SECURITY can be reverted with DISABLE.
--   Policies are dropped via DROP POLICY <name> ON <table>.
-- ────────────────────────────────────────────────────────────

BEGIN;

-- Helper: read the per-transaction user_id session variable.
-- Returns NULL if unset, which makes every policy fall through to "deny".
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- ── workspaces: owner-only access
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspaces_owner ON workspaces;
CREATE POLICY workspaces_owner ON workspaces
  USING       (owner_id = app_current_user_id())
  WITH CHECK  (owner_id = app_current_user_id());

-- ── connected_accounts: via owning workspace
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connected_accounts_owner ON connected_accounts;
CREATE POLICY connected_accounts_owner ON connected_accounts
  USING       (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = app_current_user_id()))
  WITH CHECK  (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = app_current_user_id()));

-- ── flows: via owning connected_account
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flows_owner ON flows;
CREATE POLICY flows_owner ON flows
  USING       (connected_account_id IN (
                 SELECT id FROM connected_accounts WHERE workspace_id IN (
                   SELECT id FROM workspaces WHERE owner_id = app_current_user_id())))
  WITH CHECK  (connected_account_id IN (
                 SELECT id FROM connected_accounts WHERE workspace_id IN (
                   SELECT id FROM workspaces WHERE owner_id = app_current_user_id())));

-- ── flow_steps: via flow → connected_account → workspace → owner
ALTER TABLE flow_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_steps_owner ON flow_steps;
CREATE POLICY flow_steps_owner ON flow_steps
  USING       (flow_id IN (SELECT id FROM flows))
  WITH CHECK  (flow_id IN (SELECT id FROM flows));

-- ── contacts: via connected_account
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_owner ON contacts;
CREATE POLICY contacts_owner ON contacts
  USING       (connected_account_id IN (SELECT id FROM connected_accounts))
  WITH CHECK  (connected_account_id IN (SELECT id FROM connected_accounts));

-- ── message_events: via contact
ALTER TABLE message_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_events_owner ON message_events;
CREATE POLICY message_events_owner ON message_events
  USING       (contact_id IN (SELECT id FROM contacts))
  WITH CHECK  (contact_id IN (SELECT id FROM contacts));

-- ── flow_runs: via contact
ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_runs_owner ON flow_runs;
CREATE POLICY flow_runs_owner ON flow_runs
  USING       (contact_id IN (SELECT id FROM contacts))
  WITH CHECK  (contact_id IN (SELECT id FROM contacts));

-- ── tags: workspace-scoped
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tags_owner ON tags;
CREATE POLICY tags_owner ON tags
  USING       (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = app_current_user_id()))
  WITH CHECK  (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = app_current_user_id()));

-- ── contact_tags: M:M, both sides must be visible
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_tags_owner ON contact_tags;
CREATE POLICY contact_tags_owner ON contact_tags
  USING       (contact_id IN (SELECT id FROM contacts) AND tag_id IN (SELECT id FROM tags))
  WITH CHECK  (contact_id IN (SELECT id FROM contacts) AND tag_id IN (SELECT id FROM tags));

-- ── broadcasts: scoped by user_id directly
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS broadcasts_owner ON broadcasts;
CREATE POLICY broadcasts_owner ON broadcasts
  USING       (user_id = app_current_user_id())
  WITH CHECK  (user_id = app_current_user_id());

-- ── jobs: via connected_account; nullable connected_account_id stays visible to no-one
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jobs_owner ON jobs;
CREATE POLICY jobs_owner ON jobs
  USING       (connected_account_id IS NULL OR connected_account_id IN (SELECT id FROM connected_accounts))
  WITH CHECK  (connected_account_id IS NULL OR connected_account_id IN (SELECT id FROM connected_accounts));

COMMIT;

-- ────────────────────────────────────────────────────────────
-- IMPORTANT: the `postgres` role used by Prisma still has BYPASSRLS by
-- default on Supabase. For RLS to actually enforce against the API path,
-- create a non-bypassing role and switch the API handlers to it:
--
--   CREATE ROLE flowbot_app NOINHERIT LOGIN PASSWORD '<random>';
--   GRANT CONNECT ON DATABASE postgres TO flowbot_app;
--   GRANT USAGE ON SCHEMA public TO flowbot_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flowbot_app;
--   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO flowbot_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flowbot_app;
--   ALTER ROLE flowbot_app NOBYPASSRLS;
--
-- Then use that role's connection string as DATABASE_URL_APP, keep the
-- existing `postgres` connection as DATABASE_URL_SERVICE for webhooks /
-- worker / OAuth handlers (which legitimately operate without a user
-- context). lib/db-rls.ts handles the per-request session variable.
-- ────────────────────────────────────────────────────────────
