-- ============================================================
-- Migration 042: Authoritative Payment Evidence & Verification
-- Backward-compatible with iTechSkill V2 Migration 002 Schema
--
-- Preserves existing itechskill_payment_evidence_v2 columns:
-- (id BIGINT/BIGSERIAL, event_id, phone, application_id, media_id,
--  observed, status, verified_by, verified_at, bank_transaction_id, created_at)
--
-- Adds CRM-specific verification and audit fields safely using
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- Server-only access via Supabase service role.
-- ============================================================

-- 1. Create table only if not already created by V2 migration 002
CREATE TABLE IF NOT EXISTS public.itechskill_payment_evidence_v2 (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT,
  phone TEXT NOT NULL,
  application_id TEXT NOT NULL,
  media_id TEXT,
  observed BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'pending',
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  bank_transaction_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add CRM-specific columns safely without altering existing types or columns
ALTER TABLE public.itechskill_payment_evidence_v2
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS submitted_reference TEXT,
  ADD COLUMN IF NOT EXISTS submitted_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS submitted_currency TEXT DEFAULT 'PKR',
  ADD COLUMN IF NOT EXISTS is_authoritative BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS beneficiary_account TEXT,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Indexes for query optimization
CREATE INDEX IF NOT EXISTS idx_payment_evidence_app_id
  ON public.itechskill_payment_evidence_v2(application_id);

CREATE INDEX IF NOT EXISTS idx_payment_evidence_phone
  ON public.itechskill_payment_evidence_v2(phone);

CREATE INDEX IF NOT EXISTS idx_payment_evidence_event_id
  ON public.itechskill_payment_evidence_v2(event_id);

-- 4. Unique index on bank_transaction_id to prevent duplicate payment approvals
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_evidence_bank_tx_unique
  ON public.itechskill_payment_evidence_v2(bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL AND bank_transaction_id != '';

-- 5. Add verification columns to enrollment applications if missing
ALTER TABLE IF EXISTS public.itechskill_enrollment_applications
  ADD COLUMN IF NOT EXISTS bank_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS beneficiary_account TEXT,
  ADD COLUMN IF NOT EXISTS payment_evidence_verified BOOLEAN DEFAULT false;

-- 6. Enable RLS and enforce strict server-only access (direct PostgREST client access revoked)
ALTER TABLE public.itechskill_payment_evidence_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_evidence_service_all" ON public.itechskill_payment_evidence_v2;
REVOKE ALL ON TABLE public.itechskill_payment_evidence_v2 FROM anon, authenticated;
