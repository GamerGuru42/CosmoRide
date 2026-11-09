-- CosmoRide Migration 00010: Operational Booking Cutoff Validation & Route Corridor Patterns
-- Cosmopolitan University, Nigeria
--
-- Enforces:
-- 1. Strict Validation on Operational System Settings (admin_update_system_setting):
--    - 'booking_cutoff_minutes': strictly bounded as an integer between 0 and 120 minutes.
--      Rejects malformed strings, nulls, negative numbers, or out-of-bounds inputs with 'INVALID_SETTING_VALUE'.
--    - 'booking_window_hours_ahead': bounded as an integer between 1 and 168 hours (advisory display window).
-- 2. Defensive Fallback & Clamping in Seat Booking (book_journey_seat):
--    - Exception-safe extraction of 'booking_cutoff_minutes' from system_settings.
--    - Clamps effective cutoff strictly within [0, 120] minutes with standard 15-minute fallback.
-- 3. Institutional Route Corridors for Confirmed Boys' Journey Patterns:
--    - Pattern 1 (Morning 07:30 via Wuye): BOYS_AM_ROUTE (Main Boys Hostel -> Wuye Boys Hostel -> Main Campus)
--    - Pattern 2 (Morning 08:30 Direct): BOYS_AM_DIRECT (Main Boys Hostel -> Main Campus, no Wuye stop)
--    - Pattern 3 (Evening 16:00 Direct): BOYS_PM_DIRECT (Main Campus -> Main Boys Hostel, no Wuye stop)
--    - Pattern 4 (Evening 16:50/17:00 via Wuye): BOYS_PM_ROUTE (Main Campus -> Wuye Boys Hostel -> Main Boys Hostel)

-- ============================================================
-- 1. HARDENED ADMIN SYSTEM SETTING UPDATE FUNCTION
-- ============================================================

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
  v_val_int INTEGER;
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
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNAUTHORIZED',
        'error', 'Permission denied: Unauthenticated session.'
      );
    END IF;
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'IDENTITY_MISMATCH',
        'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.'
      );
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'MISSING_ACTOR',
        'error', 'Service role execution requires explicit admin actor attribution.'
      );
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = v_effective_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Only administrators can update system settings.'
    );
  END IF;

  -- Operational Validation Rules for Known System Settings
  IF p_key = 'booking_cutoff_minutes' THEN
    IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN ('number', 'string') THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_SETTING_VALUE',
        'error', 'Validation error: booking_cutoff_minutes must be an integer between 0 and 120.'
      );
    END IF;

    BEGIN
      v_val_int := (p_value #>> '{}')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_SETTING_VALUE',
        'error', 'Validation error: booking_cutoff_minutes must be a valid integer.'
      );
    END;

    IF v_val_int < 0 OR v_val_int > 120 THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_SETTING_VALUE',
        'error', 'Validation error: booking_cutoff_minutes must be between 0 and 120 minutes.'
      );
    END IF;

    p_value := to_jsonb(v_val_int);
  ELSIF p_key = 'booking_window_hours_ahead' THEN
    IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN ('number', 'string') THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_SETTING_VALUE',
        'error', 'Validation error: booking_window_hours_ahead must be an integer between 1 and 168.'
      );
    END IF;

    BEGIN
      v_val_int := (p_value #>> '{}')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_SETTING_VALUE',
        'error', 'Validation error: booking_window_hours_ahead must be a valid integer.'
      );
    END;

    IF v_val_int < 1 OR v_val_int > 168 THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_SETTING_VALUE',
        'error', 'Validation error: booking_window_hours_ahead must be between 1 and 168 hours.'
      );
    END IF;

    p_value := to_jsonb(v_val_int);
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

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Setting ' || p_key || ' updated successfully.'
  );
END;
$$;

-- Revoke service_role execution per Migration 00008, allow authenticated admin
REVOKE EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) TO authenticated;

-- ============================================================
-- 2. HARDENED BOOK_JOURNEY_SEAT WITH SAFE CUTOFF CLAMPING
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

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_caller_id,
      'Added to Waiting List',
      'This departure is currently full. You have been placed at position #' || v_waitlist_pos || ' on the waiting list.',
      'waitlist_joined',
      p_journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlist',
      'waitlist_position', v_waitlist_pos,
      'message', 'Bus at safe capacity. You have been added to the waiting list at position #' || v_waitlist_pos || '.'
    );
  END IF;
END;
$$;

-- Enforce strict role execution per Migration 00008: only authenticated users
REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;

-- ============================================================
-- 3. INSTITUTIONAL ROUTE CORRIDORS FOR BOYS' 4 CONFIRMED PATTERNS
-- ============================================================

-- Register Direct Route Corridors (bypassing Wuye stop for express runs)
-- Dynamic registration anchored to transport groups when present
DO $$
DECLARE
  v_boys_group_id UUID;
  v_main_boys_stop_id UUID;
  v_main_campus_stop_id UUID;
  v_am_direct_id UUID;
  v_pm_direct_id UUID;
BEGIN
  -- Lookup boys transport group if seeded
  SELECT id INTO v_boys_group_id FROM public.transport_groups WHERE code = 'MAIN_BOYS_HOSTEL' LIMIT 1;
  SELECT id INTO v_main_boys_stop_id FROM public.stops WHERE name ILIKE '%Main Boys%' LIMIT 1;
  SELECT id INTO v_main_campus_stop_id FROM public.stops WHERE name ILIKE '%Central Bus Park%' OR name ILIKE '%Main Campus%' LIMIT 1;

  -- Only seed route rows if referenced stops/groups exist, avoiding premature FK constraint violations on unseeded databases
  IF v_boys_group_id IS NOT NULL THEN
    INSERT INTO public.routes (name, code, description, gender_group, transport_group_id, is_active)
    VALUES
      (
        'Boys'' Morning Direct (Main Boys'' Hostel to Main Campus)',
        'BOYS_AM_DIRECT',
        'Pattern 2: Morning express 08:30 directly from Main Boys'' Hostel to Main Campus (no Wuye stop)',
        'male',
        v_boys_group_id,
        TRUE
      ),
      (
        'Boys'' Evening Direct (Main Campus to Main Boys'' Hostel)',
        'BOYS_PM_DIRECT',
        'Pattern 3: Evening express 16:00 directly from Main Campus to Main Boys'' Hostel (no Wuye stop)',
        'male',
        v_boys_group_id,
        TRUE
      )
    ON CONFLICT (code) DO NOTHING;

    IF v_main_boys_stop_id IS NOT NULL AND v_main_campus_stop_id IS NOT NULL THEN
      SELECT id INTO v_am_direct_id FROM public.routes WHERE code = 'BOYS_AM_DIRECT';
      SELECT id INTO v_pm_direct_id FROM public.routes WHERE code = 'BOYS_PM_DIRECT';

      IF v_am_direct_id IS NOT NULL THEN
        INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
        VALUES
          (v_am_direct_id, v_main_boys_stop_id, 1, 0),
          (v_am_direct_id, v_main_campus_stop_id, 2, 25)
        ON CONFLICT (route_id, stop_order) DO NOTHING;
      END IF;

      IF v_pm_direct_id IS NOT NULL THEN
        INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
        VALUES
          (v_pm_direct_id, v_main_campus_stop_id, 1, 0),
          (v_pm_direct_id, v_main_boys_stop_id, 2, 25)
        ON CONFLICT (route_id, stop_order) DO NOTHING;
      END IF;
    END IF;
  END IF;
END $$;
