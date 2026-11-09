-- CosmoRide Migration 00009: Honest System-Job Actor Attribution, Configurable Booking Policy & Safe Seat Counting
-- Cosmopolitan University, Nigeria
--
-- Enforces:
-- 1. Honest System-Job Actor Attribution (admin_generate_journeys_from_schedules):
--    - Distinguishes human administrator generation from automated scheduled background jobs.
--    - When run via authenticated admin session: attributes action to auth.uid() as human_administrator.
--    - When run via service_role cron: attributes action to NULL profile with actor_type = 'scheduled_system_job'
--      and action = 'SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE'. Zero impersonation of human administrators!
--    - Makes journeys.created_by nullable so system-generated journeys honestly record created_by = NULL.
--    - Anchors departure timestamp calculation to timezone 'Africa/Lagos' (WAT / UTC+1).
-- 2. Configurable Policy-Driven Booking Cutoff (book_journey_seat):
--    - Dynamically queries public.system_settings for key 'booking_cutoff_minutes' (default 15).
--    - Blocks bookings when scheduled departure <= now() + cutoff interval.
-- 3. Comprehensive Active Booking Count (book_journey_seat):
--    - Occupied seat count strictly counts status IN ('confirmed', 'checked_in') so boarding passes
--      already scanned into checked_in status do not artificially release capacity and cause overselling.

-- ============================================================
-- 1. MAKE JOURNEYS.CREATED_BY NULLABLE FOR SYSTEM GENERATION
-- ============================================================

ALTER TABLE public.journeys ALTER COLUMN created_by DROP NOT NULL;

