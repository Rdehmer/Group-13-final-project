-- Customer inbox unread tracking for portal notification badge.

ALTER TABLE public.customer_inbox_threads
  ADD COLUMN IF NOT EXISTS customer_last_read_at timestamptz null,
  ADD COLUMN IF NOT EXISTS last_sender_role text null
    CHECK (last_sender_role IS NULL OR last_sender_role IN ('customer', 'staff'));

COMMENT ON COLUMN public.customer_inbox_threads.customer_last_read_at IS
  'When the customer last opened this thread; used for unread badge.';
COMMENT ON COLUMN public.customer_inbox_threads.last_sender_role IS
  'Role of the most recent message sender (kept in sync by trigger).';

-- Backfill last_sender_role from latest message per thread.
UPDATE public.customer_inbox_threads t
SET last_sender_role = m.sender_role
FROM (
  SELECT DISTINCT ON (thread_id) thread_id, sender_role
  FROM public.customer_inbox_messages
  ORDER BY thread_id, created_at DESC
) m
WHERE t.id = m.thread_id
  AND t.last_sender_role IS NULL;

CREATE OR REPLACE FUNCTION public.touch_inbox_thread_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.customer_inbox_threads
  SET
    last_message_at = NEW.created_at,
    last_sender_role = NEW.sender_role
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

-- Customers may mark their own threads as read.
DROP POLICY IF EXISTS customer_inbox_threads_customer_update_read ON public.customer_inbox_threads;
CREATE POLICY customer_inbox_threads_customer_update_read
  ON public.customer_inbox_threads
  FOR UPDATE
  TO authenticated
  USING (
    app_user_role() = 'customer'::user_role
    AND customer_id = my_customer_id()
    AND my_customer_id() IS NOT NULL
  )
  WITH CHECK (
    app_user_role() = 'customer'::user_role
    AND customer_id = my_customer_id()
    AND my_customer_id() IS NOT NULL
  );
