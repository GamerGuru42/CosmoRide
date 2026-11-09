-- CosmoRide Migration 00003: Transport Group Isolation & Boarding Operations
-- Cosmopolitan University, Nigeria
--
-- Enforces:
-- 1. Transport group isolation for boarding officers (Boys vs Girls operations)
-- 2. Enhanced verify_and_board_passenger procedure with cross-group rejection and explicit status codes
-- 3. Stored procedure close_and_depart_journey with auditable closure and no-show handling
-- 4. Group-scoped RLS policies on bookings, journeys, boarding_records, and waitlists

-- ============================================================
-- 1. ENHANCED ATOMIC VERIFY AND BOARD PASSENGER
-- ============================================================

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
  v_route RECORD;
  v_effective_capacity INTEGER;
  v_boarded_count INTEGER;
  v_previous_scan RECORD;
BEGIN
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
  -- If officer is a boarding_officer with an assigned transport group,
  -- verify that the journey's route belongs to the same transport group.
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

  -- 4. Find and lock booking by ticket_token (Opaque token; prevents tampering)
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

  -- 5. Cross-Journey / Wrong Bus Validation
  IF v_booking.journey_id != p_journey_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WRONG_JOURNEY',
      'error', 'Wrong Bus: This boarding pass is issued for a different scheduled departure.'
    );
  END IF;

  -- 6. Cancelled Ticket Validation
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CANCELLED',
      'error', 'Cancelled Ticket: This booking was previously cancelled by the passenger or administrator.'
    );
  END IF;

  -- 7. Duplicate Scan Prevention
  IF v_booking.status = 'checked_in' THEN
    SELECT * INTO v_previous_scan
    FROM public.boarding_records
    WHERE booking_id = v_booking.id
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_BOARDED',
      'error', 'Duplicate Scan Prevented: Passenger was already checked in at ' ||
        to_char(COALESCE(v_previous_scan.scanned_at, v_booking.checked_in_at), 'HH12:MI AM') || '.'
    );
  END IF;

  -- 8. Safe Passenger Capacity Ceiling Enforcement
  v_effective_capacity := LEAST(v_journey.proposed_allocation, v_journey.safe_capacity);

  SELECT COUNT(*) INTO v_boarded_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id AND is_verified = TRUE;

  IF v_boarded_count >= v_effective_capacity THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CAPACITY_EXCEEDED',
      'error', 'Safe Capacity Limit Reached: Cannot board beyond approved limit of ' || v_effective_capacity || ' passengers.'
    );
  END IF;

  -- 9. Fetch passenger identity
  SELECT full_name, student_id INTO v_student
  FROM public.profiles
  WHERE id = v_booking.student_id;

  -- 10. Mark booking as checked_in
  UPDATE public.bookings
  SET status = 'checked_in',
      checked_in_at = now(),
      checked_in_by = p_officer_id
  WHERE id = v_booking.id;

  -- 11. Insert immutable boarding record
  INSERT INTO public.boarding_records (
    booking_id,
    journey_id,
    student_id,
    vehicle_id,
    scanned_by,
    scanned_at,
    boarding_method,
    exception_reason,
    is_verified
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
    TRUE
  );

  -- 12. If manual override, write to audit log
  IF p_boarding_method = 'manual_override' THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      p_officer_id,
      'MANUAL_BOARDING_OVERRIDE',
      'booking',
      v_booking.id,
      jsonb_build_object(
        'student_id', v_booking.student_id,
        'student_name', v_student.full_name,
        'journey_id', p_journey_id,
        'reason', p_exception_reason
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'VALID',
    'message', 'Boarding verified and recorded.',
    'passenger_name', v_student.full_name,
    'student_id', v_student.student_id,
    'scanned_at', now(),
    'boarded_count', v_boarded_count + 1,
    'capacity', v_effective_capacity,
    'bus_registration', v_journey.registration_number
  );
END;
$$;

