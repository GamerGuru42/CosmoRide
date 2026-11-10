-- ============================================================
-- COSMORIDE DATABASE MIGRATION 00014
-- ELECTRIC BUS SEATING AND STANDING CAPACITY
--
-- Confirmed University Electric Bus Passenger Capacity:
-- - 20 seated passenger places
-- - 10 standing passenger places
-- - 30 passengers maximum total capacity (NOT 30 seats)
--
-- First-Come-First-Served Allocation Rules:
-- - First 20 confirmed passengers receive 'seated'
-- - Next 10 confirmed passengers receive 'standing'
-- - Maximum 30 confirmed passengers per journey
-- - Cancellation of seated place upgrades earliest standing passenger
-- - Waitlist promotion allocates next available category
-- - Checked-in passengers continue counting toward occupied capacity
-- ============================================================

-- ------------------------------------------------------------
-- 1. PASSENGER CATEGORY ENUM & SCHEMA EXTENSIONS
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'passenger_category') THEN
    CREATE TYPE public.passenger_category AS ENUM ('seated', 'standing');
  END IF;
END $$;

-- Add seated and standing capacity fields to vehicles
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS seated_capacity INTEGER NOT NULL DEFAULT 20 CHECK (seated_capacity >= 0),
  ADD COLUMN IF NOT EXISTS standing_capacity INTEGER NOT NULL DEFAULT 10 CHECK (standing_capacity >= 0);

-- Add passenger_category to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS passenger_category public.passenger_category NOT NULL DEFAULT 'seated';

-- Add passenger_category to boarding_records
ALTER TABLE public.boarding_records
  ADD COLUMN IF NOT EXISTS passenger_category public.passenger_category;

-- Index active bookings by journey and passenger category for fast atomic capacity counting
CREATE INDEX IF NOT EXISTS idx_bookings_journey_category_active 
  ON public.bookings (journey_id, passenger_category, status)
  WHERE status IN ('confirmed', 'checked_in');

