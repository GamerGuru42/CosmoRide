-- CosmoRide Migration 00007: Fail-Closed Corridor Isolation, Strict JWT Role Handling & Explicit Grants
-- Cosmopolitan University Bus Booking and Mobility Platform
--
-- Addresses:
-- 1. Boarding Officer Corridor Isolation (FAIL CLOSED):
--    - Boarding officers MUST have a non-null assigned_transport_group_id.
--    - NULL or mismatching transport group grants ZERO corridor access.
--    - Closes leaks across journeys, boarding_records, waitlists, and profiles.
-- 2. Strict JWT Execution Role Handling in all 13 RPCs:
--    - Explicitly recognizes 'authenticated' and 'service_role'.
--    - Rejects 'anon', NULL, empty, or unknown JWT roles immediately.
--    - Authenticated callers must act strictly under their own auth.uid().
--    - Zero administrator impersonation exceptions.
--    - Service-role calls require explicit, non-null actor attribution.
-- 3. Explicit Function-by-Function Grants:
--    - Removes any wildcard grants to authenticated and service_role.
--    - Revokes trigger functions from client roles.
--    - Explicit grants per workflow RPC.

-- ============================================================
-- 1. FAIL-CLOSED ROW LEVEL SECURITY POLICIES
-- ============================================================

-- ---- A. JOURNEYS TABLE ----
DROP POLICY IF EXISTS "Scoped journey access policy" ON public.journeys;

CREATE POLICY "Scoped journey access policy"
  ON public.journeys FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.routes r ON r.id = journeys.route_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          -- Admins can view all journeys
          p.role = 'admin'
          -- Students can view active departures for booking/departure board
          OR (p.role = 'student' AND journeys.status != 'cancelled')
          -- Drivers can view their assigned journeys
          OR (
            p.role = 'driver'
            AND (
              journeys.driver_id = (SELECT auth.uid())
              OR EXISTS (
                SELECT 1 FROM public.drivers d
                WHERE d.id = journeys.driver_record_id AND d.profile_id = (SELECT auth.uid())
              )
            )
          )
          -- Boarding officers: MUST have a NON-NULL assigned_transport_group_id matching route.
          -- NULL assignment grants ZERO access (FAIL CLOSED).
          OR (
            p.role = 'boarding_officer'
            AND p.assigned_transport_group_id IS NOT NULL
            AND r.transport_group_id = p.assigned_transport_group_id
          )
        )
    )
  );

-- ---- B. BOARDING RECORDS TABLE ----
DROP POLICY IF EXISTS "Scoped staff boarding records access" ON public.boarding_records;

CREATE POLICY "Scoped staff boarding records access"
  ON public.boarding_records FOR SELECT
  TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.journeys j ON j.id = boarding_records.journey_id
      JOIN public.routes r ON r.id = j.route_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = 'admin'
          -- Boarding officers: MUST have non-null matching corridor (FAIL CLOSED)
          OR (
            p.role = 'boarding_officer'
            AND p.assigned_transport_group_id IS NOT NULL
            AND r.transport_group_id = p.assigned_transport_group_id
          )
          OR (
            p.role = 'driver'
            AND (
              j.driver_id = (SELECT auth.uid())
              OR EXISTS (
                SELECT 1 FROM public.drivers d
                WHERE d.id = j.driver_record_id AND d.profile_id = (SELECT auth.uid())
              )
            )
          )
        )
    )
  );

-- ---- C. WAITLISTS TABLE ----
DROP POLICY IF EXISTS "Staff can view corridor waitlists" ON public.waitlists;

CREATE POLICY "Staff can view corridor waitlists"
  ON public.waitlists FOR SELECT
  TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.journeys j ON j.id = waitlists.journey_id
      JOIN public.routes r ON r.id = j.route_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = 'admin'
          -- Boarding officers: MUST have non-null matching corridor (FAIL CLOSED)
          OR (
            p.role = 'boarding_officer'
            AND p.assigned_transport_group_id IS NOT NULL
            AND r.transport_group_id = p.assigned_transport_group_id
          )
          OR (
            p.role = 'driver'
            AND (
              j.driver_id = (SELECT auth.uid())
              OR EXISTS (
                SELECT 1 FROM public.drivers d
                WHERE d.id = j.driver_record_id AND d.profile_id = (SELECT auth.uid())
              )
            )
          )
        )
    )
  );

