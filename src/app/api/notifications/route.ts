import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export const runtime = 'nodejs';

/**
 * GET /api/notifications
 * List notifications for the authenticated user.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notifications: data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/notifications
 * Mark one notification as read/unread or mark all notifications as read.
 * Body options:
 * - { all: true } -> mark all unread notifications for this user as read
 * - { id: string, read: boolean } -> toggle read/unread status for single notification
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const admin = supabaseAdmin();

    if (body.all === true) {
      const now = new Date().toISOString();
      const { error, count } = await admin
        .from('notifications')
        .update({ read_at: now })
        .eq('user_id', user.id)
        .is('read_at', null);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, count: count ?? 0, read_at: now });
    }

    if (body.id) {
      const readAt = body.read !== false ? new Date().toISOString() : null;
      const { error } = await admin
        .from('notifications')
        .update({ read_at: readAt })
        .eq('id', body.id)
        .eq('user_id', user.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, id: body.id, read_at: readAt });
    }

    return NextResponse.json(
      { error: 'Missing "id" or "all: true" in request body' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications
 * Delete a single notification or delete all notifications for the user.
 * Supports:
 * - query: ?all=true OR ?id=xxx
 * - body: { all: true } OR { id: "xxx" }
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryAll = searchParams.get('all') === 'true';
    const queryId = searchParams.get('id');

    let body: { all?: boolean; id?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional if query params are provided
    }

    const deleteAll = queryAll || body.all === true;
    const targetId = queryId || body.id;

    const admin = supabaseAdmin();

    if (deleteAll) {
      const { error } = await admin
        .from('notifications')
        .delete()
        .eq('user_id', user.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'All notifications deleted' });
    }

    if (targetId) {
      const { error } = await admin
        .from('notifications')
        .delete()
        .eq('id', targetId)
        .eq('user_id', user.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, id: targetId });
    }

    return NextResponse.json(
      { error: 'Specify target "id" or "all=true" to delete' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
