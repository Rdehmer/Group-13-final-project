-- Demo timesheet hours for all technicians (manager Timesheets: total / week / billable).
-- Idempotent via [DEMO-TIMESHEET] notes tag.

DELETE FROM public.time_entries WHERE notes LIKE '[DEMO-TIMESHEET]%';
DELETE FROM public.technician_day_clocks WHERE notes LIKE '[DEMO-TIMESHEET]%';

DO $$
DECLARE
  mgr uuid;
  tech_ids uuid[] := ARRAY[]::uuid[];
  tech_emails text[] := ARRAY[
    'tech1@equipmentiq-demo.test',
    'tech2@equipmentiq-demo.test',
    'tech3@equipmentiq-demo.test',
    'tech4@equipmentiq-demo.test',
    'tech5@equipmentiq-demo.test'
  ];
  tech_id uuid;
  wo_rec record;
  week_start date;
  d date;
  day_idx int;
  shift_hours numeric;
  in_at timestamptz;
  out_at timestamptz;
  travel_h numeric;
  work_h numeric;
  cost_rate numeric;
  bill_rate numeric;
  i int;
BEGIN
  SELECT id INTO mgr FROM public.profiles WHERE email = 'manager@equipmentiq-demo.test' LIMIT 1;
  IF mgr IS NULL THEN
    RAISE NOTICE 'demo timesheet seed skipped: manager profile missing';
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(tech_emails, 1) LOOP
    SELECT id INTO tech_id FROM public.profiles WHERE email = tech_emails[i] LIMIT 1;
    IF tech_id IS NOT NULL THEN
      tech_ids := array_append(tech_ids, tech_id);
    END IF;
  END LOOP;

  IF array_length(tech_ids, 1) IS NULL THEN
    RAISE NOTICE 'demo timesheet seed skipped: no technicians';
    RETURN;
  END IF;

  -- Match app week (Sunday start)
  week_start := current_date - extract(dow from current_date)::int;

  FOR i IN 1 .. array_length(tech_ids, 1) LOOP
    tech_id := tech_ids[i];
    cost_rate := 42 + (i * 3);
    bill_rate := 90 + (i * 5);

    -- My Day shift clocks Mon–Fri (8h-ish, tech3 gets a longer Thursday for OT demo)
    FOR day_idx IN 1 .. 5 LOOP
      d := week_start + day_idx;
      shift_hours := CASE
        WHEN i = 4 THEN 6
        WHEN i = 3 AND day_idx = 4 THEN 10
        WHEN i = 2 THEN 7.5
        WHEN day_idx = 5 THEN 6
        ELSE 8
      END;
      in_at := d + time '07:30';
      out_at := in_at + make_interval(hours => shift_hours::int, mins => ((shift_hours - trunc(shift_hours)) * 60)::int);

      INSERT INTO public.technician_day_clocks (
        technician_id, work_date, clock_in_at, clock_out_at, notes
      ) VALUES (
        tech_id, d, in_at, out_at, '[DEMO-TIMESHEET] My Day shift'
      );
    END LOOP;

    -- Job time entries: travel + regular work on three days
    FOR day_idx IN SELECT unnest(ARRAY[1, 2, 4]) LOOP
      d := week_start + day_idx;

      SELECT wo.id, wo.customer_id
      INTO wo_rec
      FROM public.work_orders wo
      WHERE wo.status NOT IN ('Canceled', 'Cancelled')
      ORDER BY wo.created_at DESC
      OFFSET (i + day_idx - 1)
      LIMIT 1;

      IF wo_rec.id IS NULL THEN
        CONTINUE;
      END IF;

      travel_h := 0.5;
      work_h := CASE
        WHEN i = 5 AND day_idx = 4 THEN 5.5
        WHEN i = 3 THEN 4.5
        WHEN i = 4 THEN 3.5
        ELSE 4
      END;

      INSERT INTO public.time_entries (
        technician_id, work_order_id, customer_id, entry_date,
        clock_in_at, clock_out_at, total_minutes,
        activity_type, billable_status,
        regular_hours, overtime_hours,
        hourly_cost_rate, overtime_cost_rate, billing_rate,
        labor_cost, billable_amount,
        notes, is_manual, approval_status,
        approved_by, approved_at, billing_status, created_by
      ) VALUES (
        tech_id, wo_rec.id, wo_rec.customer_id, d,
        d + time '08:00', d + time '08:30', (travel_h * 60)::int,
        'travel', 'billable',
        travel_h, 0,
        cost_rate, cost_rate * 1.5, bill_rate,
        travel_h * cost_rate, travel_h * bill_rate,
        '[DEMO-TIMESHEET] Travel to job', false, 'approved',
        mgr, now(), 'ready_to_bill', tech_id
      );

      INSERT INTO public.time_entries (
        technician_id, work_order_id, customer_id, entry_date,
        clock_in_at, clock_out_at, total_minutes,
        activity_type, billable_status,
        regular_hours, overtime_hours,
        hourly_cost_rate, overtime_cost_rate, billing_rate,
        labor_cost, billable_amount,
        notes, is_manual, approval_status,
        approved_by, approved_at, billing_status, created_by
      ) VALUES (
        tech_id, wo_rec.id, wo_rec.customer_id, d,
        d + time '08:30', d + time '08:30' + make_interval(hours => work_h::int, mins => ((work_h - trunc(work_h)) * 60)::int),
        (work_h * 60)::int,
        'regular_work', 'billable',
        work_h, 0,
        cost_rate, cost_rate * 1.5, bill_rate,
        work_h * cost_rate, work_h * bill_rate,
        '[DEMO-TIMESHEET] On-site labor', false, 'approved',
        mgr, now(), 'ready_to_bill', tech_id
      );
    END LOOP;

    -- One non-billable shop block per tech (counts in total, not billable)
    d := week_start + 3;
    INSERT INTO public.time_entries (
      technician_id, work_order_id, customer_id, entry_date,
      clock_in_at, clock_out_at, total_minutes,
      activity_type, billable_status,
      regular_hours, overtime_hours,
      hourly_cost_rate, overtime_cost_rate, billing_rate,
      labor_cost, billable_amount,
      notes, is_manual, approval_status,
      approved_by, approved_at, billing_status, created_by
    ) VALUES (
      tech_id, NULL, NULL, d,
      d + time '16:00', d + time '17:00', 60,
      'shop', 'nonbillable',
      1, 0,
      cost_rate, cost_rate * 1.5, 0,
      cost_rate, 0,
      '[DEMO-TIMESHEET] Shop / staging', false, 'approved',
      mgr, now(), 'not_ready', tech_id
    );
  END LOOP;

  RAISE NOTICE 'demo timesheet seed inserted for % technicians', array_length(tech_ids, 1);
END $$;
