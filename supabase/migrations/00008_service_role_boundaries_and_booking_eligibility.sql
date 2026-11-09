-- CosmoRide Migration 00008: Service-Role Trust Boundaries, Least Privilege RPC Grants & Student Booking Eligibility Hardening
-- Cosmopolitan University, Nigeria
--
-- Enforces:
-- 1. Service-role trust boundary enforcement:
--    - Revoke service_role execution from all user-initiated RPCs (bookings, boarding, physical driver checks, manual administrative desks)
--    - Retain service_role execution strictly for automated system-initiated batch tasks (admin_generate_journeys_from_schedules)
--    - Fix parameter type alignment on record_journey_stop_update
-- 2. Hardened Student Booking Eligibility (book_journey_seat):
--    - Require authenticated student session (rejects service_role, anon, unauthenticated)
--    - Student account eligibility verification (must exist, must be active, must possess 'student' role)
--    - Independent Route & Stop validation (route must be active; boarding stop must belong to route_stops)
--    - Gender corridor separation (enforce male/female routes match verified student gender / hostel gender)
--    - Transport group corridor isolation (enforce restricted transport_group_id routes match student's assigned group / hostel group)
--    - One active booking per student per journey (prevent duplicate confirmed/checked_in seats)
--    - Re-booking resilience for previously cancelled tickets without violating unique constraints
--    - Safe approved vehicle capacity ceiling (LEAST(safe_capacity, proposed_allocation)) with atomic row locking
--    - Idempotent and FIFO waiting list assignment when bus is at capacity
-- 3. Hardened Auto-Promotion and Cancellation (cancel_booking_and_promote):
--    - Require authenticated student session
--    - Handle existing historical cancelled booking records safely during waitlist promotion
-- 4. Headless Cron Attribution Hardening (admin_generate_journeys_from_schedules):
--    - Enforce verified, active administrator actor profile attribution when run under service_role
--    - Explicit audit log recording distinguishing interactive admin session vs service_role system cron
-- 5. Resilient Active Booking Index:
--    - Replace table-wide unique constraint with stateful partial unique index on active bookings

-- ============================================================
-- 1. RESILIENT ACTIVE BOOKING CONSTRAINT
-- ============================================================

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_journey_id_student_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_unique_idx
  ON public.bookings (journey_id, student_id)
  WHERE status IN ('confirmed', 'checked_in');

-- ============================================================
-- 2. HARDENED STUDENT BOOKING ELIGIBILITY PROCEDURE
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
  v_booking_cutoff_mins INTEGER := 15;
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

  -- Departure cutoff check (15 minutes prior to scheduled departure)
  IF v_journey.scheduled_departure <= (now() + (v_booking_cutoff_mins || ' minutes')::interval) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BOOKING_WINDOW_CLOSED',
      'error', 'Bookings closed: Scheduled departure is in less than ' || v_booking_cutoff_mins || ' minutes.'
    );
  END IF;

  -- D. Verify Boarding Stop Belongs to This Route
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

  -- E. Independent Corridor & Gender Separation Enforcement
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

  -- F. Independent Transport Group Corridor Enforcement
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

  -- G. Prevent Duplicate Active Booking
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

  -- H. Calculate Safe Approved Capacity Limit
  v_effective_capacity := LEAST(v_journey.safe_capacity, v_journey.proposed_allocation);

  SELECT COUNT(*) INTO v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status = 'confirmed';

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
-- 3. HARDENED CANCEL AND PROMOTE PROCEDURE
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_booking_and_promote(
  p_booking_id UUID,
  p_student_id UUID,
  p_reason TEXT DEFAULT 'Cancelled by student'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_jwt_role TEXT;
  v_booking RECORD;
  v_journey RECORD;
  v_top_waitlist RECORD;
  v_new_booking_id UUID;
  v_new_ticket_token TEXT;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Booking cancellation requires an authenticated student session.'
    );
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
  END IF;

  IF p_student_id IS NOT NULL AND p_student_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Authenticated user cannot cancel another student booking.');
  END IF;
  v_caller_id := auth.uid();

  -- 1. Lock and find booking belonging to caller
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.student_id = v_caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking record not found or does not belong to you.');
  END IF;

  IF v_booking.status != 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking cannot be cancelled (Current status: ' || v_booking.status || ').');
  END IF;

  -- 2. Lock journey
  SELECT * INTO v_journey
  FROM public.journeys
  WHERE id = v_booking.journey_id
  FOR UPDATE;

  IF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel a trip that is already in transit or completed.');
  END IF;

  -- 3. Cancel the booking
  UPDATE public.bookings
  SET status = 'cancelled',
      cancelled_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'BOOKING_CANCELLED',
    'booking',
    p_booking_id,
    jsonb_build_object('reason', p_reason, 'journey_id', v_booking.journey_id)
  );

  -- 4. Check waiting list for auto-promotion
  SELECT w.* INTO v_top_waitlist
  FROM public.waitlists w
  WHERE w.journey_id = v_booking.journey_id
    AND w.status = 'waiting'
  ORDER BY w.position ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_new_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    -- Check if an inactive booking record already exists for the promoted student
    SELECT id INTO v_new_booking_id
    FROM public.bookings
    WHERE journey_id = v_booking.journey_id
      AND student_id = v_top_waitlist.student_id;

    IF FOUND THEN
      UPDATE public.bookings
      SET status = 'confirmed',
          boarding_stop_id = v_top_waitlist.boarding_stop_id,
          ticket_token = v_new_ticket_token,
          boarding_pass_issued_at = now(),
          booked_at = now(),
          cancelled_at = NULL,
          checked_in_at = NULL,
          checked_in_by = NULL
      WHERE id = v_new_booking_id;
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
        v_booking.journey_id,
        v_top_waitlist.student_id,
        v_top_waitlist.boarding_stop_id,
        'confirmed',
        v_new_ticket_token,
        now(),
        now()
      )
      RETURNING id INTO v_new_booking_id;
    END IF;

    UPDATE public.waitlists
    SET status = 'promoted',
        promoted_at = now()
    WHERE id = v_top_waitlist.id;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_top_waitlist.student_id,
      'Waitlist Promoted: Seat Confirmed!',
      'A seat has opened up on your departure! Your boarding pass is now active.',
      'waitlist_promoted',
      v_booking.journey_id
    );

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_top_waitlist.student_id,
      'WAITLIST_PROMOTED_TO_BOOKING',
      'booking',
      v_new_booking_id,
      jsonb_build_object(
        'journey_id', v_booking.journey_id,
        'previous_waitlist_id', v_top_waitlist.id,
        'promoted_reason', 'Seat opened up via student cancellation'
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Booking cancelled successfully. Top waitlist passenger was auto-promoted.',
      'promoted_student_id', v_top_waitlist.student_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Booking cancelled successfully.'
  );