-- ---- D. PROFILES TABLE ----
DROP POLICY IF EXISTS "Scoped profile visibility policy" ON public.profiles;

CREATE POLICY "Scoped profile visibility policy"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    -- Own profile
    id = (SELECT auth.uid())
    OR
    -- Admins view all profiles
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = (SELECT auth.uid()) AND me.role = 'admin'
    )
    OR
    -- Boarding officers: strictly within assigned corridor, MUST have non-null assignment (FAIL CLOSED)
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = (SELECT auth.uid())
        AND me.role = 'boarding_officer'
        AND me.assigned_transport_group_id IS NOT NULL
        AND (
          -- Students in a hostel within the officer's transport group
          EXISTS (
            SELECT 1 FROM public.hostels h
            WHERE h.id = profiles.hostel_id
              AND h.transport_group_id = me.assigned_transport_group_id
          )
          -- OR passengers booked on journeys in the officer's transport group
          OR EXISTS (
            SELECT 1 FROM public.bookings b
            JOIN public.journeys j ON j.id = b.journey_id
            JOIN public.routes r ON r.id = j.route_id
            WHERE b.student_id = profiles.id
              AND r.transport_group_id = me.assigned_transport_group_id
          )
        )
    )
    OR
    -- Drivers: strictly passengers on their assigned journeys
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.journeys j ON j.id = b.journey_id
      LEFT JOIN public.drivers d ON d.id = j.driver_record_id
      WHERE b.student_id = profiles.id
        AND (
          j.driver_id = (SELECT auth.uid())
          OR d.profile_id = (SELECT auth.uid())
        )
    )
  );

-- ============================================================
-- 2. HARDENED STORED PROCEDURES (STRICT JWT CLAIMS & FAIL CLOSED)
-- ============================================================

