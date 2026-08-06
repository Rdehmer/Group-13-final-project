-- Storage for customer service request photo attachments (request-service flow).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-request-attachments',
  'customer-request-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY customer_request_attachments_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'customer-request-attachments'
  AND app_user_role() = 'customer'::user_role
  AND my_customer_id() IS NOT NULL
  AND (storage.foldername(name))[1] = my_customer_id()::text
);

CREATE POLICY customer_request_attachments_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'customer-request-attachments'
  AND (
    (select public.is_manager())
    OR (
      app_user_role() = 'customer'::user_role
      AND my_customer_id() IS NOT NULL
      AND (storage.foldername(name))[1] = my_customer_id()::text
    )
  )
);
