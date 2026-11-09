-- CosmoRide Migration 00006: Security Hardening, Caller Spoofing Defense & RLS Integrity
-- Cosmopolitan University Bus Booking and Mobility Platform
--
-- This migration hardens the security architecture by:
-- 1. Adding missing RLS INSERT policy on public.audit_logs
-- 2. Hardening all SECURITY DEFINER RPCs against caller identity spoofing (verifying auth.uid())
-- 3. Expanding staff profile visibility for passenger manifest and check-in integrity
-- 4. Linking driver journey booking visibility to both driver_id and driver_record_id
-- 5. Revoking unauthenticated anon execution on sensitive operational procedures

-- ============================================================
-- 1. AUDIT LOGS RLS POLICIES
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users and staff can insert audit logs" ON public.audit_logs;

CREATE POLICY "Authenticated users and staff can insert audit logs"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'boarding_officer', 'driver')
    )
  );

-- ============================================================
-- 2. STAFF PROFILE VISIBILITY FOR MANIFEST & CHECK-IN
-- ============================================================

DROP POLICY IF EXISTS "Staff can view passenger profiles" ON public.profiles;

CREATE POLICY "Staff can view passenger profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role IN ('admin', 'boarding_officer', 'driver')
    )
  );

-- ============================================================
-- 3. DRIVER JOURNEY BOOKINGS VISIBILITY
-- ============================================================

DROP POLICY IF EXISTS "Drivers can view their journey bookings" ON public.bookings;

CREATE POLICY "Drivers can view their journey bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journeys j
      LEFT JOIN public.drivers d ON d.id = j.driver_record_id
      WHERE j.id = bookings.journey_id
        AND (
          j.driver_id = (SELECT auth.uid())
          OR d.profile_id = (SELECT auth.uid())
        )
    )
  );

-- ============================================================
-- 4. HARDENED SECURITY DEFINER PROCEDURES (CALLER SPOOFING DEFENSE)
-- ============================================================

-- A. book_journey_seat
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
  v_journey RECORD;
  v_effective_capacity INTEGER;
  v_active_bookings_count INTEGER;
  v_booking_id UUID;
  v_ticket_token TEXT;
  v_waitlist_pos INTEGER;
  v_booking_cutoff_mins INTEGER := 15;
BEGIN
  -- Anti-spoofing check: If auth.uid() is set, caller must be the student or an admin/officer
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_student_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'boarding_officer')
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Cannot reserve seat on behalf of another student.');
    END IF;
  END IF;

  -- 1. Lock the journey row FOR UPDATE to serialize concurrent booking attempts
  SELECT j.*, v.safe_capacity, v.is_active AS vehicle_active
  INTO v_journey
  FROM public.journeys j
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found or vehicle unassigned.');
  END IF;

  IF NOT v_journey.vehicle_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Assigned vehicle is inactive.');
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'boarding') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is not open for bookings (Status: ' || v_journey.status || ').');
  END IF;

  -- Check if journey departure is within cutoff
  IF v_journey.scheduled_departure <= (now() + (v_booking_cutoff_mins || ' minutes')::interval) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bookings closed: Departure is in less than ' || v_booking_cutoff_mins || ' minutes.');
  END IF;

  -- 2. Prevent duplicate booking for the same student on the same journey
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = p_student_id
      AND status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a confirmed seat on this departure.');
  END IF;

  -- 3. Determine effective capacity: LEAST(safe_capacity, proposed_allocation)
  v_effective_capacity := LEAST(v_journey.safe_capacity, v_journey.proposed_allocation);

  -- 4. Count currently confirmed bookings with exclusive table lock check
  SELECT COUNT(*) INTO v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status = 'confirmed';

  -- 5. CAPACITY CHECK: If space is available, confirm seat immediately
  IF v_active_bookings_count < v_effective_capacity THEN
    v_ticket_token := encode(gen_random_bytes(24), 'hex');

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
      p_student_id,
      p_boarding_stop_id,
      'confirmed',
      v_ticket_token,
      now(),
      now()
    )
    RETURNING id INTO v_booking_id;

    -- Clean up any prior waiting list entry for this student on this journey
    UPDATE public.waitlists
    SET status = 'promoted', promoted_at = now()
    WHERE journey_id = p_journey_id
      AND student_id = p_student_id
      AND status = 'waiting';

    -- Create in-app notification
    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      p_student_id,
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
    -- 6. CAPACITY EXCEEDED: Join Waiting List atomically
    IF EXISTS (
      SELECT 1 FROM public.waitlists
      WHERE journey_id = p_journey_id
        AND student_id = p_student_id
        AND status = 'waiting'
    ) THEN
      SELECT position INTO v_waitlist_pos
      FROM public.waitlists
      WHERE journey_id = p_journey_id
        AND student_id = p_student_id
        AND status = 'waiting';

      RETURN jsonb_build_object(
        'success', true,
        'status', 'waitlist',
        'waitlist_position', v_waitlist_pos,
        'message', 'Bus at safe capacity. You are currently #' || v_waitlist_pos || ' on the waiting list.'
      );
    END IF;

    -- Calculate next waiting position atomically
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
      p_student_id,
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

