-- ============================================================
-- 042: Allow authenticated users to delete their own notifications
-- ============================================================

-- Grant table-level DELETE permission to authenticated users
GRANT DELETE ON notifications TO authenticated;

-- Ensure RLS allows deletion of rows where user_id matches auth.uid()
DROP POLICY IF EXISTS notifications_delete ON notifications;
CREATE POLICY notifications_delete ON notifications FOR DELETE
  USING (auth.uid() = user_id);
