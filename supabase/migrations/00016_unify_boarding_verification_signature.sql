-- ============================================================
-- COSMORIDE — MIGRATION 00016
-- Unify Boarding Verification RPC Signature & Clean Overloads
-- ============================================================
-- 1. Drops mismatched overload (TEXT, UUID, TEXT, TEXT, UUID)
-- 2. Cleanly replaces canonical verify_and_board_passenger with
--    exact (TEXT, UUID, UUID, public.boarding_method, TEXT) signature
-- 3. Corrects bookings update (removes non-existent updated_at)
-- 4. Preserves 30-passenger physical capacity check & passenger_category
-- ============================================================

DROP FUNCTION IF EXISTS public.verify_and_board_passenger(TEXT, UUID, TEXT, TEXT, UUID);

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
  v_journey RECORD;
  v_officer RECORD;
  v_booking RECORD;
  v_student RECORD;
  v_previous_scan RECORD;
  v_boarded_count INTEGER;
  v_effective_capacity INTEGER;
BEGIN
  -- 1. Trust boundary: verify authenticated session
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record boarding under another officer identity.');
    END IF;
    v_effective_officer_id := auth.uid();
  ELSE
    IF p_officer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit officer actor attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  -- 2. Verify officer role
  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = v_effective_officer_id;

  IF NOT FOUND OR v_officer.role NOT IN ('boarding_officer', 'admin') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Only authorised hostel representatives and administrators may board passengers.'
    );
  END IF;

  -- 3. Lock Journey and check physical safe capacity limits
  SELECT j.*, r.name AS route_name, r.code AS route_code, r.transport_group_id, v.safe_capacity
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  LEFT JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey record not found.');
  END IF;

  v_effective_capacity := COALESCE(v_journey.safe_capacity, v_journey.proposed_allocation, 30);

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Cross-Group Restriction: You cannot board passengers for a corridor outside your assigned fleet.'
      );
    END IF;
  END IF;

  IF v_journey.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_CLOSED',
      'error', 'Boarding Closed: This journey has already ended or was cancelled.'
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

  -- 5. Duplicate boarding check (checked_in indicates boarded pass)
  IF v_booking.status = 'checked_in' THEN
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
      'student_id', v_student.student_id,
      'passenger_category', v_booking.passenger_category
    );
  END IF;

  -- 6. Cancelled ticket check
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TICKET_CANCELLED',
      'error', 'Cancelled Pass: This booking was cancelled prior to departure.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 7. Cross-journey check
  IF v_booking.journey_id <> p_journey_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WRONG_JOURNEY',
      'error', 'Wrong Bus/Trip: This boarding pass is issued for a different scheduled departure.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 8. Physical safe capacity limit check (30 passengers maximum total capacity)
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

  -- 9. Record boarding with verified officer attribution and category
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
    passenger_category,
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
    v_booking.passenger_category,
    now()
  );

  -- Update booking to checked_in (bookings table has checked_in_at, no updated_at)
  UPDATE public.bookings
  SET status = 'checked_in',
      checked_in_at = now(),
      checked_in_by = v_effective_officer_id
  WHERE id = v_booking.id;

  IF v_journey.status = 'scheduled' THEN
    UPDATE public.journeys
    SET status = 'boarding',
        updated_at = now()
    WHERE id = p_journey_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'PASSENGER_BOARDED',
    'boarding_record',
    v_booking.id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'student_id', v_booking.student_id,
      'passenger_category', v_booking.passenger_category,
      'boarding_method', p_boarding_method,
      'boarded_count', v_boarded_count + 1
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BOARDING_APPROVED',
    'passenger_name', v_student.full_name,
    'student_id', v_student.student_id,
    'passenger_category', v_booking.passenger_category,
    'boarding_method', p_boarding_method,
    'boarded_count', v_boarded_count + 1,
    'message', 'Boarding approved (' || v_booking.passenger_category || '). Welcome aboard!'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO service_role;