-- B. cancel_booking_and_promote
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
  v_booking RECORD;
  v_journey RECORD;
  v_top_waitlist RECORD;
  v_new_booking_id UUID;
  v_new_ticket_token TEXT;
BEGIN
  -- Anti-spoofing check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_student_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Cannot cancel another student booking.');
    END IF;
  END IF;

  -- 1. Lock and find the booking
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.student_id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking record not found or already cancelled.');
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
      updated_at = now()
  WHERE id = p_booking_id;

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_student_id,
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
    v_new_ticket_token := encode(gen_random_bytes(24), 'hex');

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

    UPDATE public.waitlists
    SET status = 'promoted',
        promoted_at = now()
    WHERE id = v_top_waitlist.id;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_top_waitlist.student_id,
      'Seat Available — You Were Promoted!',
      'A seat opened up on your requested departure. Your booking is confirmed and boarding pass is ready.',
      'waitlist_promoted',
      v_booking.journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Booking cancelled. Seat automatically reallocated to waiting list passenger.',
      'promoted_student_id', v_top_waitlist.student_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Booking cancelled successfully.'
  );
END;
$$;

-- C. verify_and_board_passenger
CREATE OR REPLACE FUNCTION public.verify_and_board_passenger(
  p_ticket_token TEXT,
  p_officer_id UUID,
  p_journey_id UUID,
  p_boarding_method public.boarding_method DEFAULT 'qr_scan',
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking RECORD;
  v_journey RECORD;
  v_officer RECORD;
  v_student RECORD;
  v_effective_capacity INTEGER;
  v_boarded_count INTEGER;
  v_previous_scan RECORD;
BEGIN
  -- Anti-spoofing check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_officer_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNAUTHORIZED',
        'error', 'Permission denied: Caller identity mismatch.'
      );
    END IF;
  END IF;

  -- 1. Verify officer credentials and role
  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = p_officer_id;

  IF NOT FOUND OR v_officer.role NOT IN ('boarding_officer', 'admin', 'driver') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Caller is not an authorised boarding officer.'
    );
  END IF;

  -- 2. Lock journey and fetch route & vehicle info
  SELECT j.*, v.safe_capacity, v.registration_number, v.name AS vehicle_name, r.transport_group_id, r.code AS route_code, r.name AS route_name
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
      'error', 'Target journey not found or unassigned.'
    );
  END IF;

  -- 3. Strict Transport Group Access Restriction:
  IF v_officer.role = 'boarding_officer' AND v_officer.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Cross-Group Restriction: You are not authorised to board passengers for this transport corridor.'
      );
    END IF;
  END IF;

  -- Verify journey status
  IF v_journey.status NOT IN ('scheduled', 'boarding') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_CLOSED',
      'error', 'Boarding is closed for this journey (Current status: ' || v_journey.status || ').'
    );
  END IF;

  -- 4. Find and lock booking by ticket_token
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.ticket_token = p_ticket_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TICKET',
      'error', 'Invalid Boarding Pass: Security token not recognised by university transit system.'
    );
  END IF;

  -- Fetch student profile for display
  SELECT full_name, student_id, phone INTO v_student
  FROM public.profiles
  WHERE id = v_booking.student_id;

  -- 5. DUPLICATE BOARDING CHECK
  IF v_booking.status = 'boarded' THEN
    SELECT br.scanned_at, br.boarding_method, p.full_name AS officer_name
    INTO v_previous_scan
    FROM public.boarding_records br
    JOIN public.profiles p ON p.id = br.scanned_by
    WHERE br.booking_id = v_booking.id
    ORDER BY br.scanned_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_BOARDED',
      'error', 'Security Alert: Boarding pass already used at ' || to_char(COALESCE(v_previous_scan.scanned_at, now()), 'HH24:MI:SS') || ' (Recorded by ' || COALESCE(v_previous_scan.officer_name, 'Staff') || ').',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 6. CANCELLED / VOID TICKET CHECK
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TICKET_CANCELLED',
      'error', 'Boarding Denied: This ticket reservation was cancelled.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 7. WRONG JOURNEY CHECK
  IF v_booking.journey_id <> p_journey_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WRONG_JOURNEY',
      'error', 'Wrong Bus / Route: This boarding pass is reserved for another scheduled journey.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 8. PHYSICAL CAPACITY OVERFLOW CHECK
  v_effective_capacity := LEAST(v_journey.safe_capacity, v_journey.proposed_allocation);

  SELECT COUNT(*) INTO v_boarded_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id;

  IF v_boarded_count >= v_effective_capacity THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BUS_FULL',
      'error', 'Boarding Gate Blocked: Bus safe physical capacity of ' || v_effective_capacity || ' passengers reached.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 9. VALIDATION PASSED: RECORD BOARDING
  INSERT INTO public.boarding_records (
    booking_id,
    journey_id,
    student_id,
    vehicle_id,
    scanned_by,
    scanned_at,
    boarding_method,
    exception_reason,
    is_verified,
    created_at
  )
  VALUES (
    v_booking.id,
    p_journey_id,
    v_booking.student_id,
    v_journey.vehicle_id,
    p_officer_id,
    now(),
    p_boarding_method,
    p_exception_reason,
    TRUE,
    now()
  );

  -- 10. Update booking status
  UPDATE public.bookings
  SET status = 'boarded',
      updated_at = now()
  WHERE id = v_booking.id;

  -- 11. If journey status was 'scheduled', advance it to 'boarding'
  IF v_journey.status = 'scheduled' THEN
    UPDATE public.journeys
    SET status = 'boarding',
        updated_at = now()
    WHERE id = p_journey_id;
  END IF;

  -- 12. Recalculate remaining seats
  v_boarded_count := v_boarded_count + 1;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BOARDED_SUCCESS',
    'message', 'Passenger cleared for boarding.',
    'passenger_name', v_student.full_name,
    'student_id', v_student.student_id,
    'boarded_count', v_boarded_count,
    'total_capacity', v_effective_capacity,
    'remaining_seats', (v_effective_capacity - v_boarded_count),
    'route_name', v_journey.route_name,
    'vehicle_plate', v_journey.registration_number
  );