END;
$$;

-- ============================================================
-- 4. HARDENED HEADLESS CRON JOURNEY GENERATION PROCEDURE
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
  v_effective_admin_id UUID;
  v_jwt_role TEXT;
  v_admin RECORD;
  v_dow INTEGER;
  v_sched RECORD;
  v_vehicle RECORD;
  v_driver RECORD;
  v_created_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_effective_alloc INTEGER;
  v_exec_context TEXT;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Invalid or untrusted execution context.'
    );
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    -- Identity anti-spoofing: administrator cannot impersonate another admin
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.');
    END IF;
    v_effective_admin_id := auth.uid();
    v_exec_context := 'interactive_admin_session';
  ELSE
    -- Legitimate system-initiated cron execution via service_role
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit admin actor attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
    v_exec_context := 'service_role_system_cron';
  END IF;

  -- Validate that the attributed profile exists, possesses admin role, and is active
  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = v_effective_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED_ADMIN_ACTOR', 'error', 'Permission denied: Caller must possess administrator role.');
  END IF;

  IF NOT v_admin.is_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'INACTIVE_ADMIN_ACTOR', 'error', 'Permission denied: Administrator account is inactive.');
  END IF;

  v_dow := EXTRACT(DOW FROM p_target_date);

  FOR v_sched IN
    SELECT s.*, r.name AS route_name, r.is_active AS route_active
    FROM public.schedules s
    JOIN public.routes r ON r.id = s.route_id
    WHERE s.day_of_week = v_dow
      AND s.is_active = TRUE
      AND r.is_active = TRUE
      AND (p_route_id IS NULL OR s.route_id = p_route_id)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.journeys
      WHERE schedule_id = v_sched.id
        AND journey_date = p_target_date
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

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

    v_effective_alloc := LEAST(v_vehicle.safe_capacity, v_sched.proposed_allocation);

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
      (p_target_date || ' ' || v_sched.departure_time)::TIMESTAMPTZ,
      v_effective_alloc,
      'scheduled',
      v_effective_admin_id
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    'JOURNEYS_GENERATED_FROM_SCHEDULE',
    'journey_batch',
    NULL,
    jsonb_build_object(
      'target_date', p_target_date,
      'created_count', v_created_count,
      'skipped_count', v_skipped_count,
      'execution_context', v_exec_context,
      'attributed_admin_id', v_effective_admin_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Generated ' || v_created_count || ' journeys (' || v_skipped_count || ' skipped).',
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

-- ============================================================
-- 5. SERVICE-ROLE TRUST BOUNDARY & RPC PERMISSION MATRIX
-- ============================================================

-- A. Revoke service_role from all user-initiated RPCs
REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.record_vehicle_readiness(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, BOOLEAN, TEXT, BOOLEAN) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.record_journey_departure_safe(UUID, UUID, BOOLEAN, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.record_journey_arrival_safe(UUID, UUID, BOOLEAN, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_update_incident_status(UUID, UUID, public.incident_status, TEXT) FROM service_role;

-- Revoke service_role from record_journey_stop_update (both signature variants)
REVOKE ALL ON FUNCTION public.record_journey_stop_update FROM service_role;

-- B. Correct parameter typing alignment for authenticated execution
GRANT EXECUTE ON FUNCTION public.record_journey_stop_update(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- C. Retain service_role ONLY for legitimate background/cron journey batch generation
GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO service_role;