-- Drop functions first to avoid ambiguous overloads
DROP FUNCTION IF EXISTS public.book_journey_seat(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.cancel_booking_and_promote(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT);
DROP FUNCTION IF EXISTS public.close_and_depart_journey(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.record_vehicle_readiness(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, BOOLEAN, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.record_journey_stop_update(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.record_journey_stop_update(UUID, UUID, UUID, TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.record_journey_departure_safe(UUID, UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.record_journey_arrival_safe(UUID, UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.admin_generate_journeys_from_schedules(UUID, DATE, UUID);
DROP FUNCTION IF EXISTS public.admin_cancel_journey(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_incident_status(UUID, UUID, public.incident_status, TEXT);

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
  v_caller_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_effective_capacity INTEGER;
  v_active_bookings_count INTEGER;
  v_booking_id UUID;
  v_ticket_token TEXT;
  v_waitlist_pos INTEGER;
  v_booking_cutoff_mins INTEGER := 15;
BEGIN
  -- Extract and strictly validate JWT role
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
    -- Identity anti-spoofing: caller cannot book on behalf of another student. Zero admin exceptions.
    IF p_student_id IS NOT NULL AND p_student_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Authenticated user cannot reserve a seat on behalf of another student.');
    END IF;
    v_caller_id := auth.uid();
  ELSE
    -- Service role execution path
    IF p_student_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit student actor attribution.');
    END IF;
    v_caller_id := p_student_id;
  END IF;

  -- 1. Lock journey row FOR UPDATE
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

  -- Departure cutoff check
  IF v_journey.scheduled_departure <= (now() + (v_booking_cutoff_mins || ' minutes')::interval) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bookings closed: Departure is in less than ' || v_booking_cutoff_mins || ' minutes.');
  END IF;

  -- 2. Prevent duplicate booking
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a confirmed seat on this departure.');
  END IF;

  -- 3. Calculate safe capacity limit
  v_effective_capacity := LEAST(v_journey.safe_capacity, v_journey.proposed_allocation);

  SELECT COUNT(*) INTO v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status = 'confirmed';

  IF v_active_bookings_count < v_effective_capacity THEN
    v_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

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

    UPDATE public.waitlists
    SET status = 'promoted', promoted_at = now()
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status = 'waiting';

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
    -- Capacity reached: Join waitlist
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
  v_caller_id UUID;
  v_jwt_role TEXT;
  v_booking RECORD;
  v_journey RECORD;
  v_top_waitlist RECORD;
  v_new_booking_id UUID;
  v_new_ticket_token TEXT;
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
    IF p_student_id IS NOT NULL AND p_student_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Authenticated user cannot cancel another student booking.');
    END IF;
    v_caller_id := auth.uid();
  ELSE
    IF p_student_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit student actor attribution.');
    END IF;
    v_caller_id := p_student_id;
  END IF;

  -- 1. Lock and find booking belonging to caller
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.student_id = v_caller_id
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
  v_effective_officer_id UUID;
  v_jwt_role TEXT;
  v_booking RECORD;
  v_journey RECORD;
  v_officer RECORD;
  v_student RECORD;
  v_effective_capacity INTEGER;
  v_boarded_count INTEGER;
  v_previous_scan RECORD;
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
    IF p_officer_id IS NOT NULL AND p_officer_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Authenticated user cannot board passengers under another officer identity.');
    END IF;
    v_effective_officer_id := auth.uid();
  ELSE
    IF p_officer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit officer actor attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  -- 1. Verify officer credentials and role from trusted profile record
  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = v_effective_officer_id;

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

  -- 3. Strict Transport Group Access Restriction — FAIL CLOSED:
  -- If officer is a boarding_officer, they MUST have a non-null assigned transport group matching the route.
  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
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

  SELECT full_name, student_id, phone INTO v_student
  FROM public.profiles
  WHERE id = v_booking.student_id;

  -- 5. Duplicate boarding check
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

  -- 6. Cancelled ticket check
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TICKET_CANCELLED',
      'error', 'Boarding Denied: This ticket reservation was cancelled.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 7. Wrong journey check
  IF v_booking.journey_id <> p_journey_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WRONG_JOURNEY',
      'error', 'Wrong Bus / Route: This boarding pass is reserved for another scheduled journey.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 8. Safe physical capacity overflow check
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

  -- 9. Validation passed: record boarding with verified officer attribution
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
    v_effective_officer_id,
    now(),
    p_boarding_method,
    p_exception_reason,
    TRUE,
    now()
  );

  UPDATE public.bookings
  SET status = 'boarded',
      updated_at = now()
  WHERE id = v_booking.id;

  IF v_journey.status = 'scheduled' THEN
    UPDATE public.journeys
    SET status = 'boarding',
        updated_at = now()
    WHERE id = p_journey_id;
  END IF;

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
  v_effective_officer_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_officer RECORD;
  v_boarded_count INTEGER;
  v_noshow_updated INTEGER := 0;
  v_cancelled_count INTEGER := 0;
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
    IF p_officer_id IS NOT NULL AND p_officer_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot close journey under another officer identity.');
    END IF;
    v_effective_officer_id := auth.uid();
  ELSE
    IF p_officer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit officer actor attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = v_effective_officer_id;

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

  -- FAIL CLOSED: Boarding officer must have non-null matching transport group
  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot depart a journey outside your assigned corridor.');
    END IF;
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'boarding') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is already ' || v_journey.status || '.');
  END IF;

  -- Mark unboarded passengers as no-show (cancelled)
  WITH updated_rows AS (
    UPDATE public.bookings
    SET status = 'cancelled', updated_at = now()
    WHERE journey_id = p_journey_id AND status = 'confirmed'
    RETURNING id
  )
  SELECT count(*) INTO v_noshow_updated FROM updated_rows;

  UPDATE public.waitlists
  SET status = 'expired'
  WHERE journey_id = p_journey_id AND status = 'waiting';

  SELECT count(*) INTO v_boarded_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id;

  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = now(),
      updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
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
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit admin actor attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = v_effective_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller must possess administrator role.');
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
    v_effective_admin_id,
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
  v_effective_admin_id UUID;
  v_jwt_role TEXT;
  v_admin RECORD;
  v_journey RECORD;
  v_booking RECORD;
  v_cancelled_bookings INTEGER := 0;
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
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit admin actor attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = v_effective_admin_id;

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
    v_effective_admin_id,
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
  v_effective_admin_id UUID;
  v_jwt_role TEXT;
  v_admin RECORD;
  v_old_value JSONB;
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
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit admin actor attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = v_effective_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Only administrators can update system settings.');
  END IF;

  SELECT value INTO v_old_value
  FROM public.system_settings
  WHERE key = p_key;

  INSERT INTO public.system_settings (key, value, description, updated_by, updated_at)
  VALUES (p_key, p_value, p_description, v_effective_admin_id, now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, public.system_settings.description),
      updated_by = v_effective_admin_id,
      updated_at = now();

  INSERT INTO public.audit_logs (user_id, action, entity_type, details)
  VALUES (
    v_effective_admin_id,
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
  v_effective_admin_id UUID;
  v_jwt_role TEXT;
  v_admin RECORD;
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
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit admin actor attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = v_effective_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Only administrators can update incidents.');
  END IF;

  UPDATE public.incident_reports
  SET status = p_status,
      resolution_notes = p_resolution_notes,
      resolved_by = v_effective_admin_id,
      resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_incident_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
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

-- I. record_vehicle_readiness
CREATE OR REPLACE FUNCTION public.record_vehicle_readiness(
  p_journey_id UUID,
  p_user_id UUID,
  p_vehicle_available BOOLEAN,
  p_vehicle_safe BOOLEAN,
  p_mechanical_fault BOOLEAN,
  p_fault_description TEXT,
  p_journey_reviewed BOOLEAN,
  p_battery_level INTEGER,
  p_tires_and_lights BOOLEAN,
  p_notes TEXT,
  p_is_assisted BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_user_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_user RECORD;
  v_readiness_status TEXT;
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
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot impersonate another operational user.');
    END IF;
    v_effective_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit user actor attribution.');
    END IF;
    v_effective_user_id := p_user_id;
  END IF;

  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = v_effective_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller cannot record readiness checks.');
  END IF;

  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target journey not found.');
  END IF;

  -- FAIL CLOSED: Boarding officer must have non-null matching corridor
  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-group restriction: You cannot record readiness for this corridor.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id != v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: You are not the driver assigned to this journey.');
  END IF;

  IF NOT p_vehicle_safe OR NOT p_vehicle_available THEN
    v_readiness_status := 'failed_unsafe';
  ELSE
    v_readiness_status := 'passed';
  END IF;

  INSERT INTO public.vehicle_readiness_checks (
    journey_id,
    vehicle_id,
    checked_by_user_id,
    is_assisted,
    assisted_by_role,
    vehicle_available,
    vehicle_safe,
    mechanical_fault_reported,
    fault_description,
    journey_reviewed,
    battery_level_percent,
    tires_and_lights_checked,
    status,
    notes,
    created_at
  )
  VALUES (
    p_journey_id,
    v_journey.vehicle_id,
    v_effective_user_id,
    p_is_assisted,
    CASE WHEN p_is_assisted THEN v_user.role::text ELSE NULL END,
    p_vehicle_available,
    p_vehicle_safe,
    p_mechanical_fault,
    p_fault_description,
    p_journey_reviewed,
    p_battery_level,
    p_tires_and_lights,
    v_readiness_status,
    p_notes,
    now()
  );

  UPDATE public.journeys
  SET readiness_status = v_readiness_status,
      readiness_checked_at = now(),
      readiness_checked_by = v_effective_user_id,
      is_assisted_operation = (is_assisted_operation OR p_is_assisted),
      updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.journey_operational_logs (
    journey_id,
    driver_id,
    recorded_by_user_id,
    action_type,
    operation_mode,
    details
  )
  VALUES (
    p_journey_id,
    v_journey.driver_record_id,
    v_effective_user_id,
    'READINESS_CHECK',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object(
      'status', v_readiness_status,
      'is_safe', p_vehicle_safe,
      'battery', p_battery_level
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'readiness_status', v_readiness_status,
    'message', CASE WHEN v_readiness_status = 'passed' THEN 'Vehicle cleared for safe departure.' ELSE 'Vehicle flagged as unsafe. Departure blocked.' END
  );
END;
$$;

-- J. record_journey_stop_update
CREATE OR REPLACE FUNCTION public.record_journey_stop_update(
  p_journey_id UUID,
  p_stop_id UUID,
  p_user_id UUID,
  p_event_type TEXT,
  p_notes TEXT DEFAULT NULL,
  p_is_assisted BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_user_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_user RECORD;
  v_stop RECORD;
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
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record stop updates for another user.');
    END IF;
    v_effective_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit user actor attribution.');
    END IF;
    v_effective_user_id := p_user_id;
  END IF;

  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = v_effective_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- FAIL CLOSED: Boarding officer must have non-null matching corridor
  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-group restriction: Not authorised for this corridor.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id != v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not the driver assigned to this journey.');
  END IF;

  SELECT * INTO v_stop
  FROM public.stops
  WHERE id = p_stop_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Stop not found.');
  END IF;

  INSERT INTO public.journey_stop_updates (
    journey_id,
    stop_id,
    recorded_by_user_id,
    event_type,
    is_assisted,
    notes,
    created_at
  )
  VALUES (
    p_journey_id,
    p_stop_id,
    v_effective_user_id,
    p_event_type,
    p_is_assisted,
    p_notes,
    now()
  );

  INSERT INTO public.journey_operational_logs (
    journey_id,
    driver_id,
    recorded_by_user_id,
    action_type,
    operation_mode,
    details
  )
  VALUES (
    p_journey_id,
    v_journey.driver_record_id,
    v_effective_user_id,
    'STOP_UPDATE',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('stop_name', v_stop.name, 'event_type', p_event_type)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Milestone update recorded: ' || v_stop.name || ' (' || p_event_type || ').');
END;
$$;

-- K. record_journey_delay_with_notifications
CREATE OR REPLACE FUNCTION public.record_journey_delay_with_notifications(
  p_journey_id UUID,
  p_user_id UUID,
  p_delay_minutes INTEGER,
  p_delay_reason TEXT,
  p_is_assisted BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_user_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_user RECORD;
  v_passenger RECORD;
  v_notified_count INTEGER := 0;
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
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot report delays for another user.');
    END IF;
    v_effective_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit user actor attribution.');
    END IF;
    v_effective_user_id := p_user_id;
  END IF;

  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = v_effective_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  SELECT j.*, r.name AS route_name, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- FAIL CLOSED: Boarding officer must have non-null matching corridor
  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-group restriction: Not authorised for this corridor.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id != v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not the driver assigned to this journey.');
  END IF;

  UPDATE public.journeys
  SET delay_minutes = p_delay_minutes,
      delay_reason = p_delay_reason,
      updated_at = now()
  WHERE id = p_journey_id;

  FOR v_passenger IN
    SELECT b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('confirmed', 'boarded')
  LOOP
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      related_journey_id
    )
    VALUES (
      v_passenger.student_id,
      'Trip Delay: ' || p_delay_minutes || ' Mins',
      'Departure on ' || v_journey.route_name || ' delayed by ' || p_delay_minutes || ' mins. Reason: ' || p_delay_reason,
      'delay_alert',
      p_journey_id
    );
    v_notified_count := v_notified_count + 1;
  END LOOP;

  INSERT INTO public.journey_operational_logs (
    journey_id,
    driver_id,
    recorded_by_user_id,
    action_type,
    operation_mode,
    details
  )
  VALUES (
    p_journey_id,
    v_journey.driver_record_id,
    v_effective_user_id,
    'DELAY_REPORTED',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object(
      'delay_minutes', p_delay_minutes,
      'reason', p_delay_reason,
      'passengers_notified', v_notified_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Delay of ' || p_delay_minutes || ' mins broadcast to ' || v_notified_count || ' passenger(s).'
  );
END;
$$;

-- L. record_journey_departure_safe
CREATE OR REPLACE FUNCTION public.record_journey_departure_safe(
  p_journey_id UUID,
  p_actor_id UUID,
  p_is_assisted BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_actor_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_user RECORD;
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
    IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record departure for another user.');
    END IF;
    v_effective_actor_id := auth.uid();
  ELSE
    IF p_actor_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit actor attribution.');
    END IF;
    v_effective_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = v_effective_actor_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller cannot record departure.');
  END IF;

  SELECT j.*, r.transport_group_id, v.registration_number AS bus_reg
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- FAIL CLOSED: Boarding officer must have non-null matching corridor
  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-group restriction: Not authorised for this corridor.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id != v_effective_actor_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_actor_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not the driver assigned to this journey.');
  END IF;

  IF v_journey.readiness_status = 'failed_unsafe' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Safety violation: Pre-departure check flagged vehicle as unsafe. Departure blocked.');
  END IF;

  IF v_journey.status = 'in_transit' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bus is already in transit.');
  END IF;

  IF v_journey.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot depart a ' || v_journey.status || ' trip.');
  END IF;

  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = now(),
      is_assisted_operation = (is_assisted_operation OR p_is_assisted),
      updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.journey_operational_logs (
    journey_id,
    driver_id,
    recorded_by_user_id,
    action_type,
    operation_mode,
    details
  )
  VALUES (
    p_journey_id,
    v_journey.driver_record_id,
    v_effective_actor_id,
    'DEPARTURE',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('actual_departure', now(), 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bus ' || v_journey.bus_reg || ' departed. Status changed to in_transit.',
    'actual_departure', now()
  );
END;
$$;

-- M. record_journey_arrival_safe
CREATE OR REPLACE FUNCTION public.record_journey_arrival_safe(
  p_journey_id UUID,
  p_actor_id UUID,
  p_is_assisted BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_actor_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_user RECORD;
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
    IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record arrival for another user.');
    END IF;
    v_effective_actor_id := auth.uid();
  ELSE
    IF p_actor_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit actor attribution.');
    END IF;
    v_effective_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = v_effective_actor_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller cannot record arrival.');
  END IF;

  SELECT j.*, r.transport_group_id, v.registration_number AS bus_reg
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- FAIL CLOSED: Boarding officer must have non-null matching corridor
  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-group restriction: Not authorised for this corridor.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id != v_effective_actor_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_actor_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not the driver assigned to this journey.');
  END IF;

  IF v_journey.status != 'in_transit' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot record arrival: Trip must be in transit (Current status: ' || v_journey.status || ').');
  END IF;

  UPDATE public.journeys
  SET status = 'completed',
      actual_arrival = now(),
      is_assisted_operation = (is_assisted_operation OR p_is_assisted),
      updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.journey_operational_logs (
    journey_id,
    driver_id,
    recorded_by_user_id,
    action_type,
    operation_mode,
    details
  )
  VALUES (
    p_journey_id,
    v_journey.driver_record_id,
    v_effective_actor_id,
    'ARRIVAL',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('actual_arrival', now(), 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bus ' || v_journey.bus_reg || ' arrived at destination. Journey completed.',
    'actual_arrival', now()
  );
END;
$$;

-- ============================================================
-- 3. EXPLICIT FUNCTION-BY-FUNCTION EXECUTION PERMISSIONS
-- ============================================================

-- A. Revoke ALL permissions from PUBLIC and anonymous roles
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- B. Revoke execution on trigger functions from all client roles
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.prevent_audit_log_modification() FROM PUBLIC, anon, authenticated, service_role;

-- C. Explicit grants to authenticated role:
-- Student workflow:
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) TO authenticated;

-- Boarding Officer workflow:
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) TO authenticated;

-- Driver & Assisted Operational workflow:
GRANT EXECUTE ON FUNCTION public.record_vehicle_readiness(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, BOOLEAN, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_journey_stop_update(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_journey_departure_safe(UUID, UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_journey_arrival_safe(UUID, UUID, BOOLEAN, TEXT) TO authenticated;

-- Administrator workflow:
GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_incident_status(UUID, UUID, public.incident_status, TEXT) TO authenticated;

-- D. Explicit grants to service_role (server-side background jobs & scripts):
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_vehicle_readiness(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, BOOLEAN, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_stop_update(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_departure_safe(UUID, UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_arrival_safe(UUID, UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_incident_status(UUID, UUID, public.incident_status, TEXT) TO service_role;