END;
$$;

-- D. close_and_depart_journey
CREATE OR REPLACE FUNCTION public.close_and_depart_journey(
  p_journey_id UUID,
  p_officer_id UUID,
  p_closure_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey RECORD;
  v_officer RECORD;
  v_boarded_count INTEGER;
  v_noshow_updated INTEGER := 0;
  v_cancelled_count INTEGER := 0;
BEGIN
  -- Anti-spoofing check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_officer_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller identity mismatch.');
    END IF;
  END IF;

  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = p_officer_id;

  IF NOT FOUND OR v_officer.role NOT IN ('boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller is not authorised.');
  END IF;

  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  IF v_officer.role = 'boarding_officer' AND v_officer.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cross-Group Restriction: You cannot depart a journey outside your corridor.');
    END IF;
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'boarding') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is already ' || v_journey.status || '.');
  END IF;

  -- Update confirmed but unboarded bookings to cancelled (no-show)
  WITH updated_rows AS (
    UPDATE public.bookings
    SET status = 'cancelled', updated_at = now()
    WHERE journey_id = p_journey_id AND status = 'confirmed'
    RETURNING id
  )
  SELECT count(*) INTO v_noshow_updated FROM updated_rows;

  -- Expire remaining waitlist entries
  UPDATE public.waitlists
  SET status = 'expired'
  WHERE journey_id = p_journey_id AND status = 'waiting';

  SELECT count(*) INTO v_boarded_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id;

  -- Mark journey in_transit
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = now(),
      updated_at = now()
  WHERE id = p_journey_id;

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_officer_id,
    'JOURNEY_CLOSED_AND_DEPARTED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'boarded_count', v_boarded_count,
      'noshow_count', v_noshow_updated,
      'cancelled_count', v_cancelled_count,
      'notes', p_closure_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Journey gate closed and bus departed.',
    'boarded_count', v_boarded_count,
    'noshow_count', v_noshow_updated,
    'actual_departure', now()
  );
