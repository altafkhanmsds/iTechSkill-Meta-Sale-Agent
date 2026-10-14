import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { getGlobalAiAgentSettings } from '@/lib/ai/global-switch'
import { processAutomationEvent, WhatsappAcceptedEvent } from '@/lib/automation/event-handler'

let _adminClient: SupabaseClient | null = null

function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }

  return _adminClient
}

interface WhatsAppConfigRow {
  id: string
  account_id: string
  user_id: string
  phone_number_id: string
}

export async function POST(request: Request) {
  try {
    // 0. Check global AI Agent master switch
    const globalSettings = await getGlobalAiAgentSettings()
    if (!globalSettings.enabled) {
      return NextResponse.json(
        {
          error: 'AI Agent is currently paused globally',
          enabled: false,
        },
        { status: 403 }
      )
    }

    const body = await request.json()

    const phone = String(body.phone || '').trim()
    const phoneNumberId = String(body.phone_number_id || '').trim()
    const reply = String(body.reply || '').trim()
    const timestamp =
      String(body.timestamp || '').trim() || new Date().toISOString()

    if (!phone) {
      return NextResponse.json(
        { error: 'Missing phone' },
        { status: 400 }
      )
    }

    if (!phoneNumberId) {
      return NextResponse.json(
        { error: 'Missing phone_number_id' },
        { status: 400 }
      )
    }

    if (!reply) {
      return NextResponse.json(
        { error: 'Missing reply' },
        { status: 400 }
      )
    }

    // 1. Resolve CRM account from WhatsApp phone number ID
    const { data: allConfigs, error: allConfigsError } =
      await supabaseAdmin()
        .from('whatsapp_config')
        .select('id, account_id, user_id, phone_number_id')

    if (allConfigsError) {
      return NextResponse.json(
        {
          error: 'WhatsApp configuration lookup failed',
          details: allConfigsError.message,
        },
        { status: 500 }
      )
    }

    const configRows = ((allConfigs as WhatsAppConfigRow[]) || []).filter(
      (row: WhatsAppConfigRow) =>
        String(row.phone_number_id).trim() === String(phoneNumberId).trim()
    )

    if (configRows.length === 0) {
      return NextResponse.json(
        {
          error: 'WhatsApp configuration not found',
          received_phone_number_id: phoneNumberId,
        },
        { status: 404 }
      )
    }

    if (configRows.length > 1) {
      return NextResponse.json(
        {
          error: 'Multiple WhatsApp configurations found',
          phone_number_id: phoneNumberId,
        },
        { status: 409 }
      )
    }

    const accountId = configRows[0].account_id
    const normalizedPhone = normalizePhone(phone)

    // 2. Formulate idempotent event payload
    const providerMessageId =
      String(body.message_id || '').trim() || `n8n-ai-${crypto.randomUUID()}`
    const idempotencyKey =
      request.headers.get('Idempotency-Key') ||
      request.headers.get('x-idempotency-key') ||
      providerMessageId

    const eventPayload: WhatsappAcceptedEvent = {
      schema_version: '2.0',
      event_type: 'whatsapp_accepted',
      phone: normalizedPhone,
      phone_number_id: phoneNumberId,
      outbox_id: body.outbox_id || providerMessageId,
      provider_message_id: providerMessageId,
      reply,
      timestamp,
    }

    // 3. Dispatch through idempotent automation event engine
    const eventResult = await processAutomationEvent({
      tenantId: accountId,
      idempotencyKey,
      payload: eventPayload,
    })

    if (eventResult.status >= 400) {
      return NextResponse.json(eventResult.body, { status: eventResult.status })
    }

    return NextResponse.json(
      {
        success: true,
        message: 'AI reply saved to CRM',
        provider_message_id: providerMessageId,
        ...eventResult.body,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[ai-reply] unexpected error:', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error',
      },
      { status: 500 }
    )
  }
}