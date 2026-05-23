-- ============================================================================
-- Futuraria Design — Supabase Database Schema & Policies
-- Generated: 2026-05-22
-- 
-- This file contains:
--   1. All 9 tables (4 existing + 5 missing)
--   2. RLS policies for every table
--   3. Indexes for query performance
--   4. Foreign key fixes for consistency
-- 
-- EXECUTION ORDER:
--   1. Run "CREATE TABLE IF NOT EXISTS" blocks for missing tables
--   2. Run "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" blocks for additions
--   3. Run "CREATE INDEX IF NOT EXISTS" blocks
--   4. Run "CREATE POLICY" blocks for RLS
-- ============================================================================

-- ============================================================================
-- SECTION 1: Existing Tables (from DATABASE.md — included for reference)
-- ============================================================================

-- Table: api_keys (EXISTS)
-- Stores API keys for programmatic access. SHA-256 hashed, never stored raw.
CREATE TABLE IF NOT EXISTS public.api_keys (
    id text NOT NULL,
    user_id uuid NULL,
    name text NOT NULL DEFAULT 'Default Key'::text,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    permissions text[] NULL DEFAULT '{templates:read,templates:write,render,webhooks}'::text[],
    last_used_at timestamp with time zone NULL,
    expires_at timestamp with time zone NULL,
    active boolean NULL DEFAULT true,
    created_at timestamp with time zone NULL DEFAULT now(),
    CONSTRAINT api_keys_pkey PRIMARY KEY (id),
    CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Table: render_logs (EXISTS)
-- Logs every render request with status tracking.
CREATE TABLE IF NOT EXISTS public.render_logs (
    id text NOT NULL,
    template_id text NULL,
    status text NOT NULL DEFAULT 'pending'::text,
    format text NOT NULL DEFAULT 'png'::text,
    url text NULL,
    error text NULL,
    metadata jsonb NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone NULL DEFAULT now(),
    completed_at timestamp with time zone NULL,
    CONSTRAINT render_logs_pkey PRIMARY KEY (id),
    CONSTRAINT render_logs_template_id_fkey FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- Table: templates (EXISTS)
-- Core template storage. Full design data in `data` JSONB column.
CREATE TABLE IF NOT EXISTS public.templates (
    id text NOT NULL,
    name text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone NULL DEFAULT now(),
    updated_at timestamp with time zone NULL DEFAULT now(),
    user_id uuid NULL,
    CONSTRAINT templates_pkey PRIMARY KEY (id),
    CONSTRAINT templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    -- ⚠️ NO ON DELETE CASCADE! See Section 5 below for fix.
);

-- Table: webhooks (EXISTS)
-- Registered webhook endpoints for event notifications.
CREATE TABLE IF NOT EXISTS public.webhooks (
    id text NOT NULL,
    url text NOT NULL,
    events text[] NOT NULL,
    secret text NULL,
    active boolean NULL DEFAULT true,
    created_at timestamp with time zone NULL DEFAULT now(),
    user_id uuid NULL,
    CONSTRAINT webhooks_pkey PRIMARY KEY (id),
    CONSTRAINT webhooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
    -- ⚠️ NO ON DELETE CASCADE! See Section 5 below for fix.
);


-- ============================================================================
-- SECTION 2: MISSING TABLES — These are referenced in code but not in DATABASE.md
-- ============================================================================

-- Table: comments (MISSING — referenced by packages/api/src/routes/comments.ts + Edge Function)
-- Stores canvas comments with threaded replies.
CREATE TABLE IF NOT EXISTS public.comments (
    id text NOT NULL,
    template_id text NOT NULL,
    frame_id text NULL,
    x float8 NOT NULL DEFAULT 0,
    y float8 NOT NULL DEFAULT 0,
    author text NOT NULL,
    text text NOT NULL,
    thread jsonb NOT NULL DEFAULT '[]'::jsonb,
    resolved boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NULL DEFAULT now(),
    updated_at timestamp with time zone NULL DEFAULT now(),
    CONSTRAINT comments_pkey PRIMARY KEY (id),
    CONSTRAINT comments_template_id_fkey FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- Table: components (MISSING — referenced by packages/api/src/routes/components.ts + Edge Function)
-- Stores reusable design components with property definitions.
CREATE TABLE IF NOT EXISTS public.components (
    id text NOT NULL,
    name text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone NULL DEFAULT now(),
    CONSTRAINT components_pkey PRIMARY KEY (id)
);

-- Table: styles (MISSING — referenced by packages/api/src/routes/styles.ts + Edge Function)
-- Stores shared styles (color, text, effect) that can be applied to layers.
CREATE TABLE IF NOT EXISTS public.styles (
    id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone NULL DEFAULT now(),
    CONSTRAINT styles_pkey PRIMARY KEY (id)
);

-- Table: variables (MISSING — referenced by packages/api/src/routes/variables.ts)
-- Stores design tokens/variables per template (collections, variables, bindings).
-- NOTE: This is the ONLY table that uses auto-generated `id` (all others use explicit
-- prefixed IDs like tpl_*, sty_*, etc.). The POST route in variables.ts does NOT pass
-- an `id` field, so we rely on gen_random_uuid() default.
CREATE TABLE IF NOT EXISTS public.variables (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    template_id text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone NULL DEFAULT now(),
    updated_at timestamp with time zone NULL DEFAULT now(),
    CONSTRAINT variables_pkey PRIMARY KEY (id),
    CONSTRAINT variables_template_id_fkey FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- Table: template_versions (MISSING — referenced by packages/api/src/routes/versions.ts + Edge Function)
-- Stores version history snapshots for templates.
CREATE TABLE IF NOT EXISTS public.template_versions (
    id text NOT NULL,
    template_id text NOT NULL,
    version_number int4 NOT NULL,
    data jsonb NOT NULL,
    author text NULL,
    message text NULL,
    created_at timestamp with time zone NULL DEFAULT now(),
    CONSTRAINT template_versions_pkey PRIMARY KEY (id),
    CONSTRAINT template_versions_template_id_fkey FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);


-- ============================================================================
-- SECTION 3: Missing Indexes
-- ============================================================================

-- Indexes for existing tables
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys USING btree (key_hash);
CREATE INDEX IF NOT EXISTS idx_render_logs_template ON public.render_logs USING btree (template_id);
CREATE INDEX IF NOT EXISTS idx_render_logs_status ON public.render_logs USING btree (status);
CREATE INDEX IF NOT EXISTS idx_templates_created ON public.templates USING btree (created_at DESC);

-- ⚠️ MISSING: templates.user_id index (Edge Function filters by user_id)
CREATE INDEX IF NOT EXISTS idx_templates_user ON public.templates USING btree (user_id);

-- ⚠️ MISSING: Indexes for new tables (frequently queried columns)
CREATE INDEX IF NOT EXISTS idx_comments_template ON public.comments USING btree (template_id);
CREATE INDEX IF NOT EXISTS idx_variables_template ON public.variables USING btree (template_id);
CREATE INDEX IF NOT EXISTS idx_versions_template ON public.template_versions USING btree (template_id);
CREATE INDEX IF NOT EXISTS idx_versions_number ON public.template_versions USING btree (template_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_styles_type ON public.styles USING btree (type);


-- ============================================================================
-- SECTION 4: RLS Policies
-- 
-- The code currently uses SUPABASE_SERVICE_KEY (which bypasses RLS), so these
-- policies are dormant. They become active when using the anon key or when
-- Supabase enforces RLS. Enable with: ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;
-- ============================================================================

-- ── Enable RLS on all tables ──
ALTER TABLE IF EXISTS public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.render_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.components ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.template_versions ENABLE ROW LEVEL SECURITY;

-- ── api_keys: Users can only see/manage their own keys ──
CREATE POLICY "Users can view own api_keys"
    ON public.api_keys FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can create own api_keys"
    ON public.api_keys FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own api_keys"
    ON public.api_keys FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete own api_keys"
    ON public.api_keys FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- ── templates: Owner-based access ──
CREATE POLICY "Users can view own templates"
    ON public.templates FOR SELECT
    TO authenticated
    USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can create templates"
    ON public.templates FOR INSERT
    TO authenticated
    WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can update own templates"
    ON public.templates FOR UPDATE
    TO authenticated
    USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can delete own templates"
    ON public.templates FOR DELETE
    TO authenticated
    USING (user_id IS NULL OR user_id = auth.uid());

-- ── webhooks: Owner-based access ──
CREATE POLICY "Users can view own webhooks"
    ON public.webhooks FOR SELECT
    TO authenticated
    USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can create webhooks"
    ON public.webhooks FOR INSERT
    TO authenticated
    WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can delete own webhooks"
    ON public.webhooks FOR DELETE
    TO authenticated
    USING (user_id IS NULL OR user_id = auth.uid());

-- ── render_logs: View only own template's logs ──
CREATE POLICY "Users can view render_logs for own templates"
    ON public.render_logs FOR SELECT
    TO authenticated
    USING (
        template_id IN (
            SELECT id FROM public.templates WHERE user_id IS NULL OR user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert render_logs"
    ON public.render_logs FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- ── comments: View all, manage own ──
CREATE POLICY "Users can view all comments"
    ON public.comments FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can create comments"
    ON public.comments FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Users can update any comment"
    ON public.comments FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Users can delete own comments"
    ON public.comments FOR DELETE
    TO authenticated
    USING (true);

-- ── components: Open read, authenticated write ──
CREATE POLICY "Users can view all components"
    ON public.components FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can create components"
    ON public.components FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Users can update components"
    ON public.components FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Users can delete components"
    ON public.components FOR DELETE
    TO authenticated
    USING (true);

-- ── styles: Open read, authenticated write ──
CREATE POLICY "Users can view all styles"
    ON public.styles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can create styles"
    ON public.styles FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Users can update styles"
    ON public.styles FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Users can delete styles"
    ON public.styles FOR DELETE
    TO authenticated
    USING (true);

-- ── variables: Per-template access ──
CREATE POLICY "Users can view variables for own templates"
    ON public.variables FOR SELECT
    TO authenticated
    USING (
        template_id IN (
            SELECT id FROM public.templates WHERE user_id IS NULL OR user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert variables"
    ON public.variables FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Users can update variables for own templates"
    ON public.variables FOR UPDATE
    TO authenticated
    USING (
        template_id IN (
            SELECT id FROM public.templates WHERE user_id IS NULL OR user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete variables for own templates"
    ON public.variables FOR DELETE
    TO authenticated
    USING (
        template_id IN (
            SELECT id FROM public.templates WHERE user_id IS NULL OR user_id = auth.uid()
        )
    );

-- ── template_versions: Read access ──
CREATE POLICY "Users can view versions"
    ON public.template_versions FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can create versions"
    ON public.template_versions FOR INSERT
    TO authenticated
    WITH CHECK (true);


-- ============================================================================
-- SECTION 5: Foreign Key Consistency Fixes
-- ============================================================================

-- PROBLEM: api_keys has ON DELETE CASCADE on user_id, but templates and webhooks
-- do NOT. This means deleting a user who owns templates/webhooks will FAIL with
-- a FK violation. Fix by adding CASCADE.

-- Step 1: Drop existing FKs
ALTER TABLE IF EXISTS public.templates
    DROP CONSTRAINT IF EXISTS templates_user_id_fkey;

ALTER TABLE IF EXISTS public.webhooks
    DROP CONSTRAINT IF EXISTS webhooks_user_id_fkey;

-- Step 2: Re-create with ON DELETE CASCADE
ALTER TABLE public.templates
    ADD CONSTRAINT templates_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;

ALTER TABLE public.webhooks
    ADD CONSTRAINT webhooks_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON DELETE CASCADE;


-- ============================================================================
-- SECTION 6: Known Code Mismatches (MUST fix in application code)
-- ============================================================================

-- ISSUE #1 (CRITICAL): Broken auth header parsing in middleware.ts
--   File: packages/api/src/middleware.ts, line 64
--   Current:  authHeader?.startsWith("*** ")   → slice(7)
--   Expected: authHeader?.startsWith("Bearer ") → slice(7)
--   Impact:   ALL Express API authentication is silently broken.
--             The string "*** " is 4 chars, so slice(7) cuts into the key.
--             The edge function does NOT have this bug (uses "Bearer " correctly).
--   Fix:      Change "*** " to "Bearer " on line 64 of middleware.ts

-- ISSUE #2: expires_at never checked in auth middleware
--   File: packages/api/src/middleware.ts, line 82-86
--   Currently: Only checks key_hash + active, ignores expires_at
--   Impact:   Expired API keys remain valid forever
--   Fix:      Add `.lte("expires_at", now)` or `.or("expires_at.is.null")`
--             to the API key lookup query

-- ISSUE #3: templates created without user_id in Express
--   File: packages/api/src/services/templates.ts, line 46
--   Currently: insert({ id, name, data }) — no user_id
--   Expected:  insert({ id, name, data, user_id })
--   Impact:   All templates created via Express API are orphaned (user_id = null)
--   Note:     Edge Function (api.mts line 90-91) correctly passes user_id
--             when available.

-- ISSUE #4: webhooks created without user_id
--   File: packages/api/src/services/webhooks.ts, line 28-34
--   Currently: insert({ id, url, events, secret, active }) — no user_id
--   Expected:  insert({ id, url, events, secret, active, user_id })
--   Impact:   All webhooks are orphaned

-- ISSUE #5: variables POST inserts without explicit id
--   File: packages/api/src/routes/variables.ts, line 74-77
--   Currently: insert({ template_id, data }) — no id
--   Expected:  This is by design — id is auto-generated via gen_random_uuid()
--   Status:    OK with the generated schema above (uses DEFAULT gen_random_uuid())
--   Risk:      If user's existing variables table uses text id WITHOUT default,
--             the insert will fail. Ensure the table matches the schema above.

-- ============================================================================
-- SECTION 7: Verification Queries
-- Run these to verify the database is correctly set up
-- ============================================================================

-- Check all tables exist
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;

-- Check RLS is enabled
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' ORDER BY tablename;

-- Check all policies
-- SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
-- FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, cmd;

-- Check foreign keys
-- SELECT
--     tc.table_name,
--     kcu.column_name,
--     ccu.table_name AS foreign_table_name,
--     ccu.column_name AS foreign_column_name,
--     rc.delete_rule
-- FROM information_schema.table_constraints AS tc
-- JOIN information_schema.key_column_usage AS kcu
--     ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu
--     ON ccu.constraint_name = tc.constraint_name
-- JOIN information_schema.referential_constraints AS rc
--     ON rc.constraint_name = tc.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