END;
$$;

-- E. admin_generate_journeys_from_schedules
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
  v_admin RECORD;
  v_dow INTEGER;
  v_sched RECORD;
  v_vehicle RECORD;
  v_driver RECORD;
  v_created_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_effective_alloc INTEGER;
BEGIN
  -- Anti-spoofing check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller identity does not match admin credentials.');
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller must be an administrator.');
  END IF;

  v_dow := EXTRACT(DOW FROM p_target_date);

  FOR v_sched IN
    SELECT s.*, r.transport_group_id
    FROM public.schedules s
    JOIN public.routes r ON r.id = s.route_id
    WHERE s.is_active = TRUE
      AND s.day_of_week = v_dow
      AND (p_route_id IS NULL OR s.route_id = p_route_id)
    ORDER BY s.departure_time ASC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.journeys
      WHERE schedule_id = v_sched.id AND journey_date = p_target_date
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE is_active = TRUE AND status IN ('available', 'assigned')
    ORDER BY id ASC
    LIMIT 1;

    SELECT * INTO v_driver
    FROM public.drivers
    WHERE status = 'active'
    ORDER BY id ASC
    LIMIT 1;

    IF v_vehicle.id IS NOT NULL THEN
      v_effective_alloc := LEAST(v_vehicle.safe_capacity, v_sched.proposed_allocation);
    ELSE
      v_effective_alloc := v_sched.proposed_allocation;
    END IF;

    INSERT INTO public.journeys (
      route_id,
      schedule_id,
      vehicle_id,
      driver_record_id,
      driver_id,
      journey_date,
      scheduled_departure,
      status,
      proposed_allocation,
      readiness_status,
      created_at,
      updated_at
    )
    VALUES (
      v_sched.route_id,
      v_sched.id,
      v_vehicle.id,
      v_driver.id,
      v_driver.profile_id,
      p_target_date,
      (p_target_date::text || ' ' || v_sched.departure_time::text)::timestamptz,
      'scheduled',
      v_effective_alloc,
      'pending',
      now(),
      now()
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, action, entity_type, details)
  VALUES (
    p_admin_id,
    'GENERATE_JOURNEYS',
    'schedule',
    jsonb_build_object(
      'target_date', p_target_date,
      'route_id', p_route_id,
      'created_count', v_created_count,
      'skipped_count', v_skipped_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'message', 'Generated ' || v_created_count || ' journeys for ' || p_target_date || ' (' || v_skipped_count || ' already existed).'
  );
END;
$$;

-- F. admin_cancel_journey
CREATE OR REPLACE FUNCTION public.admin_cancel_journey(
  p_admin_id UUID,
  p_journey_id UUID,
  p_cancellation_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin RECORD;
  v_journey RECORD;
  v_booking RECORD;
  v_cancelled_bookings INTEGER := 0;
BEGIN
  -- Anti-spoofing check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller identity mismatch.');
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Only administrators can cancel scheduled journeys.');
  END IF;

  SELECT j.*, r.name AS route_name, r.code AS route_code
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  IF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is already cancelled.');
  END IF;

  IF v_journey.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel a completed journey.');
  END IF;

  UPDATE public.journeys
  SET status = 'cancelled',
      delay_reason = p_cancellation_reason,
      updated_at = now()
  WHERE id = p_journey_id;

  FOR v_booking IN
    SELECT b.id, b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('confirmed', 'boarded')
  LOOP
    UPDATE public.bookings
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_booking.id;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_booking.student_id,
      'Trip Cancelled by Transport Office',
      'The scheduled departure for route ' || v_journey.route_name || ' (' || v_journey.route_code || ') has been cancelled. Reason: ' || p_cancellation_reason,
      'schedule_change',
      p_journey_id
    );

    v_cancelled_bookings := v_cancelled_bookings + 1;
  END LOOP;

  UPDATE public.waitlists
  SET status = 'cancelled'
  WHERE journey_id = p_journey_id AND status = 'waiting';

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_admin_id,
    'JOURNEY_CANCELLED_BY_ADMIN',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'reason', p_cancellation_reason,
      'affected_bookings_count', v_cancelled_bookings,
      'route_code', v_journey.route_code
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Journey cancelled successfully. ' || v_cancelled_bookings || ' passenger reservations voided.',
    'cancelled_bookings_count', v_cancelled_bookings
  );