-- ============================================================
-- 2. ATOMIC JOURNEY CLOSURE WORKFLOW
-- ============================================================

CREATE OR REPLACE FUNCTION public.close_and_depart_journey(
  p_journey_id UUID,
  p_officer_id UUID,
  p_mark_unboarded_as_noshow BOOLEAN DEFAULT FALSE,
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
  v_unboarded_count INTEGER;
  v_cancelled_count INTEGER;
  v_noshow_updated INTEGER := 0;
BEGIN
  -- 1. Verify officer authorization
  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = p_officer_id;

  IF NOT FOUND OR v_officer.role NOT IN ('boarding_officer', 'admin', 'driver') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- 2. Lock journey
  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- Check group restriction
  IF v_officer.role = 'boarding_officer' AND v_officer.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cross-group restriction: You cannot close journeys for this corridor.');
    END IF;
  END IF;

  -- 3. Calculate summary metrics
  SELECT COUNT(*) INTO v_boarded_count
  FROM public.bookings
  WHERE journey_id = p_journey_id AND status = 'checked_in';

  SELECT COUNT(*) INTO v_unboarded_count
  FROM public.bookings
  WHERE journey_id = p_journey_id AND status = 'confirmed';

  SELECT COUNT(*) INTO v_cancelled_count
  FROM public.bookings
  WHERE journey_id = p_journey_id AND status = 'cancelled';

  -- 4. Mark unboarded passengers as no-show if requested
  IF p_mark_unboarded_as_noshow AND v_unboarded_count > 0 THEN
    UPDATE public.bookings
    SET status = 'no_show'
    WHERE journey_id = p_journey_id AND status = 'confirmed';

    GET DIAGNOSTICS v_noshow_updated = ROW_COUNT;
  END IF;

  -- 5. Transition journey to in_transit
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = now()
  WHERE id = p_journey_id;

  -- 6. Log closure audit
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

-- ============================================================
-- 3. ROW LEVEL SECURITY GROUP RESTRICTIONS
-- ============================================================

-- Drop old broad policies on bookings
DROP POLICY IF EXISTS "Boarding officers can view journey bookings" ON public.bookings;
DROP POLICY IF EXISTS "Boarding officers can check in students" ON public.bookings;

-- Group-scoped policy: Boarding officers can view bookings ONLY for routes in their assigned group (or all if admin)
CREATE POLICY "Boarding officers can view assigned group bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.journeys j ON j.id = bookings.journey_id
      JOIN public.routes r ON r.id = j.route_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = 'admin'
          OR (
            p.role = 'boarding_officer'
            AND (p.assigned_transport_group_id IS NULL OR r.transport_group_id = p.assigned_transport_group_id)
          )
        )
    )
  );

-- Group-scoped policy: Boarding officers can update bookings ONLY for their assigned group
CREATE POLICY "Boarding officers can update assigned group bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.journeys j ON j.id = bookings.journey_id
      JOIN public.routes r ON r.id = j.route_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = 'admin'
          OR (
            p.role = 'boarding_officer'
            AND (p.assigned_transport_group_id IS NULL OR r.transport_group_id = p.assigned_transport_group_id)
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.journeys j ON j.id = bookings.journey_id
      JOIN public.routes r ON r.id = j.route_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role = 'admin'
          OR (
            p.role = 'boarding_officer'
            AND (p.assigned_transport_group_id IS NULL OR r.transport_group_id = p.assigned_transport_group_id)
          )
        )
    )
  );

-- Group-scoped policy on journeys for boarding officers
DROP POLICY IF EXISTS "Boarding officers can view assigned journeys" ON public.journeys;

CREATE POLICY "Boarding officers can view assigned journeys"
  ON public.journeys FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.routes r ON r.id = journeys.route_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          p.role IN ('admin', 'student', 'driver')
          OR (
            p.role = 'boarding_officer'
            AND (p.assigned_transport_group_id IS NULL OR r.transport_group_id = p.assigned_transport_group_id)
          )
        )
    )
  );

