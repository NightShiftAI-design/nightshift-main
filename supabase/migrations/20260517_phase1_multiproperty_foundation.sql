-- =============================================================================
-- Phase 1 — Multi-property foundation (additive, backward-compatible)
-- Migration: 20260517_phase1_multiproperty_foundation
--
-- Goal: prepare schema for multiple properties per user without breaking
--       any current single-property functionality.
--
-- Properties of this migration:
--   * 100% additive — only adds columns/tables/indexes
--   * Default values preserve existing row semantics
--   * No data mutation
--   * No constraints added that could fail on existing rows
--   * Safe to run on production while traffic is live
-- =============================================================================

-- ── Per-user "last viewed" property (so we can remember where the user was) ──
-- Stored on hotel_users (per-user metadata) since we don't want to ALTER auth.users.
ALTER TABLE hotel_users
  ADD COLUMN IF NOT EXISTS default_property_id uuid;

-- FK is set without ON DELETE CASCADE so a property delete doesn't yank the row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'hotel_users_default_property_id_fkey'
      AND table_name = 'hotel_users'
  ) THEN
    ALTER TABLE hotel_users
      ADD CONSTRAINT hotel_users_default_property_id_fkey
      FOREIGN KEY (default_property_id) REFERENCES properties(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Provisioning status on properties ──
-- Existing rows are 'active' by default — current single-property users are
-- exactly the same as before to every consumer of this column.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Add the check constraint only after the column exists with a valid default,
-- so the migration cannot fail on existing data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'properties_status_check'
      AND table_name = 'properties'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_status_check
      CHECK (status IN ('active','provisioning','trial','past_due','paused','cancelled'));
  END IF;
END $$;

-- ── Index to support multi-property lookups by user ──
-- The frontend now does .eq('user_id', x) without .limit(1), so we want this
-- indexed for accounts that will eventually own many properties.
CREATE INDEX IF NOT EXISTS hotel_users_user_id_idx ON hotel_users(user_id);

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- If we need to undo this migration (all changes are additive — leaving them in
-- place is also safe), run:
--
--   ALTER TABLE properties   DROP CONSTRAINT IF EXISTS properties_status_check;
--   ALTER TABLE properties   DROP COLUMN     IF EXISTS status;
--   ALTER TABLE hotel_users  DROP CONSTRAINT IF EXISTS hotel_users_default_property_id_fkey;
--   ALTER TABLE hotel_users  DROP COLUMN     IF EXISTS default_property_id;
--   DROP INDEX IF EXISTS hotel_users_user_id_idx;
--
-- These columns are not read by any code that ships before Phase 1 is merged,
-- so dropping them does not affect production.

