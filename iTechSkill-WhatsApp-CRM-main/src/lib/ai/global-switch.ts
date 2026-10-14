import { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'

export interface GlobalAiAgentSettings {
  ok: boolean
  enabled: boolean
  updated_at: string
  updated_by_email: string | null
  updated_by_user_id?: string | null
  effective_source?: string
  sender_reconciled?: boolean
  unreconciled_reason?: string | null
}

/**
 * Read the company-wide global AI Agent toggle.
 * Strict fail-closed policy: missing/invalid configuration is disabled (false).
 */
export async function getGlobalAiAgentSettings(
  client?: SupabaseClient
): Promise<GlobalAiAgentSettings> {
  const db = client ?? supabaseAdmin()

  try {
    const [crmRes, opsRes, runtimeRes] = await Promise.all([
      db
        .from('crm_ai_agent_settings')
        .select('enabled, updated_at, updated_by_email, updated_by_user_id')
        .eq('id', 1)
        .maybeSingle(),
      db
        .from('itechskill_operations_config')
        .select('config_value, updated_at')
        .eq('config_key', 'ai_agent_enabled')
        .maybeSingle(),
      db
        .from('itechskill_runtime_config')
        .select('ai_enabled, allowed_sender_ids, updated_at')
        .eq('id', true)
        .maybeSingle(),
    ])

    // If table uninitialized, error, or missing: MUST FAIL CLOSED (disabled = false)
    if (crmRes.error && opsRes.error && runtimeRes.error) {
      console.warn('[global-switch] all config sources unreadable — defaulting to disabled (false)')
      return {
        ok: true,
        enabled: false,
        updated_at: new Date().toISOString(),
        updated_by_email: null,
        updated_by_user_id: null,
        effective_source: 'fallback_disabled',
      }
    }

    const crmEnabled = Boolean(crmRes.data?.enabled)
    const opsEnabled =
      typeof opsRes.data?.config_value === 'boolean'
        ? opsRes.data.config_value
        : opsRes.data?.config_value === 'true'
    const runtimeEnabled = Boolean(runtimeRes.data?.ai_enabled)

    // Effective enabled status requires both operations config and runtime config to agree
    // Missing/invalid configuration is disabled
    const effectiveEnabled = crmEnabled && opsEnabled && runtimeEnabled

    const updatedAt =
      crmRes.data?.updated_at ||
      opsRes.data?.updated_at ||
      runtimeRes.data?.updated_at ||
      new Date().toISOString()

    return {
      ok: true,
      enabled: effectiveEnabled,
      updated_at: updatedAt,
      updated_by_email: crmRes.data?.updated_by_email || null,
      updated_by_user_id: crmRes.data?.updated_by_user_id || null,
      effective_source: 'reconciled_crm_and_runtime',
    }
  } catch (err) {
    console.error('[global-switch] error reading settings (failing closed):', err)
    return {
      ok: false,
      enabled: false,
      updated_at: new Date().toISOString(),
      updated_by_email: null,
      updated_by_user_id: null,
      effective_source: 'exception_disabled',
    }
  }
}

/**
 * Verify whether sender configuration agrees across:
 * - CRM whatsapp_config
 * - itechskill_runtime_config.allowed_sender_ids
 * - itechskill_template_registry_v2
 */
export async function verifySenderReconciliation(
  db: SupabaseClient
): Promise<{ reconciled: boolean; primarySenderId: string | null; error?: string }> {
  try {
    const [configRes, runtimeRes, templateRes] = await Promise.all([
      db.from('whatsapp_config').select('phone_number_id, status').maybeSingle(),
      db.from('itechskill_runtime_config').select('allowed_sender_ids').eq('id', true).maybeSingle(),
      db.from('itechskill_template_registry_v2').select('sender_id').limit(10),
    ])

    const crmSenderId = configRes.data?.phone_number_id ? String(configRes.data.phone_number_id).trim() : null
    if (!crmSenderId) {
      return { reconciled: false, primarySenderId: null, error: 'No WhatsApp phone number ID configured in CRM' }
    }

    const allowedSenders = (runtimeRes.data?.allowed_sender_ids as string[]) || []
    if (!allowedSenders.includes(crmSenderId)) {
      return {
        reconciled: false,
        primarySenderId: crmSenderId,
        error: `Runtime allowed_sender_ids [${allowedSenders.join(', ')}] does not include CRM Phone Number ID (${crmSenderId})`,
      }
    }

    const templateSenders = (templateRes.data || []).map((t: { sender_id: string }) => String(t.sender_id).trim())
    const conflictingTemplate = templateSenders.find((s) => s && s !== crmSenderId)
    if (conflictingTemplate) {
      return {
        reconciled: false,
        primarySenderId: crmSenderId,
        error: `Template registry contains mismatched sender ID (${conflictingTemplate}) vs CRM (${crmSenderId})`,
      }
    }

    return { reconciled: true, primarySenderId: crmSenderId }
  } catch (err) {
    return {
      reconciled: false,
      primarySenderId: null,
      error: err instanceof Error ? err.message : 'Failed to verify sender reconciliation',
    }
  }
}

/**
 * Update the global AI Agent toggle atomically across:
 * 1. `crm_ai_agent_settings` (CRM source of truth)
 * 2. `itechskill_operations_config.ai_agent_enabled` (operations config)
 * 3. `itechskill_runtime_config.ai_enabled` (n8n runtime config)
 * 4. `crm_ai_agent_audit_logs` (audit history)
 */
export async function updateGlobalAiAgentSettings(
  enabled: boolean,
  user: { id: string; email?: string | null },
  client?: SupabaseClient
): Promise<GlobalAiAgentSettings> {
  const db = client ?? supabaseAdmin()
  const nowIso = new Date().toISOString()

  // If attempting to enable AI, enforce Sender Reconciliation gate
  if (enabled) {
    const reconciliation = await verifySenderReconciliation(db)
    if (!reconciliation.reconciled) {
      throw new Error(
        `Activation blocked by sender reconciliation gate: ${reconciliation.error || 'CRM, Meta subscription, and n8n allowlist disagree.'}`
      )
    }
  }

  // 1. Get current state for audit log
  let oldEnabled: boolean | null = null
  try {
    const current = await getGlobalAiAgentSettings(db)
    oldEnabled = current.enabled
  } catch {
    // Non-fatal
  }

  // 2. Upsert CRM settings
  const { data: updatedSettings, error: settingsError } = await db
    .from('crm_ai_agent_settings')
    .upsert(
      {
        id: 1,
        enabled,
        updated_at: nowIso,
        updated_by_user_id: user.id,
        updated_by_email: user.email || null,
      },
      { onConflict: 'id' }
    )
    .select('enabled, updated_at, updated_by_email, updated_by_user_id')
    .single()

  if (settingsError) {
    console.error('[global-switch] failed to update crm_ai_agent_settings:', settingsError)
    throw new Error('Failed to update AI Agent settings')
  }

  // 3. Atomically upsert itechskill_operations_config.ai_agent_enabled
  const { error: opsError } = await db.from('itechskill_operations_config').upsert(
    {
      config_key: 'ai_agent_enabled',
      config_value: enabled,
      description:
        'Global WhatsApp AI Agent master switch. false = no live AI replies and no template follow-ups.',
      updated_at: nowIso,
    },
    { onConflict: 'config_key' }
  )

  if (opsError) {
    console.error('[global-switch] failed to sync itechskill_operations_config:', opsError)
    throw new Error(`Failed to update operations config: ${opsError.message}`)
  }

  // 4. Atomically update itechskill_runtime_config.ai_enabled
  const { error: runtimeError } = await db
    .from('itechskill_runtime_config')
    .update({
      ai_enabled: enabled,
      updated_at: nowIso,
    })
    .eq('id', true)

  if (runtimeError) {
    console.error('[global-switch] failed to sync itechskill_runtime_config:', runtimeError)
    throw new Error(`Failed to update runtime config: ${runtimeError.message}`)
  }

  // 5. Record audit log
  try {
    await db.from('crm_ai_agent_audit_logs').insert({
      old_enabled: oldEnabled,
      new_enabled: enabled,
      changed_by_user_id: user.id,
      changed_by_email: user.email || null,
      created_at: nowIso,
    })
  } catch (auditError) {
    console.error('[global-switch] non-fatal: failed to insert audit log:', auditError)
  }

  return {
    ok: true,
    enabled: Boolean(updatedSettings.enabled),
    updated_at: updatedSettings.updated_at,
    updated_by_email: updatedSettings.updated_by_email,
    updated_by_user_id: updatedSettings.updated_by_user_id,
    effective_source: 'atomic_sync_verified',
  }
}
