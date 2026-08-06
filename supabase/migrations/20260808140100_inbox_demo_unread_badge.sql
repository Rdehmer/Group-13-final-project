-- Re-seed customer1 inbox demo thread so the portal unread badge is demonstrable.

INSERT INTO public.customer_inbox_messages (thread_id, sender_role, sender_profile_id, body)
SELECT
  t.id,
  'staff',
  NULL,
  'Quick follow-up — we are still coordinating your WO-77715073 visit window. We will post the confirmed time here shortly.'
FROM public.customer_inbox_threads t
JOIN public.profiles p ON p.customer_id = t.customer_id
WHERE p.email = 'customer1@ridley-demo.test'
  AND t.subject = 'Update on WO-77715073'
  AND NOT EXISTS (
    SELECT 1
    FROM public.customer_inbox_messages m
    WHERE m.thread_id = t.id
      AND m.sender_role = 'staff'
      AND m.body LIKE 'Quick follow-up%'
  );

UPDATE public.customer_inbox_threads t
SET customer_last_read_at = NULL
FROM public.profiles p
WHERE p.customer_id = t.customer_id
  AND p.email = 'customer1@ridley-demo.test'
  AND t.subject = 'Update on WO-77715073';