END;
$$;

-- G. admin_update_system_setting
CREATE OR REPLACE FUNCTION public.admin_update_system_setting(
  p_admin_id UUID,
  p_key TEXT,
  p_value JSONB,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin RECORD;
  v_old_value JSONB;
BEGIN
  -- Anti-spoofing check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller identity mismatch.');
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Only administrators can update system settings.');
  END IF;

  SELECT value INTO v_old_value
  FROM public.system_settings
  WHERE key = p_key;

  INSERT INTO public.system_settings (key, value, description, updated_by, updated_at)
  VALUES (p_key, p_value, p_description, p_admin_id, now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, public.system_settings.description),
      updated_by = p_admin_id,
      updated_at = now();

  INSERT INTO public.audit_logs (user_id, action, entity_type, details)
  VALUES (
    p_admin_id,
    'SYSTEM_SETTING_UPDATED',
    'system_setting',
    jsonb_build_object(
      'key', p_key,
      'old_value', v_old_value,
      'new_value', p_value
    )
  );

  RETURN jsonb_build_object('success', true, 'message', 'Setting ' || p_key || ' updated successfully.');
END;
$$;

-- H. admin_update_incident_status
CREATE OR REPLACE FUNCTION public.admin_update_incident_status(
  p_admin_id UUID,
  p_incident_id UUID,
  p_status public.incident_status,
  p_resolution_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  -- Anti-spoofing check
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller identity mismatch.');
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Only administrators can update incidents.');
  END IF;

  UPDATE public.incident_reports
  SET status = p_status,
      resolution_notes = p_resolution_notes,
      resolved_by = p_admin_id,
      resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_incident_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_admin_id,
    'INCIDENT_STATUS_UPDATED',
    'incident_report',
    p_incident_id,
    jsonb_build_object(
      'status', p_status,
      'resolution_notes', p_resolution_notes
    )
  );

  RETURN jsonb_build_object('success', true, 'message', 'Incident updated to ' || p_status || '.');
END;
$$;

-- ============================================================
-- 5. REVOKE ANONYMOUS EXECUTION PERMISSIONS
-- ============================================================

-- Defense in depth: Ensure unauthenticated anon callers cannot invoke public RPCs
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
