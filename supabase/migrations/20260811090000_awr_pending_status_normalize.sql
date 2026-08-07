-- Align AWR approval_status with UI ("Pending") so manager Approve/Reject gates work.
UPDATE public.additional_work_requests
SET approval_status = 'Pending'
WHERE approval_status = 'Pending Manager Approval';

ALTER TABLE public.additional_work_requests
  ALTER COLUMN approval_status SET DEFAULT 'Pending';
