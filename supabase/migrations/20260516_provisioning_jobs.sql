-- =============================================================================
-- Phase 2 — Provisioning jobs table
-- Migration: 20260516_provisioning_jobs.sql
--
-- Provides idempotency for the Stripe webhook → provision-client flow.
-- A UNIQUE constraint on stripe_session_id prevents double-provisioning
-- if Stripe retries the webhook.
--
-- Safe to run on production — additive only, no existing tables modified.
-- =============================================================================

CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text        UNIQUE NOT NULL,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id       uuid        REFERENCES properties(id) ON DELETE SET NULL,
  payload           jsonb       NOT NULL DEFAULT '{}',
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Index for founder dashboard "stuck jobs" query
CREATE INDEX IF NOT EXISTS provisioning_jobs_status_created_idx
  ON provisioning_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS provisioning_jobs_user_id_idx
  ON provisioning_jobs (user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS provisioning_jobs_updated_at ON provisioning_jobs;
CREATE TRIGGER provisioning_jobs_updated_at
  BEFORE UPDATE ON provisioning_jobs
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- RLS — founder can read all, service_role bypasses RLS entirely
ALTER TABLE provisioning_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "founder_all_provisioning_jobs" ON provisioning_jobs
  FOR ALL TO authenticated
  USING (auth.uid() = '65b99794-2174-4e70-aab5-04a884a5992d'::uuid)
  WITH CHECK (auth.uid() = '65b99794-2174-4e70-aab5-04a884a5992d'::uuid);

-- =============================================================================
-- ROLLBACK
-- DROP TABLE IF EXISTS provisioning_jobs;
-- DROP FUNCTION IF EXISTS touch_updated_at();
-- =============================================================================