-- ============================================================
-- 2. HARDENED ADMIN & SYSTEM JOURNEY GENERATION PROCEDURE
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_generate_journeys_from_schedules(
  p_admin_id UUID,
  p_target_date DATE,
  p_route_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_admin_id UUID := NULL;
  v_jwt_role TEXT;
  v_admin RECORD;
  v_dow INTEGER;
  v_sched RECORD;
  v_vehicle RECORD;
  v_driver RECORD;
  v_created_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_effective_alloc INTEGER;
  v_actor_type TEXT;
  v_exec_context TEXT;
  v_audit_action TEXT;
BEGIN
  -- 1. Extract and strictly validate JWT role
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Invalid or untrusted execution context.'
    );
  END IF;

  -- 2. Honest Attribution Contract
  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNAUTHORIZED',
        'error', 'Permission denied: Unauthenticated session.'
      );
    END IF;

    -- Anti-spoofing: Authenticated admin cannot submit another admin's identity
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'IDENTITY_MISMATCH',
        'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.'
      );
    END IF;

    v_effective_admin_id := auth.uid();
    v_actor_type := 'human_administrator';
    v_exec_context := 'interactive_admin_session';
    v_audit_action := 'ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE';

    -- Validate that caller possesses an active administrator profile
    SELECT * INTO v_admin
    FROM public.profiles
    WHERE id = v_effective_admin_id;

    IF NOT FOUND OR v_admin.role != 'admin' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNAUTHORIZED_ADMIN_ACTOR',
        'error', 'Permission denied: Caller must possess administrator role.'
      );
    END IF;

    IF NOT v_admin.is_active THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INACTIVE_ADMIN_ACTOR',
        'error', 'Permission denied: Administrator account is inactive.'
      );
    END IF;
  ELSE
    -- Legitimate system cron execution via service_role
    -- Explicitly zero human impersonation: system jobs are NEVER credited to a human admin
    v_effective_admin_id := NULL;
    v_actor_type := 'scheduled_system_job';
    v_exec_context := 'service_role_system_cron';
    v_audit_action := 'SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE';
  END IF;

  v_dow := EXTRACT(DOW FROM p_target_date);

  -- 3. Iterate through active schedule templates for this day of week
  FOR v_sched IN
    SELECT s.*, r.name AS route_name, r.is_active AS route_active
    FROM public.schedules s
    JOIN public.routes r ON r.id = s.route_id
    WHERE s.day_of_week = v_dow
      AND s.is_active = TRUE
      AND r.is_active = TRUE
      AND (p_route_id IS NULL OR s.route_id = p_route_id)
  LOOP
    -- Prevent duplicate journey instance on the same schedule and date
    IF EXISTS (
      SELECT 1 FROM public.journeys
      WHERE schedule_id = v_sched.id
        AND journey_date = p_target_date
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Pick available fleet vehicle
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE is_active = TRUE
      AND status = 'available'
    ORDER BY created_at ASC
    LIMIT 1;

    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Pick available driver
    SELECT * INTO v_driver
    FROM public.profiles
    WHERE role = 'driver'
      AND is_active = TRUE
    ORDER BY created_at ASC
    LIMIT 1;

    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Safe capacity is the lower of safe vehicle seats and proposed schedule allocation
    v_effective_alloc := LEAST(v_vehicle.safe_capacity, v_sched.proposed_allocation);

    -- Anchor scheduled departure explicitly to Nigeria timezone (Africa/Lagos, UTC+1)
    INSERT INTO public.journeys (
      schedule_id,
      route_id,
      vehicle_id,
      driver_id,
      journey_date,
      scheduled_departure,
      proposed_allocation,
      status,
      created_by
    )
    VALUES (
      v_sched.id,
      v_sched.route_id,
      v_vehicle.id,
      v_driver.id,
      p_target_date,
      timezone('Africa/Lagos', (p_target_date || ' ' || v_sched.departure_time)::timestamp),
      v_effective_alloc,
      'scheduled',
      v_effective_admin_id -- NULL for system-generated; real admin UUID for manual generation
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  -- 4. Honest Audit Log Recording
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id, -- NULL for system cron; admin UUID for human admin
    v_audit_action,
    'journey_batch',
    NULL,
    jsonb_build_object(
      'target_date', p_target_date,
      'created_count', v_created_count,
      'skipped_count', v_skipped_count,
      'actor_type', v_actor_type,
      'execution_context', v_exec_context,
      'route_id', p_route_id,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Generated ' || v_created_count || ' journeys (' || v_skipped_count || ' skipped).',
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'actor_type', v_actor_type,
    'action', v_audit_action
  );
END;
$$;

-- ============================================================
-- 3. UPGRADED BOOKING ELIGIBILITY WITH DYNAMIC CUTOFF & OCCUPANCY
-- ============================================================

CREATE OR REPLACE FUNCTION public.book_journey_seat(
  p_journey_id UUID,
  p_student_id UUID,
  p_boarding_stop_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_jwt_role TEXT;
  v_student RECORD;
  v_journey RECORD;
  v_effective_capacity INTEGER;
  v_active_bookings_count INTEGER;
  v_booking_id UUID;
  v_ticket_token TEXT;
  v_waitlist_pos INTEGER;
  v_booking_cutoff_mins INTEGER;
  v_effective_student_gender public.gender;
  v_effective_student_group UUID;
BEGIN
  -- A. Extract and strictly validate JWT role
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Seat booking requires an authenticated student session.'
    );
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Unauthenticated session.'
    );
  END IF;

  -- Anti-spoofing: caller cannot book on behalf of another student. Zero exceptions.
  IF p_student_id IS NOT NULL AND p_student_id <> auth.uid() THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'IDENTITY_MISMATCH',
      'error', 'Identity mismatch: Authenticated user cannot reserve a seat on behalf of another student.'
    );
  END IF;
  v_caller_id := auth.uid();

  -- B. Validate Student Account Eligibility
  SELECT p.id, p.full_name, p.role, p.is_active, p.gender, p.hostel_id, p.assigned_transport_group_id,
         h.gender AS hostel_gender, h.transport_group_id AS hostel_transport_group_id, h.name AS hostel_name
  INTO v_student
  FROM public.profiles p
  LEFT JOIN public.hostels h ON h.id = p.hostel_id
  WHERE p.id = v_caller_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'STUDENT_NOT_FOUND',
      'error', 'Student profile record not found in university directory.'
    );
  END IF;

  IF NOT v_student.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ACCOUNT_INACTIVE',
      'error', 'Student account is suspended or inactive. Please contact transport administration.'
    );
  END IF;

  IF v_student.role <> 'student' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ROLE_NOT_STUDENT',
      'error', 'Permission denied: Only registered students are eligible to book passenger seats.'
    );
  END IF;

  -- C. Lock Journey row FOR UPDATE and fetch vehicle and route constraints
  SELECT j.*,
         v.safe_capacity, v.is_active AS vehicle_active, v.registration_number,
         r.id AS route_id, r.name AS route_name, r.gender_group AS route_gender,
         r.transport_group_id AS route_transport_group_id, r.is_active AS route_active
  INTO v_journey
  FROM public.journeys j
  JOIN public.vehicles v ON v.id = j.vehicle_id
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_NOT_FOUND',
      'error', 'Target journey not found or vehicle/route unassigned.'
    );
  END IF;

  IF NOT v_journey.vehicle_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'VEHICLE_INACTIVE',
      'error', 'Assigned fleet vehicle is currently inactive or under maintenance.'
    );
  END IF;

  IF NOT v_journey.route_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ROUTE_INACTIVE',
      'error', 'Transit route for this journey is currently inactive.'
    );
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'boarding') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_NOT_BOOKABLE',
      'error', 'Journey is not open for bookings (Current status: ' || v_journey.status || ').'
    );
  END IF;

  -- D. Dynamic Configurable Booking Cutoff Policy (from system_settings)
  SELECT COALESCE((value #>> '{}')::INTEGER, 15)
  INTO v_booking_cutoff_mins
  FROM public.system_settings
  WHERE key = 'booking_cutoff_minutes';

  IF v_booking_cutoff_mins IS NULL THEN
    v_booking_cutoff_mins := 15;
  END IF;

  -- Departure cutoff check (evaluated against Nigeria time / UTC timestamps)
  IF v_journey.scheduled_departure <= (now() + (v_booking_cutoff_mins || ' minutes')::interval) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BOOKING_WINDOW_CLOSED',
      'error', 'Bookings closed: Scheduled departure is in less than ' || v_booking_cutoff_mins || ' minutes.'
    );
  END IF;

  -- E. Verify Boarding Stop Belongs to This Route
  IF NOT EXISTS (
    SELECT 1 FROM public.route_stops
    WHERE route_id = v_journey.route_id
      AND stop_id = p_boarding_stop_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_BOARDING_STOP',
      'error', 'Selected pickup stop does not belong to this journey route.'
    );
  END IF;

  -- F. Independent Corridor & Gender Separation Enforcement
  v_effective_student_gender := COALESCE(v_student.gender, v_student.hostel_gender);

  IF v_journey.route_gender IN ('male', 'female') THEN
    IF v_effective_student_gender IS NOT NULL AND v_effective_student_gender <> v_journey.route_gender THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_CORRIDOR_DENIED',
        'error', 'Corridor restriction: This departure is designated exclusively for ' || v_journey.route_gender || ' students.'
      );
    END IF;
    IF v_effective_student_gender IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNVERIFIED_CORRIDOR_PROFILE',
        'error', 'Corridor restriction: Student profile has no verified gender or hostel assignment for this gender-restricted route.'
      );
    END IF;
  END IF;

  -- G. Independent Transport Group Corridor Enforcement
  v_effective_student_group := COALESCE(v_student.assigned_transport_group_id, v_student.hostel_transport_group_id);

  IF v_journey.route_transport_group_id IS NOT NULL THEN
    IF v_effective_student_group IS NULL OR v_effective_student_group <> v_journey.route_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Transport group restriction: You are not assigned to this transport corridor.'
      );
    END IF;
  END IF;

  -- H. Prevent Duplicate Active Booking
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_BOOKING',
      'error', 'You already have an active seat or boarding pass for this departure.'
    );
  END IF;

  -- I. Calculate Safe Approved Capacity Limit
  -- Strictly count BOTH 'confirmed' (reserved seat) AND 'checked_in' (boarded passenger)
  v_effective_capacity := LEAST(v_journey.safe_capacity, v_journey.proposed_allocation);

  SELECT COUNT(*) INTO v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in');

  IF v_active_bookings_count < v_effective_capacity THEN
    -- Issue confirmed seat
    v_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    -- Re-activate historical record or insert fresh row
    SELECT id INTO v_booking_id
    FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id;

    IF FOUND THEN
      UPDATE public.bookings
      SET status = 'confirmed',
          boarding_stop_id = p_boarding_stop_id,
          ticket_token = v_ticket_token,
          boarding_pass_issued_at = now(),
          booked_at = now(),
          cancelled_at = NULL,
          checked_in_at = NULL,
          checked_in_by = NULL
      WHERE id = v_booking_id;
    ELSE
      INSERT INTO public.bookings (
        journey_id,
        student_id,
        boarding_stop_id,
        status,
        ticket_token,
        boarding_pass_issued_at,
        created_at
      )
      VALUES (
        p_journey_id,
        v_caller_id,
        p_boarding_stop_id,
        'confirmed',
        v_ticket_token,
        now(),
        now()
      )
      RETURNING id INTO v_booking_id;
    END IF;

    -- Clean up any waiting list entry for this student on this journey
    UPDATE public.waitlists
    SET status = 'promoted', promoted_at = now()
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status = 'waiting';

    -- Issue notification
    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_caller_id,
      'Booking Confirmed',
      'Your seat is reserved for departure at ' || to_char(v_journey.scheduled_departure, 'HH24:MI') || '. Boarding pass ready.',
      'booking_confirmed',
      p_journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'confirmed',
      'booking_id', v_booking_id,
      'ticket_token', v_ticket_token,
      'message', 'Seat confirmed successfully. Boarding pass issued.'
    );
  ELSE
    -- Safe Capacity Reached: Process Waiting List
    IF EXISTS (
      SELECT 1 FROM public.waitlists
      WHERE journey_id = p_journey_id
        AND student_id = v_caller_id
        AND status = 'waiting'
    ) THEN
      SELECT position INTO v_waitlist_pos
      FROM public.waitlists
      WHERE journey_id = p_journey_id
        AND student_id = v_caller_id
        AND status = 'waiting';

      RETURN jsonb_build_object(
        'success', true,
        'status', 'waitlist',
        'waitlist_position', v_waitlist_pos,
        'message', 'Bus at safe capacity. You are currently #' || v_waitlist_pos || ' on the waiting list.'
      );
    END IF;

    SELECT COALESCE(MAX(position), 0) + 1 INTO v_waitlist_pos
    FROM public.waitlists
    WHERE journey_id = p_journey_id
      AND status = 'waiting';

    INSERT INTO public.waitlists (
      journey_id,
      student_id,
      boarding_stop_id,
      position,
      status,
      created_at
    )
    VALUES (
      p_journey_id,
      v_caller_id,
      p_boarding_stop_id,
      v_waitlist_pos,
      'waiting',
      now()
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlist',
      'waitlist_position', v_waitlist_pos,
      'message', 'Bus at maximum safe capacity (' || v_effective_capacity || ' seats). You have been placed at position #' || v_waitlist_pos || ' on the waiting list.'
    );
  END IF;
END;
$$;

-- ============================================================
-- 4. EXPLICIT GRANTS
-- ============================================================

GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;
