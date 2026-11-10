-- ============================================================
-- COSMORIDE — MIGRATION 00015
-- Clean RPC Signatures & Catalog Schema Lint Alignments
-- ============================================================
-- 1. Drops legacy 6-parameter overload of record_journey_delay_with_notifications
-- 2. Corrects booking_status enum usage ('checked_in' instead of non-existent 'boarded')
-- 3. Corrects notification_type enum values ('delay_alert', 'booking_confirmed')
-- 4. Aligns bookings updates (removes non-existent updated_at and created_at columns)
-- 5. Corrects profiles query in book_journey_seat (gender resides on hostels relation)
-- ============================================================

-- ------------------------------------------------------------
-- 1. DROP OBSOLETE OVERLOADS
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, TEXT, BOOLEAN);

-- ------------------------------------------------------------
-- 2. BOOK_JOURNEY_SEAT (ALIGNED PROFILE & BOOKING SCHEMA)
-- ------------------------------------------------------------

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
  v_stop RECORD;
  v_booking_id UUID;
  v_ticket_token TEXT;
  v_effective_capacity INTEGER;
  v_active_bookings_count INTEGER;
  v_seated_count INTEGER;
  v_standing_count INTEGER;
  v_max_seated INTEGER;
  v_max_standing INTEGER;
  v_assigned_category public.passenger_category;
  v_waitlist_count INTEGER;
  v_waitlist_pos INTEGER;
  v_waitlist_id UUID;
  v_cutoff_minutes INTEGER := 15;
  v_departure_epoch TIMESTAMPTZ;