-- ------------------------------------------------------------
-- 2. HARDENED ATOMIC BOOKING PROCEDURE (book_journey_seat)
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
  v_effective_capacity INTEGER;
  v_max_seated INTEGER;
  v_max_standing INTEGER;
  v_seated_count INTEGER;
  v_standing_count INTEGER;
  v_active_bookings_count INTEGER;
  v_assigned_category public.passenger_category;
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
         v.safe_capacity, v.seated_capacity, v.standing_capacity,
         v.is_active AS vehicle_active, v.registration_number,
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

  -- D. Dynamic Configurable Booking Cutoff Policy (from system_settings) with safe parsing & clamping
  BEGIN
    SELECT (value #>> '{}')::INTEGER
    INTO v_booking_cutoff_mins
    FROM public.system_settings
    WHERE key = 'booking_cutoff_minutes';
  EXCEPTION WHEN OTHERS THEN
    v_booking_cutoff_mins := 15;
  END;

  IF v_booking_cutoff_mins IS NULL OR v_booking_cutoff_mins < 0 THEN
    v_booking_cutoff_mins := 15;
  ELSIF v_booking_cutoff_mins > 120 THEN
    v_booking_cutoff_mins := 120;
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

  -- I. Calculate Safe Approved Capacity Limits (20 Seated, 10 Standing, 30 Total Max)
  IF v_journey.safe_capacity IS NULL OR v_journey.safe_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CAPACITY_NOT_CONFIGURED',
      'error', 'Booking unavailable: Assigned vehicle does not have an approved safe capacity ceiling.'
    );
  END IF;

  -- Total effective physical passenger capacity is bounded by vehicle safe capacity and template allocation
  v_effective_capacity := LEAST(v_journey.safe_capacity, v_journey.proposed_allocation);
  v_max_seated := LEAST(COALESCE(v_journey.seated_capacity, 20), v_effective_capacity);
  v_max_standing := LEAST(COALESCE(v_journey.standing_capacity, 10), v_effective_capacity - v_max_seated);

  -- Count occupied active places (strictly counting both confirmed and checked_in passengers)
  SELECT COUNT(*) INTO v_seated_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in')
    AND passenger_category = 'seated';

  SELECT COUNT(*) INTO v_standing_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in')
    AND passenger_category = 'standing';

  v_active_bookings_count := v_seated_count + v_standing_count;

  -- First-Come-First-Served Allocation:
  -- 1. First 20 receive 'seated'
  -- 2. Next 10 receive 'standing'
  -- 3. 31st and beyond go to waiting list
  IF v_seated_count < v_max_seated THEN
    v_assigned_category := 'seated';
  ELSIF v_standing_count < v_max_standing AND v_active_bookings_count < v_effective_capacity THEN
    v_assigned_category := 'standing';
  ELSE
    v_assigned_category := NULL;
  END IF;

  IF v_assigned_category IS NOT NULL THEN
    -- Issue confirmed booking with assigned category
    v_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    -- Re-activate historical record or insert fresh row
    SELECT id INTO v_booking_id
    FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id;

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
        created_at
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

    -- Clean up any waiting list entry for this student on this journey
    UPDATE public.waitlists
    SET status = 'promoted', promoted_at = now()
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status = 'waiting';

    -- Issue category-specific notification
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

    RETURN jsonb_build_object(
      'success', true,
      'status', 'confirmed',
      'booking_id', v_booking_id,
      'ticket_token', v_ticket_token,
      'passenger_category', v_assigned_category,
      'message', CASE WHEN v_assigned_category = 'seated'
                   THEN 'Seated place confirmed successfully. Boarding pass issued.'
                   ELSE 'Standing place confirmed successfully. Boarding pass issued.'
                 END
    );
  ELSE
    -- Safe Total Capacity Reached (30 passengers: 20 seated + 10 standing): Process Waiting List
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
        'message', 'Bus at full passenger capacity (30 max). You are currently #' || v_waitlist_pos || ' on the waiting list.'
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

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_caller_id,
      'Added to Waiting List',
      'This departure has reached full passenger capacity (30 max). You have been placed at position #' || v_waitlist_pos || ' on the waiting list.',
      'waitlist_joined',
      p_journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlist',
      'waitlist_position', v_waitlist_pos,
      'message', 'Bus at full passenger capacity (30 max). You have been added to the waiting list at position #' || v_waitlist_pos || '.'
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 3. HARDENED CANCEL AND PROMOTE PROCEDURE (cancel_booking_and_promote)
-- ------------------------------------------------------------

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

  v_cancelled_category := v_booking.passenger_category;

  -- 3. Cancel the booking and release allocation
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
  -- If a seated place was cancelled, upgrade the earliest confirmed/checked_in standing passenger to 'seated'
  IF v_cancelled_category = 'seated' THEN
    SELECT id, student_id INTO v_standing_to_upgrade
    FROM public.bookings
    WHERE journey_id = v_booking.journey_id
      AND status IN ('confirmed', 'checked_in')
      AND passenger_category = 'standing'
    ORDER BY booked_at ASC, created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      -- Upgrade standing passenger to seated
      UPDATE public.bookings
      SET passenger_category = 'seated',
          updated_at = now()
      WHERE id = v_standing_to_upgrade.id;

      INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
      VALUES (
        v_standing_to_upgrade.student_id,
        'Booking Upgraded: Seated Place!',
        'A seated place has opened up on your departure! Your booking has been upgraded from standing to seated.',
        'booking_upgraded',
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

      -- The upgraded passenger leaves behind a vacant 'standing' place for the waitlist
      v_promoted_category := 'standing';
    ELSE
      -- No standing passengers existed; vacant place is 'seated'
      v_promoted_category := 'seated';
    END IF;
  ELSE
    -- A standing place was cancelled; vacant place is 'standing'
    v_promoted_category := 'standing';
  END IF;

  -- 5. Promote the top waiting list student into the vacant allocation
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
        created_at
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
    SET status = 'promoted',
        promoted_at = now()
    WHERE id = v_top_waitlist.id;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_top_waitlist.student_id,
      CASE WHEN v_promoted_category = 'seated' THEN 'Waitlist Promoted: Seated Place Confirmed!' ELSE 'Waitlist Promoted: Standing Place Confirmed!' END,
      'A place has opened up on your departure! Your ' || v_promoted_category || ' boarding pass is now active.',
      'waitlist_promoted',
      v_booking.journey_id
    );

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_top_waitlist.student_id,
      'WAITLIST_PROMOTED_TO_BOOKING',
      'booking',
      v_new_booking_id,
      jsonb_build_object('journey_id', v_booking.journey_id, 'passenger_category', v_promoted_category)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Booking cancelled successfully. Place released.',
    'released_category', v_cancelled_category
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 4. HARDENED BOARDING VERIFICATION PROCEDURE (verify_and_board_passenger)
-- ------------------------------------------------------------

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

  -- 8. Safe physical capacity overflow check (Total passengers: 30 max)
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
      checked_in_by = v_effective_officer_id,
      updated_at = now()
  WHERE id = v_booking.id;

  IF v_journey.status = 'scheduled' THEN
    UPDATE public.journeys
    SET status = 'boarding',
        updated_at = now()
    WHERE id = p_journey_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'VALID',
    'message', 'Boarding verified successfully (' || v_booking.passenger_category || ' place).',
    'passenger_name', v_student.full_name,
    'student_id', v_student.student_id,
    'passenger_category', v_booking.passenger_category,
    'boarded_count', v_boarded_count + 1,
    'capacity', v_effective_capacity,
    'bus_registration', v_journey.registration_number
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO authenticated, service_role;

