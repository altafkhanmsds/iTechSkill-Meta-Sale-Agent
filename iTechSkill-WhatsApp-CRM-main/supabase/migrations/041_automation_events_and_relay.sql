-- ============================================================
-- Migration 041: Automation Events, Webhook Relay, Secure Activation Tokens,
-- Calling Handoffs, and Operations Alerts Deduplication
--
-- Backward-compatible with iTechSkill V2 Schema (Migrations 001-006)
-- and Production itechskill_call_handoffs_v2 schema.
-- Server-only access via Supabase service role (direct client access revoked).
-- ============================================================

-- 1. Durable Relay Inbox
CREATE TABLE IF NOT EXISTS public.itechskill_relay_inbox (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  batch_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'failed', 'dead_letter')),
  raw_payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relay_inbox_status_created
  ON public.itechskill_relay_inbox(status, created_at);

CREATE INDEX IF NOT EXISTS idx_relay_inbox_tenant
  ON public.itechskill_relay_inbox(tenant_id);

CREATE INDEX IF NOT EXISTS idx_relay_inbox_batch_id
  ON public.itechskill_relay_inbox(batch_id);

-- 2. Automation Idempotency Table (Single-tenant & Multi-tenant compatible)
CREATE TABLE IF NOT EXISTS public.itechskill_automation_idempotency (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  response_status INTEGER NOT NULL DEFAULT 200,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_idempotency_tenant_key
  ON public.itechskill_automation_idempotency(COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), idempotency_key);

CREATE INDEX IF NOT EXISTS idx_automation_idempotency_lookup
  ON public.itechskill_automation_idempotency(idempotency_key);

-- 3. Secure Account Activation Tokens (Cryptographic one-time token hash store)
CREATE TABLE IF NOT EXISTS public.itechskill_account_activation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  phone TEXT,
  application_id TEXT,
  account_id TEXT,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_tokens_hash
  ON public.itechskill_account_activation_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_activation_tokens_app
  ON public.itechskill_account_activation_tokens(application_id);

CREATE INDEX IF NOT EXISTS idx_activation_tokens_phone
  ON public.itechskill_account_activation_tokens(phone);

-- 4. Call Handoffs V2 (Backward-compatible with production schema)
-- Preserves existing table, request_id PRIMARY KEY, and (provider, provider_call_id) UNIQUE
CREATE TABLE IF NOT EXISTS public.itechskill_call_handoffs_v2 (
  request_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
  source TEXT NOT NULL DEFAULT 'whatsapp_call',
  provider TEXT NOT NULL DEFAULT 'meta',
  status TEXT NOT NULL DEFAULT 'queued',
  assigned_agent_id TEXT,
  provider_call_id TEXT,
  permission_record_id TEXT,
  recording_consent_record_id TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  queued_at TIMESTAMPTZ,
  reserved_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  failure_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_call_handoffs_provider_call_id UNIQUE (provider, provider_call_id)
);

-- Safely add supplementary columns if not present (non-destructive)
ALTER TABLE public.itechskill_call_handoffs_v2
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_call_handoffs_status_created
  ON public.itechskill_call_handoffs_v2(status, created_at);

CREATE INDEX IF NOT EXISTS idx_call_handoffs_phone
  ON public.itechskill_call_handoffs_v2(phone);

CREATE INDEX IF NOT EXISTS idx_call_handoffs_provider_call_id
  ON public.itechskill_call_handoffs_v2(provider, provider_call_id);

-- 5. Add occurrence_count to itechskill_operations_alerts if not present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'itechskill_operations_alerts'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'itechskill_operations_alerts' AND column_name = 'occurrence_count'
    ) THEN
      ALTER TABLE public.itechskill_operations_alerts
        ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1;
    END IF;
  END IF;
END $$;

-- 6. Enable RLS and enforce strict server-only access (direct PostgREST client access revoked)
ALTER TABLE public.itechskill_relay_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itechskill_automation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itechskill_account_activation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itechskill_call_handoffs_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "relay_inbox_service_all" ON public.itechskill_relay_inbox;
DROP POLICY IF EXISTS "automation_idempotency_service_all" ON public.itechskill_automation_idempotency;
DROP POLICY IF EXISTS "activation_tokens_service_all" ON public.itechskill_account_activation_tokens;
DROP POLICY IF EXISTS "call_handoffs_v2_service_all" ON public.itechskill_call_handoffs_v2;

REVOKE ALL ON TABLE public.itechskill_relay_inbox FROM anon, authenticated;
REVOKE ALL ON TABLE public.itechskill_automation_idempotency FROM anon, authenticated;
REVOKE ALL ON TABLE public.itechskill_account_activation_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.itechskill_call_handoffs_v2 FROM anon, authenticated;