BEGIN
  -- A. Authentication & Actor Attribution
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Booking requires an active authenticated session.'
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

  -- B. Validate Student Account Eligibility (gender is on hostels, not profiles)
  SELECT p.id, p.full_name, p.role, p.is_active, p.hostel_id, p.assigned_transport_group_id,
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
      'code', 'ROLE_NOT_ELIGIBLE',
      'error', 'Only enrolled university students can hold personal bus seat reservations.'
    );
  END IF;

  -- C. Lock and Validate Journey
  SELECT
    j.id,
    j.status,
    j.scheduled_departure,
    j.journey_date,
    j.proposed_allocation,
    v.safe_capacity,
    v.seated_capacity,
    v.standing_capacity,
    r.id AS route_id,
    r.name AS route_name,
    r.code AS route_code,
    r.gender_group,
    r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  LEFT JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_NOT_FOUND',
      'error', 'Requested journey does not exist or has been cancelled.'
    );
  END IF;

  IF v_journey.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_CLOSED',
      'error', 'Booking closed: This journey is ' || v_journey.status || '.'
    );
  END IF;

  IF v_journey.safe_capacity IS NULL OR v_journey.safe_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CAPACITY_NOT_CONFIGURED',
      'error', 'Booking unavailable: Assigned vehicle safe capacity has not been approved.'
    );
  END IF;

  -- D. Corridor & Gender Group Enforcement
  IF v_journey.gender_group IN ('male', 'female') THEN
    IF v_student.hostel_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'HOSTEL_NOT_ASSIGNED',
        'error', 'Eligibility requirement: You must be registered in an official university hostel to book this gender-segregated corridor.'
      );
    END IF;

    IF v_student.hostel_gender IS DISTINCT FROM v_journey.gender_group THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CORRIDOR_MISMATCH',
        'error', 'Corridor Policy: You are assigned to ' || COALESCE(v_student.hostel_name, 'a different hostel') ||
                 ' and are not eligible to book the ' || v_journey.gender_group || ' corridor.'
      );
    END IF;
  END IF;

  -- E. Cutoff Policy
  SELECT COALESCE((value)::integer, 15) INTO v_cutoff_minutes
  FROM public.system_settings
  WHERE key = 'booking_cutoff_minutes';

  v_departure_epoch := v_journey.scheduled_departure;

  IF now() > (v_departure_epoch - (v_cutoff_minutes * INTERVAL '1 minute')) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BOOKING_CUTOFF_EXCEEDED',
      'error', 'Booking closed: Reservations close ' || v_cutoff_minutes || ' minutes before departure.'
    );
  END IF;

  -- F. Validate Boarding Stop
  SELECT rs.stop_order INTO v_stop
  FROM public.route_stops rs
  WHERE rs.route_id = v_journey.route_id AND rs.stop_id = p_boarding_stop_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STOP',
      'error', 'Selected pickup stop is not valid for this route corridor.'
    );
  END IF;

  -- G. Check for Existing Active Reservation or Waitlist Entry
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_BOOKING',
      'error', 'You already hold an active confirmed seat on this departure.'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.waitlists
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status = 'waiting'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_WAITLISTED',
      'error', 'You are already in the waiting list queue for this departure.'
    );
  END IF;

  -- H. Calculate Seated, Standing, and Safe Total Limits
  v_effective_capacity := LEAST(v_journey.safe_capacity, v_journey.proposed_allocation);
  v_max_seated := LEAST(COALESCE(v_journey.seated_capacity, 20), v_effective_capacity);
  v_max_standing := LEAST(COALESCE(v_journey.standing_capacity, 10), v_effective_capacity - v_max_seated);

  SELECT count(*) INTO v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in');

  SELECT count(*) INTO v_seated_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND passenger_category = 'seated'
    AND status IN ('confirmed', 'checked_in');

  SELECT count(*) INTO v_standing_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND passenger_category = 'standing'
    AND status IN ('confirmed', 'checked_in');

  -- I. First-Come-First-Served Allocation
  IF v_active_bookings_count < v_effective_capacity THEN
    IF v_seated_count < v_max_seated THEN
      v_assigned_category := 'seated';
    ELSIF v_standing_count < v_max_standing THEN
      v_assigned_category := 'standing';
    ELSE
      v_assigned_category := NULL;
    END IF;
  ELSE
    v_assigned_category := NULL;
  END IF;

  IF v_assigned_category IS NOT NULL THEN
    -- Generate secure 48-character hex ticket token
    v_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    -- Re-activate or insert booking (bookings table has booked_at, not created_at/updated_at)
    SELECT id INTO v_booking_id
    FROM public.bookings
    WHERE journey_id = p_journey_id AND student_id = v_caller_id;

    IF FOUND THEN
      UPDATE public.bookings
      SET status = 'confirmed',
          passenger_category = v_assigned_category,
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
        passenger_category,
        ticket_token,
        boarding_pass_issued_at,
        booked_at
      )
      VALUES (
        p_journey_id,
        v_caller_id,
        p_boarding_stop_id,
        'confirmed',
        v_assigned_category,
        v_ticket_token,
        now(),
        now()
      )
      RETURNING id INTO v_booking_id;
    END IF;

    -- Clean up any prior waiting list entry
    UPDATE public.waitlists
    SET status = 'promoted', promoted_at = now()
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status = 'waiting';

    -- Issue notification
    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_caller_id,
      CASE WHEN v_assigned_category = 'seated' THEN 'Booking Confirmed (Seated)' ELSE 'Booking Confirmed (Standing)' END,
      CASE WHEN v_assigned_category = 'seated'
        THEN 'Your seated place is reserved for departure at ' || to_char(v_journey.scheduled_departure, 'HH24:MI') || '. Boarding pass ready.'
        ELSE 'Your standing place is reserved for departure at ' || to_char(v_journey.scheduled_departure, 'HH24:MI') || '. Boarding pass ready.'
      END,
      'booking_confirmed',
      p_journey_id
    );

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_caller_id,
      'BOOKING_CREATED',
      'booking',
      v_booking_id,
      jsonb_build_object(
        'journey_id', p_journey_id,
        'category', v_assigned_category,
        'safe_capacity', v_journey.safe_capacity,
        'active_total_after', v_active_bookings_count + 1
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'confirmed',
      'booking_id', v_booking_id,
      'passenger_category', v_assigned_category,
      'message', CASE WHEN v_assigned_category = 'seated'
        THEN 'Seat reserved successfully. You have been allocated a seated place.'
        ELSE 'Reserved successfully. You have been allocated a standing place.'
      END
    );
  ELSE
    -- Journey is at maximum capacity (30 passengers): place student on waitlist
    SELECT count(*) INTO v_waitlist_count
    FROM public.waitlists
    WHERE journey_id = p_journey_id AND status = 'waiting';

    v_waitlist_pos := v_waitlist_count + 1;

    INSERT INTO public.waitlists (
      journey_id,
      student_id,
      boarding_stop_id,
      position,
      status
    )
    VALUES (
      p_journey_id,
      v_caller_id,
      p_boarding_stop_id,
      v_waitlist_pos,
      'waiting'
    )
    RETURNING id INTO v_waitlist_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_caller_id,
      'WAITLIST_JOINED',
      'waitlist',
      v_waitlist_id,
      jsonb_build_object('journey_id', p_journey_id, 'position', v_waitlist_pos)
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlisted',
      'waitlist_position', v_waitlist_pos,
      'message', 'Bus has reached safe capacity (30 passengers max). You have been placed on the waiting list at position #' || v_waitlist_pos || '.'
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. CANCEL_BOOKING_AND_PROMOTE (CLEAN ORDER BY & NO UPDATED_AT)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_booking_and_promote(
  p_booking_id UUID,
  p_student_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'Cancelled by passenger'
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
  v_cancelled_category public.passenger_category;
  v_standing_to_upgrade RECORD;
  v_top_waitlist RECORD;
  v_new_booking_id UUID;
  v_new_ticket_token TEXT;
  v_promoted_category public.passenger_category;
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

  -- 1. Fetch and Lock the Booking
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Booking not found.');
  END IF;

  -- Anti-spoofing ownership check
  IF v_booking.student_id <> v_caller_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: You do not own this booking.');
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_CANCELLED', 'error', 'Booking is already cancelled.');
  END IF;

  IF v_booking.status = 'checked_in' THEN
    RETURN jsonb_build_object('success', false, 'code', 'CANNOT_CANCEL_BOARDED', 'error', 'Cannot cancel a booking that has already boarded the vehicle.');
  END IF;

  -- 2. Fetch Journey to ensure not departed
  SELECT j.*, r.name AS route_name
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = v_booking.journey_id
  FOR UPDATE OF j;

  IF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_ALREADY_DEPARTED', 'error', 'Cannot cancel booking: Journey has already departed.');
  END IF;

  v_cancelled_category := COALESCE(v_booking.passenger_category, 'seated');

  -- 3. Cancel the Booking (bookings table has cancelled_at, no updated_at)
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
    jsonb_build_object('reason', p_reason, 'journey_id', v_booking.journey_id, 'released_category', v_cancelled_category)
  );

  -- 4. Rebalance Categories & Auto-Promote from Waiting List:
  IF v_cancelled_category = 'seated' THEN
    -- Check if standing passenger exists to upgrade (ordered by booked_at, id)
    SELECT id, student_id INTO v_standing_to_upgrade
    FROM public.bookings
    WHERE journey_id = v_booking.journey_id
      AND status IN ('confirmed', 'checked_in')
      AND passenger_category = 'standing'
    ORDER BY booked_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      -- Upgrade standing passenger to seated
      UPDATE public.bookings
      SET passenger_category = 'seated'
      WHERE id = v_standing_to_upgrade.id;

      INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
      VALUES (
        v_standing_to_upgrade.student_id,
        'Booking Upgraded: Seated Place!',
        'A seated place has opened up on your departure! Your booking has been upgraded from standing to seated.',
        'booking_confirmed',
        v_booking.journey_id
      );

      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (
        v_standing_to_upgrade.student_id,
        'STANDING_UPGRADED_TO_SEATED',
        'booking',
        v_standing_to_upgrade.id,
        jsonb_build_object('journey_id', v_booking.journey_id)
      );

      -- The vacant spot passed to waitlist is 'standing'
      v_promoted_category := 'standing';
    ELSE
      -- No standing passengers; vacant spot is 'seated'
      v_promoted_category := 'seated';
    END IF;
  ELSE
    -- Cancelled category was 'standing'
    v_promoted_category := 'standing';
  END IF;

  -- 5. Promote First Candidate from Waiting List
  SELECT id, student_id, boarding_stop_id INTO v_top_waitlist
  FROM public.waitlists
  WHERE journey_id = v_booking.journey_id
    AND status = 'waiting'
  ORDER BY position ASC, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_new_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    SELECT id INTO v_new_booking_id
    FROM public.bookings
    WHERE journey_id = v_booking.journey_id
      AND student_id = v_top_waitlist.student_id;

    IF FOUND THEN
      UPDATE public.bookings
      SET status = 'confirmed',
          passenger_category = v_promoted_category,
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
        passenger_category,
        ticket_token,
        boarding_pass_issued_at,
        booked_at
      )
      VALUES (
        v_booking.journey_id,
        v_top_waitlist.student_id,
        v_top_waitlist.boarding_stop_id,
        'confirmed',
        v_promoted_category,
        v_new_ticket_token,
        now(),
        now()
      )
      RETURNING id INTO v_new_booking_id;
    END IF;

    UPDATE public.waitlists
    SET status = 'promoted', promoted_at = now()
    WHERE id = v_top_waitlist.id;

    -- Re-index remaining waiting list
    WITH numbered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC, created_at ASC) AS new_pos
      FROM public.waitlists
      WHERE journey_id = v_booking.journey_id AND status = 'waiting'
    )
    UPDATE public.waitlists w
    SET position = n.new_pos
    FROM numbered n
    WHERE w.id = n.id;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_top_waitlist.student_id,
      'Waitlist Promoted: Reservation Confirmed!',
      'Great news! A spot opened on ' || v_journey.route_name || '. Your reservation (' || v_promoted_category || ') has been confirmed. View your digital ticket now.',
      'waitlist_promoted',
      v_booking.journey_id
    );

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_top_waitlist.student_id,
      'WAITLIST_PROMOTED',
      'booking',
      v_new_booking_id,
      jsonb_build_object('journey_id', v_booking.journey_id, 'allocated_category', v_promoted_category)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Booking cancelled successfully. Capacity released.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. VERIFY_AND_BOARD_PASSENGER (REMOVED UPDATED_AT ON BOOKINGS)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_and_board_passenger(
  p_ticket_token TEXT,
  p_journey_id UUID,
  p_boarding_method TEXT DEFAULT 'qr_scan',
  p_exception_reason TEXT DEFAULT NULL,
  p_officer_id UUID DEFAULT NULL
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

  -- 3. Lock Journey and check physical capacity limits
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

  -- 8. Physical capacity limit check
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

  -- 9. Validation passed: record boarding with verified officer attribution and passenger category
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

-- ------------------------------------------------------------
-- 5. CLOSE_AND_DEPART_JOURNEY (ALIGNED BOOKINGS UPDATE)
-- ------------------------------------------------------------

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

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot depart a journey outside your assigned corridor.');
    END IF;
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'boarding') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is already ' || v_journey.status || '.');
  END IF;

  -- Mark unboarded passengers as no-show / cancelled
  WITH updated_rows AS (
    UPDATE public.bookings
    SET status = 'cancelled', cancelled_at = now()
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
      'noshow_unboarded_cancelled', v_noshow_updated,
      'closure_notes', p_closure_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'boarded_count', v_boarded_count,
    'noshow_count', v_noshow_updated,
    'message', 'Journey gates closed. ' || v_boarded_count || ' boarded. ' || v_noshow_updated || ' unboarded bookings released.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. ADMIN_CANCEL_JOURNEY (CORRECTED STATUS & NO UPDATED_AT)
-- ------------------------------------------------------------

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
    WHERE b.journey_id = p_journey_id AND b.status IN ('confirmed', 'checked_in')
  LOOP
    UPDATE public.bookings
    SET status = 'cancelled', cancelled_at = now()
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
    jsonb_build_object('reason', p_cancellation_reason, 'cancelled_bookings', v_cancelled_bookings)
  );

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_bookings_count', v_cancelled_bookings
  );
END;
$$;

-- ------------------------------------------------------------
-- 7. RECORD_JOURNEY_DELAY_WITH_NOTIFICATIONS (ALIGNED ENUM)
-- ------------------------------------------------------------

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
    WHERE b.journey_id = p_journey_id AND b.status IN ('confirmed', 'checked_in')
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
    'notified_count', v_notified_count,
    'message', 'Delay logged. ' || v_notified_count || ' confirmed passengers notified.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 8. GRANTS
-- ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN) TO authenticated;

-- Service role execution for authorised server actions
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN) TO service_role;

