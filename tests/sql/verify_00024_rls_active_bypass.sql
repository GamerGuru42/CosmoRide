-- =============================================================================
-- CosmoRide Live PostgreSQL RLS Verification Script for Migration 00024
-- =============================================================================
-- PURPOSE:
--   Self-contained, rolled-back Staging verification of migration 00024
--   (`00024_fix_staff_policy_active_bypass.sql`) against live PostgreSQL RLS,
--   SECURITY DEFINER helpers, and Supabase JWT claim resolution.
--
-- SAFETY GUARANTEES:
--   1. Runs completely inside `BEGIN; ... ROLLBACK;` — ZERO persistent writes.
--   2. Uses isolated synthetic UUIDs (`f2400000-...`) and `TST_00024_*` codes —
--      never modifies or deletes existing university data.
--   3. Assumes ZERO pre-seeded Staging data and proves baseline counts = 4
--      before switching to `ROLE authenticated`.
--   4. Self-verifies `current_user = 'authenticated'` and `auth.uid() = actor`
--      on every check so an unauthenticated fallback or NULL JWT cannot cause a
--      false-pass `0`-row result.
--   5. Fails loudly with `RAISE EXCEPTION` on the first mismatch. When all 28
--      checks pass, `ROLLBACK;` completes cleanly with zero residual fixtures.
--
-- EXECUTION PREREQUISITE:
--   - Execute ONLY in Staging (`xpibmzofkxeowmjipcyt`), NEVER in Production.
--   - Requires a SQL Editor session role permitted to `INSERT INTO auth.users`
--     and `SET LOCAL ROLE authenticated` (default Supabase `postgres` role).
-- =============================================================================

BEGIN;

