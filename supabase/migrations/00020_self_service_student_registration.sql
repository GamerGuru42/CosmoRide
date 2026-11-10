-- ============================================================
-- COSMORIDE DATABASE MIGRATION 00020
-- SELF-SERVICE STUDENT REGISTRATION WITH GOOGLE OAUTH
--
-- Requirements:
-- 1. Restrict student registration to approved domain: @cosmopolitan.edu.ng.
-- 2. Link Google Auth identity (auth.users.id) to student profile (public.profiles).
-- 3. Enforce 1-to-1 uniqueness of matriculation numbers at database level.
-- 4. Normalize matriculation numbers consistently (uppercase, trimmed, spaces stripped).
-- 5. Atomic profile completion procedure (complete_student_profile) with row locking.
-- 6. Immutability: Students cannot alter matriculation number once registered.
-- 7. Incomplete student profiles cannot book journey seats (INCOMPLETE_PROFILE).
-- 8. Preserve existing staff/admin authentication and privileges.
-- ============================================================

-- ------------------------------------------------------------
-- 1. UNIQUE INDEX ON NORMALIZED MATRICULATION NUMBER
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_student_id_unique
ON public.profiles (replace(upper(trim(student_id)), ' ', ''))
WHERE student_id IS NOT NULL AND trim(student_id) <> '';

-- ------------------------------------------------------------
-- 2. PROFILE PRIVILEGE PROTECTION (IMMUTABLE MATRIC NUMBER)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role public.user_role;
BEGIN
  v_caller_id := auth.uid();

  -- If called without an auth session (e.g. database admin or service_role), allow
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get caller's verified current role
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  -- 1. Check role change attempt
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'Privilege Escalation Detected: Only administrators can modify user roles.';
    END IF;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_caller_id,
      'USER_ROLE_CHANGED',
      'profile',
      NEW.id,
      jsonb_build_object(
        'old_role', OLD.role,
        'new_role', NEW.role,
        'target_user_id', NEW.id
      )
    );
  END IF;

  -- 2. Check active status change attempt
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'Unauthorized action: Only administrators can activate or deactivate accounts.';
    END IF;
  END IF;

  -- 3. Check transport group reassignment for boarding officers
  IF NEW.assigned_transport_group_id IS DISTINCT FROM OLD.assigned_transport_group_id THEN
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'Unauthorized action: Only administrators can assign transport groups.';
    END IF;
  END IF;

  -- 4. Check matriculation number immutability (students cannot change matric once set)
  IF OLD.student_id IS NOT NULL AND trim(OLD.student_id) <> '' AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'Unauthorized action: Matriculation number cannot be modified once registered. Contact university transport administration.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profile_privilege_protection ON public.profiles;