CREATE TEMP TABLE pg_temp.verify_00024_results (
  check_no INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  target TEXT NOT NULL,
  expected_count INTEGER NOT NULL,
  observed_count INTEGER NOT NULL,
  status TEXT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  -- Isolated fixture identifiers
  v_group_a         CONSTANT UUID := 'f2400000-0000-4000-8000-000000000101';
  v_group_b         CONSTANT UUID := 'f2400000-0000-4000-8000-000000000102';
  v_stop_a          CONSTANT UUID := 'f2400000-0000-4000-8000-000000000201';
  v_route_a         CONSTANT UUID := 'f2400000-0000-4000-8000-000000000301';
  v_route_b         CONSTANT UUID := 'f2400000-0000-4000-8000-000000000302';
  v_vehicle_a       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000401';
  v_vehicle_b       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000402';

  -- 9 isolated test actors
  v_active_student  CONSTANT UUID := 'f2400000-0000-4000-8000-000000000001';
  v_inactive_stud   CONSTANT UUID := 'f2400000-0000-4000-8000-000000000002';
  v_super_admin     CONSTANT UUID := 'f2400000-0000-4000-8000-000000000003';
  v_bus_manager     CONSTANT UUID := 'f2400000-0000-4000-8000-000000000004';
  v_hostel_manager  CONSTANT UUID := 'f2400000-0000-4000-8000-000000000005';
  v_boarding_off    CONSTANT UUID := 'f2400000-0000-4000-8000-000000000006';
  v_active_driver   CONSTANT UUID := 'f2400000-0000-4000-8000-000000000007';
  v_inactive_bo     CONSTANT UUID := 'f2400000-0000-4000-8000-000000000008';
  v_inactive_admin  CONSTANT UUID := 'f2400000-0000-4000-8000-000000000009';

  -- 2 drivers & 2 journeys (Group A assigned; Group B unassigned)
  v_driver_rec_a    CONSTANT UUID := 'f2400000-0000-4000-8000-000000000501';
  v_driver_rec_b    CONSTANT UUID := 'f2400000-0000-4000-8000-000000000502';
  v_journey_a       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000601';
  v_journey_b       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000602';

  -- 4 bookings -> 4 boarding_records + 4 waitlists
  v_booking_1       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000701';
  v_booking_2       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000702';
  v_booking_3       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000703';
  v_booking_4       CONSTANT UUID := 'f2400000-0000-4000-8000-000000000704';

  v_br_1            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000801';
  v_br_2            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000802';
  v_br_3            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000803';
  v_br_4            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000804';

  v_wl_1            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000901';
  v_wl_2            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000902';
  v_wl_3            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000903';
  v_wl_4            CONSTANT UUID := 'f2400000-0000-4000-8000-000000000904';

  v_test_date       CONSTANT DATE := CURRENT_DATE + 30;
  v_test_dep        CONSTANT TIMESTAMPTZ := ((CURRENT_DATE + 30)::timestamp + TIME '08:00:00') AT TIME ZONE 'Africa/Lagos';

  v_user_ids        UUID[] := ARRAY[
    v_active_student, v_inactive_stud, v_super_admin, v_bus_manager,
    v_hostel_manager, v_boarding_off, v_active_driver, v_inactive_bo, v_inactive_admin
  ];
  v_user_tags       TEXT[] := ARRAY[
    'active_student', 'inactive_student', 'super_admin', 'bus_manager',
    'hostel_manager', 'boarding_officer', 'active_driver', 'inactive_bo', 'inactive_admin'
  ];

  v_idx             INTEGER;
  v_obs             INTEGER;
  v_eff_user        TEXT;
  v_eff_uid         UUID;
  v_total_checks    INTEGER := 0;
  v_case            RECORD;
BEGIN
  -- Clear any inherited JWT claim settings so setup runs as trusted SQL Editor role
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- ---------------------------------------------------------------------------
  -- STEP 1: Create isolated fixtures inside the rolled-back transaction
  -- ---------------------------------------------------------------------------
  INSERT INTO public.transport_groups (id, name, code, gender_group, is_active)
  VALUES
    (v_group_a, 'Test 00024 Group A', 'TST_00024_GRP_A', 'male', TRUE),
    (v_group_b, 'Test 00024 Group B', 'TST_00024_GRP_B', 'female', TRUE);

  INSERT INTO public.stops (id, name, address)
  VALUES (v_stop_a, 'Test 00024 Bus Stop', 'Staging Isolated Verification');

  -- Positive estimated_duration_minutes satisfies journey availability trigger checks
  INSERT INTO public.routes (id, name, code, gender_group, transport_group_id, estimated_duration_minutes, is_active)
  VALUES
    (v_route_a, 'Test 00024 Route A', 'TST_00024_RTE_A', 'male', v_group_a, 30, TRUE),
    (v_route_b, 'Test 00024 Route B', 'TST_00024_RTE_B', 'female', v_group_b, 30, TRUE);

  INSERT INTO public.vehicles (id, registration_number, name, safe_capacity, seated_capacity, standing_capacity, status, is_active)
  VALUES
    (v_vehicle_a, 'TST-00024-A', 'Test Vehicle A', 32, 20, 12, 'available', TRUE),
    (v_vehicle_b, 'TST-00024-B', 'Test Vehicle B', 32, 20, 12, 'available', TRUE);

  -- Insert auth.users; `on_auth_user_created` creates corresponding public.profiles rows
  FOR v_idx IN 1..array_length(v_user_ids, 1) LOOP
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    VALUES (
      v_user_ids[v_idx],
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      'rls00024_' || v_user_tags[v_idx] || '@test.cosmoride.invalid',
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Test 00024 ' || v_user_tags[v_idx]),
      now(),
      now()
    );
  END LOOP;

  -- Assign roles, admin sub-roles, groups, and active flags on public.profiles
  UPDATE public.profiles SET student_id = 'CU/TST/00024A', is_active = TRUE  WHERE id = v_active_student;
  UPDATE public.profiles SET student_id = 'CU/TST/00024B', is_active = FALSE WHERE id = v_inactive_stud;
  UPDATE public.profiles SET role = 'admin', admin_role = 'super_admin',    is_active = TRUE  WHERE id = v_super_admin;
  UPDATE public.profiles SET role = 'admin', admin_role = 'bus_manager',    is_active = TRUE  WHERE id = v_bus_manager;
  UPDATE public.profiles SET role = 'admin', admin_role = 'hostel_manager', is_active = TRUE  WHERE id = v_hostel_manager;
  UPDATE public.profiles SET role = 'boarding_officer', assigned_transport_group_id = v_group_a, is_active = TRUE  WHERE id = v_boarding_off;
  UPDATE public.profiles SET role = 'driver', is_active = TRUE  WHERE id = v_active_driver;
  UPDATE public.profiles SET role = 'boarding_officer', assigned_transport_group_id = v_group_a, is_active = FALSE WHERE id = v_inactive_bo;
  UPDATE public.profiles SET role = 'admin', admin_role = 'bus_manager',    is_active = FALSE WHERE id = v_inactive_admin;

  INSERT INTO public.drivers (id, profile_id, full_name, driver_reference, assigned_vehicle_id, status, has_app_access)
  VALUES
    (v_driver_rec_a, v_active_driver, 'Test 00024 Driver A', 'TST-00024-DRV-A', v_vehicle_a, 'active', TRUE),
    (v_driver_rec_b, NULL,            'Test 00024 Driver B', 'TST-00024-DRV-B', v_vehicle_b, 'active', FALSE);

  INSERT INTO public.journeys (
    id, route_id, vehicle_id, driver_id, driver_record_id,
    journey_date, scheduled_departure, proposed_allocation, status, created_by
  )
  VALUES
    (v_journey_a, v_route_a, v_vehicle_a, v_active_driver, v_driver_rec_a, v_test_date, v_test_dep, 32, 'scheduled', v_super_admin),
    (v_journey_b, v_route_b, v_vehicle_b, NULL,            v_driver_rec_b, v_test_date, v_test_dep, 32, 'scheduled', v_super_admin);

  INSERT INTO public.bookings (id, journey_id, student_id, boarding_stop_id, status, passenger_category, ticket_token)
  VALUES
    (v_booking_1, v_journey_a, v_active_student, v_stop_a, 'checked_in', 'seated', 'tst-00024-token-1'),
    (v_booking_2, v_journey_a, v_inactive_stud,  v_stop_a, 'checked_in', 'seated', 'tst-00024-token-2'),
    (v_booking_3, v_journey_b, v_active_student, v_stop_a, 'checked_in', 'seated', 'tst-00024-token-3'),
    (v_booking_4, v_journey_b, v_inactive_stud,  v_stop_a, 'checked_in', 'seated', 'tst-00024-token-4');

  INSERT INTO public.boarding_records (id, booking_id, journey_id, student_id, vehicle_id, scanned_by, boarding_method, passenger_category, is_verified)
  VALUES
    (v_br_1, v_booking_1, v_journey_a, v_active_student, v_vehicle_a, v_boarding_off, 'qr_scan', 'seated', TRUE),
    (v_br_2, v_booking_2, v_journey_a, v_inactive_stud,  v_vehicle_a, v_boarding_off, 'qr_scan', 'seated', TRUE),
    (v_br_3, v_booking_3, v_journey_b, v_active_student, v_vehicle_b, v_boarding_off, 'qr_scan', 'seated', TRUE),
    (v_br_4, v_booking_4, v_journey_b, v_inactive_stud,  v_vehicle_b, v_boarding_off, 'qr_scan', 'seated', TRUE);

  INSERT INTO public.waitlists (id, journey_id, student_id, boarding_stop_id, position, status)
  VALUES
    (v_wl_1, v_journey_a, v_active_student, v_stop_a, 1, 'waiting'),
    (v_wl_2, v_journey_a, v_inactive_stud,  v_stop_a, 2, 'waiting'),
    (v_wl_3, v_journey_b, v_active_student, v_stop_a, 1, 'waiting'),
    (v_wl_4, v_journey_b, v_inactive_stud,  v_stop_a, 2, 'waiting');

  -- Baseline non-empty check before RLS testing
  SELECT count(*) INTO v_obs FROM public.boarding_records WHERE id IN (v_br_1, v_br_2, v_br_3, v_br_4);
  IF v_obs <> 4 THEN RAISE EXCEPTION 'Fixture setup failed: boarding_records count=%', v_obs; END IF;
  SELECT count(*) INTO v_obs FROM public.waitlists WHERE id IN (v_wl_1, v_wl_2, v_wl_3, v_wl_4);
  IF v_obs <> 4 THEN RAISE EXCEPTION 'Fixture setup failed: waitlists count=%', v_obs; END IF;

  -- ---------------------------------------------------------------------------
  -- STEP 2: Execute all 28 live PostgreSQL RLS verification checks
  -- ---------------------------------------------------------------------------
  FOR v_case IN
    SELECT *
    FROM (
      VALUES
        -- Active student
        (1,  'active_student', v_active_student, 'boarding_records (own allowed)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L) AND student_id = %L', v_journey_a, v_journey_b, v_active_student), 2),
        (2,  'active_student', v_active_student, 'boarding_records (other denied)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L) AND student_id = %L', v_journey_a, v_journey_b, v_inactive_stud), 0),
        (3,  'active_student', v_active_student, 'waitlists (own allowed)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L) AND student_id = %L', v_journey_a, v_journey_b, v_active_student), 2),
        (4,  'active_student', v_active_student, 'waitlists (other denied)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L) AND student_id = %L', v_journey_a, v_journey_b, v_inactive_stud), 0),

        -- Inactive student (migration 00024 primary regression check + profiles exception)
        (5,  'inactive_student', v_inactive_stud, 'boarding_records (own denied)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 0),
        (6,  'inactive_student', v_inactive_stud, 'waitlists (own denied)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 0),
        (7,  'inactive_student', v_inactive_stud, 'profiles (own exception readable)',
             format('SELECT count(*)::int FROM public.profiles WHERE id = %L AND is_active = FALSE', v_inactive_stud), 1),
        (8,  'inactive_student', v_inactive_stud, 'profiles (other student denied)',
             format('SELECT count(*)::int FROM public.profiles WHERE id = %L', v_active_student), 0),

        -- Active admins (super_admin, bus_manager, hostel_manager)
        (9,  'active_super_admin', v_super_admin, 'boarding_records (all fixture)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 4),
        (10, 'active_super_admin', v_super_admin, 'waitlists (all fixture)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 4),
        (11, 'active_bus_manager', v_bus_manager, 'boarding_records (all fixture)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 4),
        (12, 'active_bus_manager', v_bus_manager, 'waitlists (all fixture)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 4),
        (13, 'active_hostel_manager', v_hostel_manager, 'boarding_records (all fixture)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 4),
        (14, 'active_hostel_manager', v_hostel_manager, 'waitlists (all fixture)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 4),

        -- Active boarding officer (Group A allowed, Group B denied)
        (15, 'active_boarding_officer', v_boarding_off, 'boarding_records (Group A allowed)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id = %L', v_journey_a), 2),
        (16, 'active_boarding_officer', v_boarding_off, 'boarding_records (Group B denied)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id = %L', v_journey_b), 0),
        (17, 'active_boarding_officer', v_boarding_off, 'waitlists (Group A allowed)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id = %L', v_journey_a), 2),
        (18, 'active_boarding_officer', v_boarding_off, 'waitlists (Group B denied)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id = %L', v_journey_b), 0),

        -- Active driver (assigned Journey A allowed, unassigned Journey B denied)
        (19, 'active_driver', v_active_driver, 'boarding_records (assigned Journey A allowed)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id = %L', v_journey_a), 2),
        (20, 'active_driver', v_active_driver, 'boarding_records (unassigned Journey B denied)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id = %L', v_journey_b), 0),
        (21, 'active_driver', v_active_driver, 'waitlists (assigned Journey A allowed)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id = %L', v_journey_a), 2),
        (22, 'active_driver', v_active_driver, 'waitlists (unassigned Journey B denied)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id = %L', v_journey_b), 0),

        -- Inactive staff (boarding_officer & admin)
        (23, 'inactive_boarding_officer', v_inactive_bo, 'boarding_records (denied)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 0),
        (24, 'inactive_boarding_officer', v_inactive_bo, 'waitlists (denied)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 0),
        (25, 'inactive_boarding_officer', v_inactive_bo, 'profiles (own exception readable)',
             format('SELECT count(*)::int FROM public.profiles WHERE id = %L AND is_active = FALSE', v_inactive_bo), 1),
        (26, 'inactive_admin', v_inactive_admin, 'boarding_records (denied)',
             format('SELECT count(*)::int FROM public.boarding_records WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 0),
        (27, 'inactive_admin', v_inactive_admin, 'waitlists (denied)',
             format('SELECT count(*)::int FROM public.waitlists WHERE journey_id IN (%L, %L)', v_journey_a, v_journey_b), 0),
        (28, 'inactive_admin', v_inactive_admin, 'profiles (own exception readable)',
             format('SELECT count(*)::int FROM public.profiles WHERE id = %L AND is_active = FALSE', v_inactive_admin), 1)
    ) AS t(check_no, actor, actor_uid, target, query_sql, expected_count)
    ORDER BY check_no
  LOOP
    -- Impersonate authenticated actor
    SET LOCAL ROLE authenticated;
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', v_case.actor_uid::text, 'role', 'authenticated')::text,
      true
    );
    PERFORM set_config('request.jwt.claim.sub', v_case.actor_uid::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    EXECUTE 'SELECT current_user::text, auth.uid()' INTO v_eff_user, v_eff_uid;
    IF v_eff_user <> 'authenticated' OR v_eff_uid IS DISTINCT FROM v_case.actor_uid THEN
      RESET ROLE;
      RAISE EXCEPTION 'Impersonation self-check failed on #% [%]: current_user=%, auth.uid()=%, expected=%',
        v_case.check_no, v_case.actor, v_eff_user, v_eff_uid, v_case.actor_uid;
    END IF;

    EXECUTE v_case.query_sql INTO v_obs;
    RESET ROLE;

    INSERT INTO pg_temp.verify_00024_results (check_no, actor, target, expected_count, observed_count, status)
    VALUES (
      v_case.check_no,
      v_case.actor,
      v_case.target,
      v_case.expected_count,
      v_obs,
      CASE WHEN v_obs = v_case.expected_count THEN 'PASS' ELSE 'FAIL' END
    );

    IF v_obs <> v_case.expected_count THEN
      RAISE EXCEPTION 'RLS CHECK #% FAILED [% | %]: expected %, observed %',
        v_case.check_no, v_case.actor, v_case.target, v_case.expected_count, v_obs;
    END IF;

    v_total_checks := v_total_checks + 1;
    RAISE NOTICE '[PASS #%] % -> % (expected=%, observed=%)',
      v_case.check_no, v_case.actor, v_case.target, v_case.expected_count, v_obs;
  END LOOP;

  RAISE NOTICE 'ALL % LIVE RLS CHECKS PASSED. Rolling back all isolated fixtures now.', v_total_checks;
END $$;

SELECT check_no, actor, target, expected_count, observed_count, status
FROM pg_temp.verify_00024_results
ORDER BY check_no;

ROLLBACK;