CREATE TRIGGER enforce_profile_privilege_protection
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- ------------------------------------------------------------
-- 3. ATOMIC STUDENT PROFILE REGISTRATION RPC
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_student_profile(
  p_full_name TEXT,
  p_student_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_id UUID;
  v_jwt_role TEXT;
  v_caller_email TEXT;
  v_trimmed_name TEXT;
  v_normalized_matric TEXT;
  v_existing_profile RECORD;
BEGIN
  -- A. Verify authenticated JWT session
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Authentication required: You must be signed in to complete student registration.'
    );
  END IF;

  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Authentication required: Unauthenticated session.'
    );
  END IF;

  -- B. Retrieve verified email from auth.users (NEVER trust client input)
  SELECT email INTO v_caller_email
  FROM auth.users
  WHERE id = v_caller_id;

  IF v_caller_email IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'USER_NOT_FOUND',
      'error', 'Authenticated user record not found.'
    );
  END IF;

  -- C. Validate domain and resolve caller role
  SELECT * INTO v_existing_profile
  FROM public.profiles
  WHERE id = v_caller_id
  FOR UPDATE;

  -- If not an administrative/staff account, enforce official Cosmopolitan University domain
  IF NOT (FOUND AND v_existing_profile.role IN ('admin', 'boarding_officer', 'driver')) THEN
    IF NOT lower(v_caller_email) LIKE '%@cosmopolitan.edu.ng' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_DOMAIN',
        'error', 'Student registration is restricted to official Cosmopolitan University Google accounts (@cosmopolitan.edu.ng).'
      );
    END IF;
  END IF;

  -- D. Input validation & normalization
  v_trimmed_name := trim(COALESCE(p_full_name, ''));
  IF length(v_trimmed_name) < 2 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_NAME',
      'error', 'Please provide your full legal name (minimum 2 characters).'
    );
  END IF;

  -- Normalize matric: uppercase, trim, strip internal whitespace
  v_normalized_matric := upper(replace(trim(COALESCE(p_student_id, '')), ' ', ''));
  IF length(v_normalized_matric) < 3 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_MATRIC',
      'error', 'Please provide a valid matriculation / student ID number (minimum 3 characters).'
    );
  END IF;

  -- E. Immutability Check: If matric already registered on this profile, prevent change
  IF v_existing_profile.student_id IS NOT NULL AND trim(v_existing_profile.student_id) <> '' THEN
    IF upper(replace(trim(v_existing_profile.student_id), ' ', '')) <> v_normalized_matric THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'MATRIC_IMMUTABLE',
        'error', 'Your matriculation number has already been registered and cannot be altered.'
      );
    ELSE
      -- Same matriculation number: update full name if changed
      UPDATE public.profiles
      SET full_name = v_trimmed_name,
          updated_at = now()
      WHERE id = v_caller_id;

      RETURN jsonb_build_object(
        'success', true,
        'code', 'PROFILE_UPDATED',
        'message', 'Profile updated successfully.',
        'student_id', v_normalized_matric,
        'full_name', v_trimmed_name
      );
    END IF;
  END IF;

  -- F. Atomic duplicate matric check with row locking
  PERFORM 1
  FROM public.profiles
  WHERE replace(upper(trim(student_id)), ' ', '') = v_normalized_matric
    AND id <> v_caller_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_MATRIC',
      'error', 'This matriculation number is already linked to another student account.'
    );
  END IF;

  -- G. Upsert profile record
  IF v_existing_profile.id IS NOT NULL THEN
    UPDATE public.profiles
    SET full_name = v_trimmed_name,
        student_id = v_normalized_matric,
        role = COALESCE(v_existing_profile.role, 'student'),
        updated_at = now()
    WHERE id = v_caller_id;
  ELSE
    INSERT INTO public.profiles (
      id,
      full_name,
      role,
      student_id,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      v_caller_id,
      v_trimmed_name,
      'student',
      v_normalized_matric,
      TRUE,
      now(),
      now()
    );
  END IF;

  -- H. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'STUDENT_SELF_REGISTRATION_COMPLETED',
    'profile',
    v_caller_id,
    jsonb_build_object(
      'full_name', v_trimmed_name,
      'student_id', v_normalized_matric,
      'email', v_caller_email
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'REGISTRATION_SUCCESS',
    'message', 'Student registration complete. Identity successfully linked.',
    'student_id', v_normalized_matric,
    'full_name', v_trimmed_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_student_profile(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_student_profile(TEXT, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. HARDEN book_journey_seat TO REQUIRE COMPLETED PROFILE
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
      'error', 'Identity mismatch: Authenticated user cannot book seats on behalf of another student.'
    );
  END IF;

  v_caller_id := auth.uid();

  -- B. Fetch verified student profile with hostel and transport group context
  SELECT p.id, p.full_name, p.role, p.is_active, p.hostel_id, p.assigned_transport_group_id, p.student_id,
         h.gender AS hostel_gender, h.transport_group_id AS hostel_transport_group_id, h.name AS hostel_name
  INTO v_student
  FROM public.profiles p
  LEFT JOIN public.hostels h ON h.id = p.hostel_id
  WHERE p.id = v_caller_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'STUDENT_NOT_FOUND',
      'error', 'Student profile does not exist.'
    );
  END IF;

  IF v_student.role <> 'student' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN_ROLE',
      'error', 'Permission denied: Only registered students may reserve passenger places.'
    );
  END IF;

  IF NOT v_student.is_active THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ACCOUNT_SUSPENDED',
      'error', 'Student transport account is deactivated. Contact the transport administrator.'
    );
  END IF;

  -- Profile completeness check (must have full name and matriculation number)
  IF v_student.student_id IS NULL OR trim(v_student.student_id) = '' OR v_student.full_name IS NULL OR trim(v_student.full_name) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INCOMPLETE_PROFILE',
      'error', 'Profile incomplete: You must complete your student registration with your full name and matriculation number before booking journeys.'
    );
  END IF;

  -- C. Lock Journey Record & Resolve Vehicle Physical Capacity (20 seated + 12 standing = 32 total)
  SELECT j.*, r.name AS route_name, r.code AS route_code,
         r.gender_group AS route_gender, r.transport_group_id AS route_transport_group_id,
         v.safe_capacity, v.seated_capacity, v.standing_capacity, v.registration_number AS vehicle_registration
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
      'error', 'Journey not found.'
    );
  END IF;

  IF v_journey.status <> 'scheduled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_JOURNEY_STATUS',
      'error', 'Booking unavailable: Journey is not open for reservations (status: ' || v_journey.status || ').'
    );
  END IF;

  -- D. Dynamic System Setting Booking Cutoff Enforcement
  BEGIN
    SELECT COALESCE((value)::text::integer, 15)
    INTO v_booking_cutoff_mins
    FROM public.system_settings
    WHERE key = 'booking_cutoff_minutes';
  EXCEPTION WHEN OTHERS THEN
    v_booking_cutoff_mins := 15;
  END;

  IF v_booking_cutoff_mins IS NULL THEN
    v_booking_cutoff_mins := 15;
  END IF;

  IF v_journey.scheduled_departure <= (now() + (v_booking_cutoff_mins || ' minutes')::interval) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BOOKING_CUTOFF_EXCEEDED',
      'error', 'Booking closed: Departure is within the ' || v_booking_cutoff_mins || '-minute cutoff window.'
    );
  END IF;

  -- E. Route Stop Validity Check
  IF p_boarding_stop_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.route_stops
      WHERE route_id = v_journey.route_id
        AND stop_id = p_boarding_stop_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_BOARDING_STOP',
        'error', 'Selected pickup stop is not valid for this route.'
      );
    END IF;
  END IF;

  -- F. Gender Segregation Check
  v_effective_student_gender := v_student.hostel_gender;

  IF v_journey.route_gender IN ('male', 'female') THEN
    IF v_effective_student_gender IS NOT NULL AND v_effective_student_gender <> v_journey.route_gender THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GENDER_DENIED',
        'error', 'Gender Policy Restriction: This departure is designated exclusively for ' || v_journey.route_gender || ' students.'
      );
    END IF;
  END IF;

  -- G. Transport Group Boundary Check
  v_effective_student_group := COALESCE(v_student.assigned_transport_group_id, v_student.hostel_transport_group_id);

  IF v_journey.route_transport_group_id IS NOT NULL THEN
    IF v_effective_student_group IS NULL OR v_effective_student_group <> v_journey.route_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Transport group restriction: You are not assigned to this transport operation.'
      );
    END IF;
  END IF;

  -- H. Duplicate Booking / Waitlist Prevention
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'DUPLICATE_BOOKING',
      'error', 'You already have a confirmed booking on this departure.'
    );
  END IF;

  -- I. Calculate Approved Passenger Capacity (20 seated + 12 standing = 32 total)
  IF v_journey.safe_capacity IS NULL AND v_journey.proposed_allocation IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNVERIFIED_VEHICLE_CAPACITY',
      'error', 'Operation suspended: Vehicle physical safe capacity has not been certified by transport administration.'
    );
  END IF;

  v_effective_capacity := LEAST(
    COALESCE(v_journey.safe_capacity, v_journey.proposed_allocation),
    COALESCE(v_journey.proposed_allocation, v_journey.safe_capacity)
  );

  v_max_seated := LEAST(COALESCE(v_journey.seated_capacity, 20), v_effective_capacity);
  v_max_standing := LEAST(COALESCE(v_journey.standing_capacity, 12), v_effective_capacity - v_max_seated);

  -- Count currently active confirmed & checked-in passengers
  SELECT
    COUNT(*) FILTER (WHERE passenger_category = 'seated'),
    COUNT(*) FILTER (WHERE passenger_category = 'standing'),
    COUNT(*)
  INTO v_seated_count, v_standing_count, v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in');

  -- J. First-Come-First-Served Allocation Logic
  IF v_active_bookings_count < v_effective_capacity THEN
    IF v_seated_count < v_max_seated THEN
      v_assigned_category := 'seated';
    ELSIF v_standing_count < v_max_standing THEN
      v_assigned_category := 'standing';
    ELSE
      v_assigned_category := 'standing';
    END IF;

    -- Generate secure 48-char hex ticket token
    v_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    -- Insert or update confirmed booking
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

    -- Delete any existing waitlist entry for this student on this journey
    DELETE FROM public.waitlists
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id;

    -- Audit log
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_caller_id,
      'SEAT_BOOKED_ATOMIC',
      'booking',
      v_booking_id,
      jsonb_build_object(
        'journey_id', p_journey_id,
        'passenger_category', v_assigned_category,
        'active_bookings_after', v_active_bookings_count + 1,
        'seated_count_after', CASE WHEN v_assigned_category = 'seated' THEN v_seated_count + 1 ELSE v_seated_count END,
        'standing_count_after', CASE WHEN v_assigned_category = 'standing' THEN v_standing_count + 1 ELSE v_standing_count END,
        'effective_capacity', v_effective_capacity
      )
    );

    -- Notification
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
      'booking_id', v_booking_id,
      'ticket_token', v_ticket_token,
      'passenger_category', v_assigned_category,
      'status', 'confirmed',
      'message', CASE
        WHEN v_assigned_category = 'seated' THEN 'Seated passenger place reserved successfully.'
        ELSE 'Standing passenger place reserved successfully (20 seats full).'
      END
    );

  ELSE
    -- K. Capacity Ceiling Reached: Safe Automatic Waitlisting
    IF EXISTS (
      SELECT 1 FROM public.waitlists
      WHERE journey_id = p_journey_id
        AND student_id = v_caller_id
        AND status = 'waiting'
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'ALREADY_WAITLISTED',
        'error', 'You are already on the waiting list for this departure.'
      );
    END IF;

    SELECT COALESCE(MAX(position), 0) + 1
    INTO v_waitlist_pos
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
      'This departure has reached full passenger capacity (32 max). You have been placed at position #' || v_waitlist_pos || ' on the waiting list.',
      'announcement'::public.notification_type,
      p_journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlist',
      'waitlist_position', v_waitlist_pos,
      'message', 'Bus at full passenger capacity (32 max). You have been added to the waiting list at position #' || v_waitlist_pos || '.'
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;
