-- CosmoRide Migration 00023: Consolidated Release-Blocker Remediation
-- Cosmopolitan University, Nigeria
--
-- Remediates remaining verified database, authorization, capacity, and workflow blockers:
-- 1. Removes unsafe legacy overloaded functions:
--      - public.cancel_booking_and_promote(UUID, UUID)
--      - public.close_and_depart_journey(UUID, UUID, BOOLEAN, TEXT)
-- 2. Enforces active-account checks (profiles.is_active = TRUE) in RLS helpers and own-row policies.
-- 3. Replaces broad legacy SELECT/INSERT policies on vehicle_readiness_checks,
--    journey_stop_updates, and journey_operational_logs with scoped SELECT access
--    and RPC-only mutation paths.
-- 4. Closes actor/profile validation gaps in admin_create_journey, check_driver_assignment_conflict,
--    complete_student_profile, select_student_hostel, cancel_booking_and_promote, and cancel_waitlist_entry.
-- 5. Strictly bounds capacity (20 seated + 12 standing = 32 max capped by positive safe_capacity)
--    across book_journey_seat and verify_and_board_passenger.
-- 6. Enforces strict Stage 7 dispatch & cancellation governance (super_admin and bus_manager only),
--    prevents Stage 7 bypass via close_and_depart_journey, and isolates Mode B assisted departure
--    recording in record_journey_departure_safe to non-smartphone drivers (has_app_access = FALSE).
-- 7. Adds least-privilege RPCs for student departure occupancy, incident reporting,
--    user activation governance, recurring schedule edits/toggles, and Mode A driver profile linking.
-- 8. Audits and revokes PUBLIC/anon EXECUTE privileges across all public functions and locks down
--    default function privileges for future schema objects.

-- ============================================================================
-- 1. DROP UNSAFE LEGACY FUNCTION OVERLOADS
-- ============================================================================

DROP FUNCTION IF EXISTS public.cancel_booking_and_promote(UUID, UUID);
DROP FUNCTION IF EXISTS public.close_and_depart_journey(UUID, UUID, BOOLEAN, TEXT);

-- ============================================================================
-- 2. HARDEN RLS HELPERS FOR ACTIVE-ACCOUNT ENFORCEMENT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rls_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p.is_active IS TRUE THEN p.role
    ELSE NULL
  END
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.rls_driver_assigned_to_journey(p_journey_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.journeys j ON j.id = p_journey_id
    LEFT JOIN public.drivers d ON d.id = j.driver_record_id
    WHERE p.id = auth.uid()
      AND p.role = 'driver'
      AND p.is_active IS TRUE
      AND (
        j.driver_id = auth.uid()
        OR d.profile_id = auth.uid()
      )
  );
$$;

-- ============================================================================
-- 3. HARDEN OWN-ROW & OPERATIONAL TELEMETRY RLS POLICIES
-- ============================================================================

-- ---- A. OWN-ROW ACTIVE-ACCOUNT GATES ----
DROP POLICY IF EXISTS "Users can update own non-privileged profile" ON public.profiles;
CREATE POLICY "Users can update own non-privileged profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()) AND public.rls_user_is_active())
  WITH CHECK (id = (SELECT auth.uid()) AND public.rls_user_is_active());

DROP POLICY IF EXISTS "Students can view own bookings" ON public.bookings;
CREATE POLICY "Students can view own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (student_id = (SELECT auth.uid()) AND public.rls_user_is_active());

DROP POLICY IF EXISTS "Students can view own waitlist status" ON public.waitlists;
CREATE POLICY "Students can view own waitlist status"
  ON public.waitlists FOR SELECT
  TO authenticated
  USING (student_id = (SELECT auth.uid()) AND public.rls_user_is_active());

DROP POLICY IF EXISTS "Students can view own boarding records" ON public.boarding_records;
CREATE POLICY "Students can view own boarding records"
  ON public.boarding_records FOR SELECT
  TO authenticated
  USING (student_id = (SELECT auth.uid()) AND public.rls_user_is_active());

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.rls_user_is_active());

DROP POLICY IF EXISTS "Users can mark own notifications as read" ON public.notifications;
CREATE POLICY "Users can mark own notifications as read"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.rls_user_is_active())
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.rls_user_is_active());

-- ---- B. VEHICLE READINESS CHECKS (SCOPED SELECT ONLY, RPC WRITES ONLY) ----
DROP POLICY IF EXISTS "Authenticated users can view readiness checks" ON public.vehicle_readiness_checks;
DROP POLICY IF EXISTS "Staff can insert readiness checks" ON public.vehicle_readiness_checks;
DROP POLICY IF EXISTS "Operational staff can view readiness checks" ON public.vehicle_readiness_checks;

CREATE POLICY "Operational staff can view readiness checks"
  ON public.vehicle_readiness_checks FOR SELECT
  TO authenticated
  USING (
    public.rls_user_is_active()
    AND (
      public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager')
      OR (
        public.rls_user_role() = 'boarding_officer'
        AND public.rls_assigned_transport_group() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.journeys j
          JOIN public.routes r ON r.id = j.route_id
          WHERE j.id = vehicle_readiness_checks.journey_id
            AND r.transport_group_id = public.rls_assigned_transport_group()
        )
      )
      OR (
        public.rls_user_role() = 'driver'
        AND public.rls_driver_assigned_to_journey(journey_id)
      )
    )
  );

-- ---- C. JOURNEY STOP UPDATES (SCOPED SELECT ONLY, RPC WRITES ONLY) ----
DROP POLICY IF EXISTS "Authenticated users can view stop updates" ON public.journey_stop_updates;
DROP POLICY IF EXISTS "Staff can insert stop updates" ON public.journey_stop_updates;
DROP POLICY IF EXISTS "Operational staff can view stop updates" ON public.journey_stop_updates;

CREATE POLICY "Operational staff can view stop updates"
  ON public.journey_stop_updates FOR SELECT
  TO authenticated
  USING (
    public.rls_user_is_active()
    AND (
      public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager')
      OR (
        public.rls_user_role() = 'boarding_officer'
        AND public.rls_assigned_transport_group() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.journeys j
          JOIN public.routes r ON r.id = j.route_id
          WHERE j.id = journey_stop_updates.journey_id
            AND r.transport_group_id = public.rls_assigned_transport_group()
        )
      )
      OR (
        public.rls_user_role() = 'driver'
        AND public.rls_driver_assigned_to_journey(journey_id)
      )
    )
  );

-- ---- D. JOURNEY OPERATIONAL LOGS (SCOPED SELECT ONLY, RPC WRITES ONLY) ----
DROP POLICY IF EXISTS "Staff can view operational logs" ON public.journey_operational_logs;
DROP POLICY IF EXISTS "Staff can insert operational logs" ON public.journey_operational_logs;
DROP POLICY IF EXISTS "Operational staff can view operational logs" ON public.journey_operational_logs;

CREATE POLICY "Operational staff can view operational logs"
  ON public.journey_operational_logs FOR SELECT
  TO authenticated
  USING (
    public.rls_user_is_active()
    AND (
      public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager')
      OR (
        public.rls_user_role() = 'boarding_officer'
        AND public.rls_assigned_transport_group() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.journeys j
          JOIN public.routes r ON r.id = j.route_id
          WHERE j.id = journey_operational_logs.journey_id
            AND r.transport_group_id = public.rls_assigned_transport_group()
        )
      )
      OR (
        public.rls_user_role() = 'driver'
        AND public.rls_driver_assigned_to_journey(journey_id)
      )
    )
  );

-- ============================================================================
-- 4. DRIVER LINK VALIDATION & ADMIN JOURNEY CREATION ACTOR ENFORCEMENT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_driver_assignment_conflict(
  p_driver_record_id UUID,
  p_driver_id UUID,
  p_journey_date DATE,
  p_scheduled_departure TIMESTAMPTZ,
  p_exclude_journey_id UUID DEFAULT NULL,
  p_route_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver RECORD;
  v_profile RECORD;
  v_resolved_driver_record_id UUID := p_driver_record_id;
  v_resolved_profile_id UUID := p_driver_id;
  v_new_duration_minutes INTEGER;
  v_cand RECORD;
  v_existing_start TIMESTAMPTZ;
  v_existing_end TIMESTAMPTZ;
  v_new_end TIMESTAMPTZ;
  v_jwt_role TEXT;
  v_caller_ok BOOLEAN := FALSE;
BEGIN
  IF pg_catalog.pg_trigger_depth() = 0 THEN
    v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
      RETURN jsonb_build_object('has_conflict', true, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
    END IF;

    IF v_jwt_role = 'authenticated' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.is_active IS TRUE
          AND p.role = 'admin'
          AND p.admin_role IN ('super_admin', 'bus_manager')
      ) INTO v_caller_ok;

      IF auth.uid() IS NULL OR NOT v_caller_ok THEN
        RETURN jsonb_build_object('has_conflict', true, 'code', 'FORBIDDEN', 'error', 'Permission denied: Admin scheduling privileges required.');
      END IF;
    END IF;
  END IF;

  IF v_resolved_driver_record_id IS NULL AND v_resolved_profile_id IS NULL THEN
    RETURN jsonb_build_object('has_conflict', false, 'code', 'NO_DRIVER_SPECIFIED');
  END IF;

  IF v_resolved_driver_record_id IS NOT NULL THEN
    SELECT * INTO v_driver
    FROM public.drivers
    WHERE id = v_resolved_driver_record_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('has_conflict', true, 'code', 'DRIVER_NOT_FOUND', 'error', 'Assigned driver record not found.');
    END IF;

    IF v_driver.status <> 'active' THEN
      RETURN jsonb_build_object('has_conflict', true, 'code', 'DRIVER_UNAVAILABLE', 'error', 'Driver ' || v_driver.full_name || ' is currently "' || v_driver.status || '" and cannot be assigned.');
    END IF;

    IF v_resolved_profile_id IS NOT NULL AND v_driver.profile_id IS NOT NULL AND v_resolved_profile_id <> v_driver.profile_id THEN
      RETURN jsonb_build_object('has_conflict', true, 'code', 'DRIVER_PROFILE_MISMATCH', 'error', 'Driver profile does not match selected driver record.');
    END IF;

    v_resolved_profile_id := COALESCE(v_resolved_profile_id, v_driver.profile_id);

    -- Enforce valid active Mode A driver profile when linked to a user account
    IF v_resolved_profile_id IS NOT NULL THEN
      SELECT * INTO v_profile
      FROM public.profiles
      WHERE id = v_resolved_profile_id;

      IF NOT FOUND OR v_profile.role <> 'driver' OR v_profile.is_active IS NOT TRUE THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'DRIVER_UNAVAILABLE',
          'error', 'Linked driver account is missing, inactive, or does not hold driver privileges.'
        );
      END IF;
    END IF;
  ELSIF v_resolved_profile_id IS NOT NULL THEN
    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_resolved_profile_id;

    IF NOT FOUND OR v_profile.role <> 'driver' OR v_profile.is_active IS NOT TRUE THEN
      RETURN jsonb_build_object('has_conflict', true, 'code', 'DRIVER_UNAVAILABLE', 'error', 'Assigned driver user account is missing, inactive, or not a driver.');
    END IF;

    SELECT * INTO v_driver
    FROM public.drivers
    WHERE profile_id = v_resolved_profile_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_driver.status <> 'active' THEN
        RETURN jsonb_build_object('has_conflict', true, 'code', 'DRIVER_UNAVAILABLE', 'error', 'Driver ' || v_driver.full_name || ' is currently "' || v_driver.status || '".');
      END IF;
      v_resolved_driver_record_id := v_driver.id;
    END IF;
  END IF;

  IF p_route_id IS NOT NULL THEN
    v_new_duration_minutes := public.resolve_route_duration_minutes(p_route_id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journeys j
    WHERE (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
      AND j.status IN ('bus_arrived', 'boarding', 'boarding_closed', 'ready_to_depart', 'in_transit')
      AND (
        (v_resolved_driver_record_id IS NOT NULL AND j.driver_record_id = v_resolved_driver_record_id)
        OR (v_resolved_profile_id IS NOT NULL AND j.driver_id = v_resolved_profile_id)
      )
  ) THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'DRIVER_CURRENTLY_ACTIVE',
      'error', 'Driver is currently assigned to an active uncompleted journey.'
    );
  END IF;

  FOR v_cand IN
    SELECT
      j.id,
      j.journey_date,
      j.scheduled_departure,
      j.delay_minutes,
      j.actual_departure,
      j.actual_arrival,
      j.status,
      r.name AS route_name,
      public.resolve_route_duration_minutes(j.route_id) AS duration_minutes
    FROM public.journeys j
    JOIN public.routes r ON r.id = j.route_id
    WHERE (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
      AND j.status IN ('scheduled', 'completed')
      AND (
        (v_resolved_driver_record_id IS NOT NULL AND j.driver_record_id = v_resolved_driver_record_id)
        OR (v_resolved_profile_id IS NOT NULL AND j.driver_id = v_resolved_profile_id)
      )
      AND (
        j.journey_date = p_journey_date
        OR j.scheduled_departure BETWEEN (p_scheduled_departure - INTERVAL '24 hours') AND (p_scheduled_departure + INTERVAL '24 hours')
      )
    ORDER BY j.scheduled_departure ASC
  LOOP
    v_existing_start := CASE
      WHEN v_cand.status = 'completed' AND v_cand.actual_departure IS NOT NULL THEN v_cand.actual_departure
      ELSE v_cand.scheduled_departure + (COALESCE(v_cand.delay_minutes, 0) * INTERVAL '1 minute')
    END;

    IF ABS(EXTRACT(EPOCH FROM (v_existing_start - p_scheduled_departure))) < 60 THEN
      RETURN jsonb_build_object(
        'has_conflict', true,
        'code', 'DRIVER_TIME_CONFLICT',
        'error', 'Driver is already assigned to "' || v_cand.route_name || '" at ' || to_char(v_existing_start AT TIME ZONE 'Africa/Lagos', 'HH24:MI') || ' WAT.'
      );
    END IF;

    IF v_existing_start <= p_scheduled_departure THEN
      IF v_cand.status = 'completed' AND v_cand.actual_arrival IS NOT NULL THEN
        v_existing_end := v_cand.actual_arrival;
      ELSIF v_cand.duration_minutes IS NOT NULL AND v_cand.duration_minutes > 0 THEN
        v_existing_end := v_existing_start + (v_cand.duration_minutes * INTERVAL '1 minute');
      ELSE
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'DRIVER_SAME_DAY_UNVERIFIED_RETURN',
          'error', 'Driver has an earlier "' || v_cand.route_name || '" assignment on ' || v_cand.journey_date || ' with no configured route duration.'
        );
      END IF;

      IF p_scheduled_departure < (v_existing_end + INTERVAL '15 minutes') THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'DRIVER_OVERLAP_CONFLICT',
          'error', 'Driver will not complete the earlier "' || v_cand.route_name || '" trip + 15m turnaround buffer before this departure.'
        );
      END IF;
    ELSE
      IF v_new_duration_minutes IS NOT NULL AND v_new_duration_minutes > 0 THEN
        v_new_end := p_scheduled_departure + (v_new_duration_minutes * INTERVAL '1 minute');
        IF (v_new_end + INTERVAL '15 minutes') > v_existing_start THEN
          RETURN jsonb_build_object(
            'has_conflict', true,
            'code', 'DRIVER_OVERLAP_CONFLICT',
            'error', 'This departure would overrun into the driver''s next "' || v_cand.route_name || '" assignment.'
          );
        END IF;
      ELSE
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'DRIVER_SAME_DAY_UNVERIFIED_RETURN',
          'error', 'Driver has a later "' || v_cand.route_name || '" trip on ' || v_cand.journey_date || ', and this route lacks an estimated duration.'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'has_conflict', false,
    'code', 'DRIVER_AVAILABLE',
    'resolved_driver_record_id', v_resolved_driver_record_id,
    'resolved_driver_id', v_resolved_profile_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_journey(
  p_admin_id UUID,
  p_route_id UUID,
  p_vehicle_id UUID,
  p_driver_id UUID DEFAULT NULL,
  p_driver_record_id UUID DEFAULT NULL,
  p_journey_date DATE DEFAULT NULL,
  p_scheduled_departure TIMESTAMPTZ DEFAULT NULL,
  p_proposed_allocation INTEGER DEFAULT 32,
  p_schedule_id UUID DEFAULT NULL
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
  v_route RECORD;
  v_conflict JSONB;
  v_driver_check JSONB;
  v_safe_capacity INTEGER;
  v_effective_alloc INTEGER;
  v_journey_id UUID;
  v_resolved_driver_id UUID := p_driver_id;
  v_resolved_driver_record_id UUID := p_driver_record_id;
  v_effective_date DATE;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another actor.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit admin attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only Super Administrators or the Bus Manager may create or dispatch journeys.');
  END IF;

  IF p_scheduled_departure IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DEPARTURE', 'error', 'Scheduled departure timestamp is required.');
  END IF;

  IF p_proposed_allocation IS NOT NULL AND p_proposed_allocation <= 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_ALLOCATION', 'error', 'Proposed seat allocation must be greater than zero.');
  END IF;

  v_effective_date := COALESCE(p_journey_date, (p_scheduled_departure AT TIME ZONE 'Africa/Lagos')::DATE);

  SELECT * INTO v_route
  FROM public.routes
  WHERE id = p_route_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ROUTE_NOT_FOUND', 'error', 'Active route not found.');
  END IF;

  v_conflict := public.check_vehicle_assignment_conflict(
    p_vehicle_id,
    v_effective_date,
    p_scheduled_departure,
    NULL,
    p_route_id
  );

  IF COALESCE((v_conflict ->> 'has_conflict')::BOOLEAN, TRUE) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', COALESCE(v_conflict ->> 'code', 'ASSIGNMENT_CONFLICT'),
      'error', COALESCE(v_conflict ->> 'error', 'Vehicle conflict prevents journey creation.')
    );
  END IF;

  v_safe_capacity := NULLIF(v_conflict ->> 'safe_capacity', '')::INTEGER;
  IF v_safe_capacity IS NULL OR v_safe_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNVERIFIED_VEHICLE_CAPACITY',
      'error', 'Selected vehicle does not have a positive certified safe capacity.'
    );
  END IF;

  IF v_resolved_driver_record_id IS NOT NULL OR v_resolved_driver_id IS NOT NULL THEN
    v_driver_check := public.check_driver_assignment_conflict(
      v_resolved_driver_record_id,
      v_resolved_driver_id,
      v_effective_date,
      p_scheduled_departure,
      NULL,
      p_route_id
    );

    IF COALESCE((v_driver_check ->> 'has_conflict')::BOOLEAN, TRUE) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', COALESCE(v_driver_check ->> 'code', 'DRIVER_ASSIGNMENT_CONFLICT'),
        'error', COALESCE(v_driver_check ->> 'error', 'Driver conflict prevents journey creation.')
      );
    END IF;

    v_resolved_driver_record_id := COALESCE(
      NULLIF(v_driver_check ->> 'resolved_driver_record_id', '')::UUID,
      v_resolved_driver_record_id
    );
    v_resolved_driver_id := COALESCE(
      NULLIF(v_driver_check ->> 'resolved_driver_id', '')::UUID,
      v_resolved_driver_id
    );
  END IF;

  v_effective_alloc := LEAST(
    COALESCE(p_proposed_allocation, v_safe_capacity),
    v_safe_capacity,
    32
  );

  INSERT INTO public.journeys (
    schedule_id,
    route_id,
    vehicle_id,
    driver_id,
    driver_record_id,
    journey_date,
    scheduled_departure,
    latest_permitted_departure,
    proposed_allocation,
    status,
    created_by
  )
  VALUES (
    p_schedule_id,
    p_route_id,
    p_vehicle_id,
    v_resolved_driver_id,
    v_resolved_driver_record_id,
    v_effective_date,
    p_scheduled_departure,
    p_scheduled_departure,
    v_effective_alloc,
    'scheduled',
    v_effective_admin_id
  )
  RETURNING id INTO v_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    'ADMIN_JOURNEY_CREATED',
    'journey',
    v_journey_id,
    jsonb_build_object(
      'route_id', p_route_id,
      'vehicle_id', p_vehicle_id,
      'driver_record_id', v_resolved_driver_record_id,
      'driver_id', v_resolved_driver_id,
      'journey_date', v_effective_date,
      'scheduled_departure', p_scheduled_departure,
      'effective_allocation', v_effective_alloc
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'journey_id', v_journey_id,
    'message', 'Journey created and vehicle assigned safely.'
  );
END;
$$;

-- ============================================================================
-- 5. STUDENT RPC ACTIVE-ACCOUNT & STRICT CAPACITY ENFORCEMENT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_student_profile(
  p_full_name TEXT,
  p_student_id TEXT,
  p_hostel_id UUID DEFAULT NULL
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
  v_hostel RECORD;
  v_next_hostel_id UUID;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required: You must be signed in to complete student registration.');
  END IF;

  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required: Unauthenticated session.');
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
  IF v_caller_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'USER_NOT_FOUND', 'error', 'Authenticated user record not found.');
  END IF;

  SELECT * INTO v_existing_profile
  FROM public.profiles
  WHERE id = v_caller_id
  FOR UPDATE;

  IF FOUND AND v_existing_profile.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'error', 'Your account is currently suspended.');
  END IF;

  IF NOT (FOUND AND v_existing_profile.role IN ('admin', 'boarding_officer', 'driver')) THEN
    IF NOT lower(v_caller_email) LIKE '%@cosmopolitan.edu.ng' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_DOMAIN',
        'error', 'Student registration is restricted to official Cosmopolitan University Google accounts (@cosmopolitan.edu.ng).'
      );
    END IF;
  END IF;

  v_trimmed_name := trim(COALESCE(p_full_name, ''));
  IF length(v_trimmed_name) < 2 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_NAME', 'error', 'Please provide your full legal name (minimum 2 characters).');
  END IF;

  v_normalized_matric := upper(replace(trim(COALESCE(p_student_id, '')), ' ', ''));
  IF length(v_normalized_matric) < 3 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_MATRIC', 'error', 'Please provide a valid matriculation / student ID number (minimum 3 characters).');
  END IF;

  IF p_hostel_id IS NOT NULL THEN
    SELECT * INTO v_hostel
    FROM public.hostels
    WHERE id = p_hostel_id AND is_active = TRUE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_HOSTEL', 'error', 'Selected university hostel was not found or is inactive.');
    END IF;

    IF v_existing_profile.hostel_id IS NOT NULL AND v_existing_profile.hostel_id <> p_hostel_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'HOSTEL_IMMUTABLE', 'error', 'Your assigned hostel cannot be changed directly. Contact transport administration for hostel updates.');
    END IF;

    v_next_hostel_id := p_hostel_id;
  ELSE
    v_next_hostel_id := v_existing_profile.hostel_id;
  END IF;

  IF v_existing_profile.student_id IS NOT NULL AND trim(v_existing_profile.student_id) <> '' THEN
    IF upper(replace(trim(v_existing_profile.student_id), ' ', '')) <> v_normalized_matric THEN
      RETURN jsonb_build_object('success', false, 'code', 'MATRIC_IMMUTABLE', 'error', 'Your matriculation number has already been registered and cannot be altered.');
    END IF;

    PERFORM pg_catalog.set_config('cosmoride.internal_student_onboarding', 'on', true);
    UPDATE public.profiles
    SET full_name = v_trimmed_name,
        hostel_id = v_next_hostel_id,
        updated_at = now()
    WHERE id = v_caller_id;
    PERFORM pg_catalog.set_config('cosmoride.internal_student_onboarding', 'off', true);

    RETURN jsonb_build_object(
      'success', true,
      'code', 'PROFILE_UPDATED',
      'message', 'Profile updated successfully.',
      'student_id', v_normalized_matric,
      'full_name', v_trimmed_name,
      'hostel_id', v_next_hostel_id
    );
  END IF;

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

  PERFORM pg_catalog.set_config('cosmoride.internal_student_onboarding', 'on', true);
  IF v_existing_profile.id IS NOT NULL THEN
    UPDATE public.profiles
    SET full_name = v_trimmed_name,
        student_id = v_normalized_matric,
        hostel_id = v_next_hostel_id,
        role = COALESCE(v_existing_profile.role, 'student'),
        updated_at = now()
    WHERE id = v_caller_id;
  ELSE
    INSERT INTO public.profiles (
      id,
      full_name,
      role,
      student_id,
      hostel_id,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      v_caller_id,
      v_trimmed_name,
      'student',
      v_normalized_matric,
      v_next_hostel_id,
      TRUE,
      now(),
      now()
    );
  END IF;
  PERFORM pg_catalog.set_config('cosmoride.internal_student_onboarding', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'STUDENT_SELF_REGISTRATION_COMPLETED',
    'profile',
    v_caller_id,
    jsonb_build_object(
      'full_name', v_trimmed_name,
      'student_id', v_normalized_matric,
      'hostel_id', v_next_hostel_id,
      'email', v_caller_email
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'REGISTRATION_SUCCESS',
    'message', 'Student registration complete. Identity successfully linked.',
    'student_id', v_normalized_matric,
    'full_name', v_trimmed_name,
    'hostel_id', v_next_hostel_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.select_student_hostel(
  p_hostel_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT;
  v_caller_id UUID;
  v_profile RECORD;
  v_hostel RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' OR auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;
  v_caller_id := auth.uid();

  IF p_hostel_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_HOSTEL', 'error', 'Please choose a valid active university hostel.');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller_id FOR UPDATE;
  IF NOT FOUND OR v_profile.role <> 'student' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Hostel selection is restricted to student accounts.');
  END IF;

  IF v_profile.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'error', 'Your account is currently suspended.');
  END IF;

  IF v_profile.hostel_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'HOSTEL_IMMUTABLE', 'error', 'Your hostel assignment is already set. Contact transport administration to change hostels.');
  END IF;

  SELECT * INTO v_hostel FROM public.hostels WHERE id = p_hostel_id AND is_active = TRUE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_HOSTEL', 'error', 'Selected university hostel does not exist or is inactive.');
  END IF;

  PERFORM pg_catalog.set_config('cosmoride.internal_student_onboarding', 'on', true);
  UPDATE public.profiles
  SET hostel_id = p_hostel_id,
      updated_at = now()
  WHERE id = v_caller_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_student_onboarding', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_caller_id,
    'STUDENT_HOSTEL_LINKED',
    'profile',
    v_caller_id,
    jsonb_build_object('hostel_id', p_hostel_id, 'hostel_name', v_hostel.name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'hostel_id', p_hostel_id,
    'hostel_name', v_hostel.name,
    'message', 'University hostel linked to your profile successfully.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.book_journey_seat(
  p_journey_id UUID,
  p_student_id UUID,
  p_boarding_stop_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT;
  v_caller_id UUID;
  v_student RECORD;
  v_journey RECORD;
  v_booking_cutoff_mins INTEGER := 15;
  v_effective_student_gender public.gender;
  v_effective_student_group UUID;
  v_effective_capacity INTEGER;
  v_max_seated INTEGER;
  v_max_standing INTEGER;
  v_seated_count INTEGER := 0;
  v_standing_count INTEGER := 0;
  v_active_bookings_count INTEGER := 0;
  v_assigned_category public.passenger_category;
  v_ticket_token TEXT;
  v_booking_id UUID;
  v_existing_waitlist_id UUID;
  v_waitlist_pos INTEGER;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' OR auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required to book a bus seat.');
  END IF;

  IF p_student_id IS NOT NULL AND p_student_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Authenticated user cannot book on behalf of another student.');
  END IF;
  v_caller_id := auth.uid();

  SELECT p.*, h.gender AS hostel_gender, h.transport_group_id AS hostel_transport_group_id
  INTO v_student
  FROM public.profiles p
  LEFT JOIN public.hostels h ON h.id = p.hostel_id
  WHERE p.id = v_caller_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'PROFILE_NOT_FOUND', 'error', 'Student profile not found.');
  END IF;

  IF v_student.role <> 'student' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Only registered students can reserve seats.');
  END IF;

  IF v_student.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'error', 'Your account is currently suspended.');
  END IF;

  IF v_student.student_id IS NULL OR trim(v_student.student_id) = '' OR v_student.full_name IS NULL OR trim(v_student.full_name) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INCOMPLETE_PROFILE',
      'error', 'Profile incomplete: You must complete your student registration with your full name and matriculation number before booking journeys.'
    );
  END IF;

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
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_journey.status <> 'scheduled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_JOURNEY_STATUS',
      'error', 'Booking unavailable: Journey is not open for reservations (status: ' || v_journey.status || ').'
    );
  END IF;

  BEGIN
    SELECT COALESCE((value #>> '{}')::INTEGER, 15)
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

  IF p_boarding_stop_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BOARDING_STOP_REQUIRED',
      'error', 'Please select a valid boarding pickup stop for this route.'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.route_stops
    WHERE route_id = v_journey.route_id
      AND stop_id = p_boarding_stop_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_BOARDING_STOP', 'error', 'Selected pickup stop is not valid for this route.');
  END IF;

  v_effective_student_gender := v_student.hostel_gender;
  IF v_journey.route_gender IN ('male', 'female') THEN
    IF v_effective_student_gender IS NULL OR v_effective_student_gender <> v_journey.route_gender THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GENDER_DENIED',
        'error', 'Gender Policy Restriction: This departure is designated exclusively for ' || v_journey.route_gender || ' hostel residents.'
      );
    END IF;
  END IF;

  v_effective_student_group := COALESCE(v_student.assigned_transport_group_id, v_student.hostel_transport_group_id);
  IF v_journey.route_transport_group_id IS NOT NULL THEN
    IF v_effective_student_group IS NULL OR v_effective_student_group <> v_journey.route_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Transport group restriction: Please ensure your university hostel assignment matches this route operation.'
      );
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'DUPLICATE_BOOKING', 'error', 'You already have a confirmed booking on this departure.');
  END IF;

  IF v_journey.safe_capacity IS NULL OR v_journey.safe_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNVERIFIED_VEHICLE_CAPACITY',
      'error', 'Operation suspended: Vehicle physical safe capacity has not been certified by transport administration.'
    );
  END IF;

  v_effective_capacity := LEAST(
    v_journey.safe_capacity,
    COALESCE(NULLIF(v_journey.proposed_allocation, 0), v_journey.safe_capacity),
    32
  );

  v_max_seated := LEAST(COALESCE(v_journey.seated_capacity, 20), 20, v_effective_capacity);
  v_max_standing := LEAST(COALESCE(v_journey.standing_capacity, 12), 12, GREATEST(0, v_effective_capacity - v_max_seated));
  v_effective_capacity := v_max_seated + v_max_standing;

  IF v_effective_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNVERIFIED_VEHICLE_CAPACITY',
      'error', 'Operation suspended: Effective vehicle capacity is zero.'
    );
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE passenger_category = 'seated'),
    COUNT(*) FILTER (WHERE passenger_category = 'standing'),
    COUNT(*)
  INTO v_seated_count, v_standing_count, v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in');

  IF v_active_bookings_count < v_effective_capacity AND (v_seated_count < v_max_seated OR v_standing_count < v_max_standing) THEN
    IF v_seated_count < v_max_seated THEN
      v_assigned_category := 'seated';
    ELSE
      v_assigned_category := 'standing';
    END IF;

    v_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    SELECT id INTO v_booking_id
    FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status = 'cancelled'
    ORDER BY booked_at DESC, id DESC
    LIMIT 1
    FOR UPDATE;

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

    DELETE FROM public.waitlists
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      v_caller_id,
      'SEAT_BOOKED_ATOMIC',
      'booking',
      v_booking_id,
      jsonb_build_object(
        'journey_id', p_journey_id,
        'passenger_category', v_assigned_category,
        'effective_capacity', v_effective_capacity,
        'seated_limit', v_max_seated,
        'standing_limit', v_max_standing
      )
    );

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_caller_id,
      CASE WHEN v_assigned_category = 'seated' THEN 'Booking Confirmed (Seated)' ELSE 'Booking Confirmed (Standing)' END,
      CASE WHEN v_assigned_category = 'seated'
        THEN 'Your seated place is reserved for departure at ' || to_char(v_journey.scheduled_departure AT TIME ZONE 'Africa/Lagos', 'HH24:MI') || ' WAT. Boarding pass ready.'
        ELSE 'Your standing place is reserved for departure at ' || to_char(v_journey.scheduled_departure AT TIME ZONE 'Africa/Lagos', 'HH24:MI') || ' WAT. Boarding pass ready.'
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
      'seated_limit', v_max_seated,
      'standing_limit', v_max_standing,
      'effective_capacity', v_effective_capacity,
      'message', CASE
        WHEN v_assigned_category = 'seated' THEN 'Seated passenger place reserved successfully.'
        ELSE 'Standing passenger place reserved successfully (' || v_max_seated || ' seated places full).'
      END
    );
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.waitlists
      WHERE journey_id = p_journey_id
        AND student_id = v_caller_id
        AND status = 'waiting'
    ) THEN
      RETURN jsonb_build_object('success', false, 'code', 'ALREADY_WAITLISTED', 'error', 'You are already on the waiting list for this departure.');
    END IF;

    SELECT COALESCE(MAX(position), 0) + 1
    INTO v_waitlist_pos
    FROM public.waitlists
    WHERE journey_id = p_journey_id
      AND status = 'waiting';

    SELECT id INTO v_existing_waitlist_id
    FROM public.waitlists
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.waitlists
      SET status = 'waiting',
          boarding_stop_id = p_boarding_stop_id,
          position = v_waitlist_pos,
          promoted_at = NULL,
          created_at = now()
      WHERE id = v_existing_waitlist_id;
    ELSE
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
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_caller_id,
      'Added to Waiting List (Position #' || v_waitlist_pos || ')',
      'This departure has reached its ' || v_effective_capacity || '-passenger limit. You are #' || v_waitlist_pos || ' on the waiting list.',
      'journey_update',
      p_journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlisted',
      'waitlist_position', v_waitlist_pos,
      'message', 'Departure full (' || v_effective_capacity || ' max capacity). Added to waitlist at position #' || v_waitlist_pos || '.'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking_and_promote(
  p_booking_id UUID,
  p_student_id UUID DEFAULT NULL,
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
  v_student RECORD;
  v_booking RECORD;
  v_journey RECORD;
  v_cancelled_category public.passenger_category;
  v_standing_to_upgrade RECORD;
  v_top_waitlist RECORD;
  v_new_booking_id UUID;
  v_new_ticket_token TEXT;
  v_promoted_category public.passenger_category;
  v_cancel_cutoff_mins INTEGER := 30;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' OR auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Booking cancellation requires an authenticated student session.');
  END IF;

  IF p_student_id IS NOT NULL AND p_student_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Authenticated user cannot cancel another student booking.');
  END IF;
  v_caller_id := auth.uid();

  SELECT * INTO v_student FROM public.profiles WHERE id = v_caller_id;
  IF NOT FOUND OR v_student.role <> 'student' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Booking cancellation is restricted to student accounts.');
  END IF;

  IF v_student.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'error', 'Your account is currently suspended.');
  END IF;

  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.student_id = v_caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking record not found or does not belong to you.');
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking cannot be cancelled (Current status: ' || v_booking.status || ').');
  END IF;

  SELECT * INTO v_journey
  FROM public.journeys
  WHERE id = v_booking.journey_id
  FOR UPDATE;

  IF v_journey.status IN ('in_transit', 'completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel a trip that is in transit, completed, or cancelled.');
  END IF;

  BEGIN
    SELECT COALESCE((value #>> '{}')::INTEGER, 30)
    INTO v_cancel_cutoff_mins
    FROM public.system_settings
    WHERE key = 'cancellation_cutoff_minutes';
  EXCEPTION WHEN OTHERS THEN
    v_cancel_cutoff_mins := 30;
  END;

  IF v_cancel_cutoff_mins IS NULL OR v_cancel_cutoff_mins < 0 THEN
    v_cancel_cutoff_mins := 30;
  END IF;

  IF v_journey.scheduled_departure <= (now() + (v_cancel_cutoff_mins * INTERVAL '1 minute')) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'CANCELLATION_CUTOFF_EXCEEDED',
      'error', 'Cancellation closed: Self-service cancellations close ' || v_cancel_cutoff_mins || ' minutes before scheduled departure.'
    );
  END IF;

  v_cancelled_category := COALESCE(v_booking.passenger_category, 'seated');

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

  IF v_cancelled_category = 'seated' THEN
    SELECT id, student_id INTO v_standing_to_upgrade
    FROM public.bookings
    WHERE journey_id = v_booking.journey_id
      AND status IN ('confirmed', 'checked_in')
      AND passenger_category = 'standing'
    ORDER BY booked_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.bookings
      SET passenger_category = 'seated'
      WHERE id = v_standing_to_upgrade.id;

      UPDATE public.boarding_records
      SET passenger_category = 'seated'
      WHERE booking_id = v_standing_to_upgrade.id
        AND passenger_category <> 'seated';

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

      v_promoted_category := 'standing';
    ELSE
      v_promoted_category := 'seated';
    END IF;
  ELSE
    v_promoted_category := 'standing';
  END IF;

  SELECT w.* INTO v_top_waitlist
  FROM public.waitlists w
  JOIN public.profiles p ON p.id = w.student_id
  WHERE w.journey_id = v_booking.journey_id
    AND w.status = 'waiting'
    AND p.is_active IS TRUE
    AND p.role = 'student'
  ORDER BY w.position ASC, w.created_at ASC
  LIMIT 1
  FOR UPDATE OF w;

  IF FOUND THEN
    v_new_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    SELECT id INTO v_new_booking_id
    FROM public.bookings
    WHERE journey_id = v_booking.journey_id
      AND student_id = v_top_waitlist.student_id
      AND status = 'cancelled'
    ORDER BY booked_at DESC, id DESC
    LIMIT 1
    FOR UPDATE;

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

CREATE OR REPLACE FUNCTION public.cancel_waitlist_entry(
  p_waitlist_id UUID,
  p_student_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT;
  v_caller_id UUID;
  v_student RECORD;
  v_waitlist RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role <> 'authenticated' OR auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  IF p_student_id IS NOT NULL AND p_student_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
  END IF;
  v_caller_id := auth.uid();

  SELECT * INTO v_student FROM public.profiles WHERE id = v_caller_id;
  IF NOT FOUND OR v_student.role <> 'student' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Waitlist management is restricted to student accounts.');
  END IF;

  IF v_student.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'error', 'Your account is currently suspended.');
  END IF;

  SELECT * INTO v_waitlist
  FROM public.waitlists
  WHERE id = p_waitlist_id AND student_id = v_caller_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Waitlist entry not found.');
  END IF;

  IF v_waitlist.status <> 'waiting' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'error', 'Waitlist entry is already ' || v_waitlist.status || '.');
  END IF;

  UPDATE public.waitlists
  SET status = 'cancelled'
  WHERE id = p_waitlist_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (v_caller_id, 'WAITLIST_CANCELLED', 'waitlist', p_waitlist_id, jsonb_build_object('journey_id', v_waitlist.journey_id));

  RETURN jsonb_build_object('success', true, 'message', 'Waitlist request cancelled.');
END;
$$;

-- ============================================================================
-- 6. BOARDING CAPACITY & STRICT GOVERNANCE / MODE B SEPARATION
-- ============================================================================

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
  v_seated_count INTEGER;
  v_standing_count INTEGER;
  v_max_seated INTEGER;
  v_max_standing INTEGER;
  v_effective_capacity INTEGER;
  v_exception_reason TEXT := NULLIF(trim(COALESCE(p_exception_reason, '')), '');
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
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

  SELECT * INTO v_officer FROM public.profiles WHERE id = v_effective_officer_id;
  IF NOT FOUND OR v_officer.is_active IS NOT TRUE OR NOT (
    v_officer.role = 'boarding_officer'
    OR (v_officer.role = 'admin' AND v_officer.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only authorised hostel representatives and administrators may board passengers.');
  END IF;

  SELECT j.*, r.name AS route_name, r.code AS route_code, r.transport_group_id,
         v.safe_capacity, v.seated_capacity, v.standing_capacity, v.registration_number AS vehicle_registration
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  LEFT JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey record not found.');
  END IF;

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot board passengers for a route outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_journey.safe_capacity IS NULL OR v_journey.safe_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNVERIFIED_VEHICLE_CAPACITY',
      'error', 'Boarding blocked: Assigned vehicle does not have a certified positive safe physical capacity.'
    );
  END IF;

  v_effective_capacity := LEAST(
    v_journey.safe_capacity,
    COALESCE(NULLIF(v_journey.proposed_allocation, 0), v_journey.safe_capacity),
    32
  );
  v_max_seated := LEAST(COALESCE(v_journey.seated_capacity, 20), 20, v_effective_capacity);
  v_max_standing := LEAST(COALESCE(v_journey.standing_capacity, 12), 12, GREATEST(0, v_effective_capacity - v_max_seated));
  v_effective_capacity := v_max_seated + v_max_standing;

  IF v_journey.status = 'scheduled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_BOARDING', 'error', 'Boarding Not Open: The bus has not yet arrived or boarding has not been opened by the representative.');
  ELSIF v_journey.status = 'bus_arrived' THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_BOARDING', 'error', 'Boarding Not Open: The bus is at pickup point, but boarding has not been officially opened by the representative.');
  ELSIF v_journey.status = 'boarding_closed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'BOARDING_CLOSED', 'error', 'Boarding Gate Closed: Boarding has already been closed for this departure.');
  ELSIF v_journey.status = 'ready_to_depart' THEN
    RETURN jsonb_build_object('success', false, 'code', 'READY_TO_DEPART', 'error', 'Boarding Complete: Departure has been authorised; no further passenger boarding is permitted.');
  ELSIF v_journey.status = 'in_transit' THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_ALREADY_DEPARTED', 'error', 'Cannot board passenger: The bus has already departed.');
  ELSIF v_journey.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_COMPLETED', 'error', 'Cannot board passenger: This journey has already reached its destination and completed.');
  ELSIF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_CANCELLED', 'error', 'Cannot board passenger: This journey has been cancelled.');
  ELSIF v_journey.status <> 'boarding' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_JOURNEY_STATUS', 'error', 'Cannot board passenger: Journey status is ' || v_journey.status || '.');
  END IF;

  IF p_ticket_token IS NULL OR length(trim(p_ticket_token)) < 8 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TICKET', 'error', 'Invalid ticket token format. Please scan a valid boarding pass.');
  END IF;

  IF p_boarding_method = 'manual_override' AND length(COALESCE(v_exception_reason, '')) < 5 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'EXCEPTION_REASON_REQUIRED',
      'error', 'Manual boarding override requires an auditable exception reason of at least 5 characters.'
    );
  END IF;

  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.ticket_token = trim(p_ticket_token)
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'BOOKING_NOT_FOUND', 'error', 'Invalid Boarding Pass: No booking found for this QR pass.');
  END IF;

  SELECT p.full_name, p.student_id, p.is_active INTO v_student FROM public.profiles p WHERE p.id = v_booking.student_id;

  IF v_booking.status = 'checked_in' THEN
    SELECT scanned_at INTO v_previous_scan
    FROM public.boarding_records
    WHERE booking_id = v_booking.id
    ORDER BY scanned_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_CHECKED_IN',
      'error', 'Already Boarded: Passenger checked in at ' || to_char(COALESCE(v_previous_scan.scanned_at, v_booking.checked_in_at), 'HH24:MI:SS') || '. Duplicate boarding rejected.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id,
      'original_scan_at', COALESCE(v_previous_scan.scanned_at, v_booking.checked_in_at)
    );
  ELSIF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'CANCELLED_TICKET', 'error', 'Invalid Boarding Pass: This booking has been cancelled and is no longer valid.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  ELSIF v_booking.status = 'no_show' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_BOOKING_STATUS', 'error', 'Invalid Boarding Pass: Student was marked as No-Show. Manual re-activation required.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  ELSIF v_booking.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_BOOKING_STATUS', 'error', 'Invalid Boarding Pass: Booking is not in confirmed status (Status: ' || v_booking.status || ').', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  END IF;

  IF v_student.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'error', 'Boarding blocked: Student account is currently suspended.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  END IF;

  IF v_booking.journey_id <> p_journey_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'WRONG_JOURNEY', 'error', 'Wrong Bus/Trip: This boarding pass is issued for a different scheduled departure.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE passenger_category = 'seated'),
    COUNT(*) FILTER (WHERE passenger_category = 'standing')
  INTO v_boarded_count, v_seated_count, v_standing_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id;

  IF v_effective_capacity <= 0 OR v_boarded_count >= v_effective_capacity THEN
    RETURN jsonb_build_object('success', false, 'code', 'BUS_FULL', 'error', 'Boarding Gate Blocked: Bus safe physical capacity of ' || v_effective_capacity || ' passengers reached.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  END IF;

  IF v_booking.passenger_category = 'seated' AND v_seated_count >= v_max_seated THEN
    RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_EXCEEDED', 'error', 'Seated Limit Reached: All ' || v_max_seated || ' seated positions are currently occupied.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  ELSIF v_booking.passenger_category = 'standing' AND v_standing_count >= v_max_standing THEN
    RETURN jsonb_build_object('success', false, 'code', 'CAPACITY_EXCEEDED', 'error', 'Standing Limit Reached: All ' || v_max_standing || ' standing positions are currently occupied.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
  END IF;

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
    v_exception_reason,
    TRUE,
    v_booking.passenger_category,
    now()
  );

  UPDATE public.bookings
  SET status = 'checked_in',
      checked_in_at = now(),
      checked_in_by = v_effective_officer_id
  WHERE id = v_booking.id;

  IF v_booking.passenger_category = 'seated' THEN
    v_seated_count := v_seated_count + 1;
  ELSE
    v_standing_count := v_standing_count + 1;
  END IF;
  v_boarded_count := v_boarded_count + 1;

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
      'exception_reason', v_exception_reason,
      'boarded_count', v_boarded_count,
      'seated_count', v_seated_count,
      'standing_count', v_standing_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'VALID',
    'message', 'Boarding pass verified. Passenger boarding approved.',
    'passenger_name', v_student.full_name,
    'student_id', v_student.student_id,
    'passenger_category', v_booking.passenger_category,
    'boarded_count', v_boarded_count,
    'seated_count', v_seated_count,
    'standing_count', v_standing_count,
    'seated_limit', v_max_seated,
    'standing_limit', v_max_standing,
    'total_capacity', v_effective_capacity,
    'capacity', v_effective_capacity,
    'bus_registration', COALESCE(v_journey.vehicle_registration, v_journey.route_code)
  );
END;
$$;

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
  v_waitlist RECORD;
  v_reason TEXT := trim(COALESCE(p_cancellation_reason, ''));
  v_cancelled_bookings INTEGER := 0;
  v_cancelled_waitlists INTEGER := 0;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another actor.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit admin attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only Super Administrators and the Bus Manager may cancel journeys.');
  END IF;

  IF length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_REASON', 'error', 'A cancellation reason (minimum 3 characters) is required.');
  END IF;

  SELECT j.*, r.name AS route_name, r.code AS route_code
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_journey.status IN ('in_transit', 'completed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_STATUS',
      'error', 'Cannot cancel a journey currently in "' || v_journey.status || '" status.'
    );
  END IF;

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'cancelled',
      delay_reason = v_reason,
      updated_at = now()
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  FOR v_booking IN
    SELECT b.id, b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id
      AND b.status IN ('confirmed', 'checked_in')
    FOR UPDATE OF b
  LOOP
    UPDATE public.bookings
    SET status = 'cancelled',
        cancelled_at = now()
    WHERE id = v_booking.id;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_booking.student_id,
      'Journey Cancelled: ' || v_journey.route_name,
      'The scheduled departure on ' || v_journey.route_name || ' has been cancelled. Reason: ' || v_reason,
      'journey_update'::public.notification_type,
      p_journey_id
    );

    v_cancelled_bookings := v_cancelled_bookings + 1;
  END LOOP;

  FOR v_waitlist IN
    SELECT w.id, w.student_id
    FROM public.waitlists w
    WHERE w.journey_id = p_journey_id
      AND w.status = 'waiting'
    FOR UPDATE OF w
  LOOP
    UPDATE public.waitlists
    SET status = 'cancelled'
    WHERE id = v_waitlist.id;

    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_waitlist.student_id,
      'Waitlisted Journey Cancelled: ' || v_journey.route_name,
      'The waitlisted departure on ' || v_journey.route_name || ' was cancelled. Reason: ' || v_reason,
      'journey_update'::public.notification_type,
      p_journey_id
    );

    v_cancelled_waitlists := v_cancelled_waitlists + 1;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    'JOURNEY_CANCELLED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'route_code', v_journey.route_code,
      'reason', v_reason,
      'cancelled_bookings', v_cancelled_bookings,
      'cancelled_waitlists', v_cancelled_waitlists
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Journey cancelled. ' || v_cancelled_bookings || ' booking(s) and ' || v_cancelled_waitlists || ' waitlist entry(ies) cleared.',
    'cancelled_bookings', v_cancelled_bookings,
    'cancelled_waitlists', v_cancelled_waitlists
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_journey_dispatch(
  p_journey_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT NULL
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
  v_caller RECORD;
  v_now TIMESTAMPTZ := now();
  v_booking RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit actor attribution.');
    END IF;
    v_effective_user_id := p_user_id;
  END IF;

  -- Stage 7 fleet dispatch confirmation belongs strictly to super_admin and bus_manager
  SELECT * INTO v_caller FROM public.profiles WHERE id = v_effective_user_id;
  IF NOT FOUND OR v_caller.is_active IS NOT TRUE OR v_caller.role <> 'admin' OR v_caller.admin_role NOT IN ('super_admin', 'bus_manager') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Stage 7 rolling dispatch confirmation is restricted to Super Administrators and the Bus Manager.'
    );
  END IF;

  SELECT j.*, r.transport_group_id, r.name AS route_name, r.code AS route_code
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey record not found.');
  END IF;

  IF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object('success', true, 'code', 'ALREADY_DEPARTED', 'status', v_journey.status, 'actual_departure', v_journey.actual_departure, 'message', 'Journey has already departed.');
  END IF;

  IF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_CANCELLED', 'error', 'Cannot dispatch: This journey was cancelled.');
  END IF;

  IF v_journey.status <> 'ready_to_depart' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TRANSITION',
      'error', 'Cannot dispatch journey: Departure must be authorised by the hostel representative first (current status: ' || v_journey.status || ').'
    );
  END IF;

  IF v_journey.readiness_status = 'failed_unsafe' THEN
    RETURN jsonb_build_object('success', false, 'code', 'SAFETY_BLOCKED', 'error', 'Safety violation: Pre-departure vehicle check was flagged unsafe. Dispatch blocked.');
  END IF;

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = v_now,
      departure_confirmed_by = v_effective_user_id,
      boarding_notes = COALESCE(p_notes, boarding_notes),
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_user_id,
    'JOURNEY_DEPARTED',
    'journey',
    p_journey_id,
    jsonb_build_object('journey_id', p_journey_id, 'route_code', v_journey.route_code, 'actual_departure', v_now, 'confirmed_by', v_effective_user_id, 'notes', p_notes)
  );

  FOR v_booking IN
    SELECT b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('checked_in', 'confirmed')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_booking.student_id,
      'Bus Departed: ' || v_journey.route_name,
      'Your scheduled bus on route ' || v_journey.route_name || ' has departed.',
      'journey_update'::public.notification_type,
      p_journey_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'DEPARTED',
    'status', 'in_transit',
    'actual_departure', v_now,
    'message', 'Journey departed successfully. Students notified.'
  );
END;
$$;

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
  v_officer RECORD;
  v_journey RECORD;
  v_now TIMESTAMPTZ := now();
  v_boarded_count INTEGER := 0;
  v_booking RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_officer_id IS NOT NULL AND p_officer_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_officer_id := auth.uid();
  ELSE
    IF p_officer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit officer attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  -- Strictly super_admin and bus_manager so Stage 7 governance cannot be bypassed
  SELECT * INTO v_officer FROM public.profiles WHERE id = v_effective_officer_id;
  IF NOT FOUND OR v_officer.is_active IS NOT TRUE OR v_officer.role <> 'admin' OR v_officer.admin_role NOT IN ('super_admin', 'bus_manager') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Stage 7 departure confirmation is restricted to Super Administrators and the Bus Manager.'
    );
  END IF;

  SELECT j.*, r.transport_group_id, r.name AS route_name
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_journey.status <> 'ready_to_depart' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', 'Cannot depart journey: Journey must first complete boarding closure and departure authorisation (current status: ' || v_journey.status || ').');
  END IF;

  IF v_journey.readiness_status = 'failed_unsafe' THEN
    RETURN jsonb_build_object('success', false, 'code', 'SAFETY_BLOCKED', 'error', 'Safety violation: Pre-departure vehicle check flagged unsafe. Departure blocked.');
  END IF;

  SELECT COUNT(*) INTO v_boarded_count FROM public.boarding_records WHERE journey_id = p_journey_id;

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = v_now,
      departure_confirmed_by = v_effective_officer_id,
      boarding_notes = COALESCE(p_closure_notes, boarding_notes),
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'JOURNEY_CLOSED_AND_DEPARTED',
    'journey',
    p_journey_id,
    jsonb_build_object('journey_id', p_journey_id, 'boarded_count', v_boarded_count, 'actual_departure', v_now, 'notes', p_closure_notes)
  );

  FOR v_booking IN
    SELECT b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('checked_in', 'confirmed')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_booking.student_id,
      'Bus Departed: ' || v_journey.route_name,
      'Your scheduled bus on route ' || v_journey.route_name || ' has departed.',
      'journey_update'::public.notification_type,
      p_journey_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Journey departed successfully with ' || v_boarded_count || ' passenger(s).',
    'boarded_count', v_boarded_count,
    'actual_departure', v_now
  );
END;
$$;

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
  v_now TIMESTAMPTZ := now();
  v_booking RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_actor_id := auth.uid();
  ELSE
    IF p_actor_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit actor attribution.');
    END IF;
    v_effective_actor_id := p_actor_id;
  END IF;

  -- Strictly exclude hostel_manager and students from vehicle departure recording
  SELECT * INTO v_user FROM public.profiles WHERE id = v_effective_actor_id;
  IF NOT FOUND OR v_user.is_active IS NOT TRUE OR NOT (
    v_user.role IN ('driver', 'boarding_officer')
    OR (v_user.role = 'admin' AND v_user.admin_role IN ('super_admin', 'bus_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Caller cannot record departure.');
  END IF;

  SELECT j.*, r.transport_group_id, r.name AS route_name, v.registration_number AS bus_reg,
         d.has_app_access AS assigned_driver_has_app
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  LEFT JOIN public.drivers d ON d.id = j.driver_record_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: Not authorised for this hostel operation.');
    END IF;
    IF p_is_assisted IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'ASSISTED_MODE_REQUIRED',
        'error', 'Boarding officers may only record physical departure on behalf of an assigned non-smartphone (Mode B) driver using assisted mode.'
      );
    END IF;
    IF v_journey.driver_record_id IS NULL OR v_journey.assigned_driver_has_app IS TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'DIRECT_DRIVER_MODE_REQUIRED',
        'error', 'Assisted departure is restricted to Mode B (non-smartphone) driver journeys; Stage 7 dispatch or Mode A driver confirmation is required.'
      );
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id IS DISTINCT FROM v_effective_actor_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_actor_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'You are not the driver assigned to this journey.');
  END IF;

  IF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_DEPARTED', 'error', 'Cannot record departure: Trip is already ' || v_journey.status || '.');
  END IF;

  IF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_CANCELLED', 'error', 'Cannot depart a cancelled trip.');
  END IF;

  IF v_journey.status <> 'ready_to_depart' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', 'Cannot depart yet: Departure authorisation from the hostel representative is required (current status: ' || v_journey.status || ').');
  END IF;

  IF v_journey.readiness_status = 'failed_unsafe' THEN
    RETURN jsonb_build_object('success', false, 'code', 'SAFETY_BLOCKED', 'error', 'Safety violation: Pre-departure check flagged vehicle as unsafe. Departure blocked.');
  END IF;

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = v_now,
      departure_confirmed_by = v_effective_actor_id,
      is_assisted_operation = (is_assisted_operation OR p_is_assisted),
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.journey_operational_logs (
    journey_id, driver_id, recorded_by_user_id, action_type, operation_mode, details
  )
  VALUES (
    p_journey_id, v_journey.driver_record_id, v_effective_actor_id, 'DEPARTURE',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('actual_departure', v_now, 'notes', p_notes)
  );

  FOR v_booking IN
    SELECT b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('checked_in', 'confirmed')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_booking.student_id,
      'Bus Departed: ' || v_journey.route_name,
      'Bus ' || v_journey.bus_reg || ' on route ' || v_journey.route_name || ' has departed.',
      'journey_update'::public.notification_type,
      p_journey_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bus ' || v_journey.bus_reg || ' departed. Status changed to in_transit.',
    'actual_departure', v_now
  );
END;
$$;

-- ============================================================================
-- 7. NEW LEAST-PRIVILEGE RPCS (STUDENT OCCUPANCY, INCIDENTS & ADMIN CONTROLS)
-- ============================================================================

-- Aggregate non-PII occupancy & latest stop milestone for student departure boards
CREATE OR REPLACE FUNCTION public.get_student_departure_occupancy(
  p_journey_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT;
  v_caller RECORD;
  v_result JSONB := '{}'::jsonb;
  v_row RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Authentication required.');
    END IF;
    SELECT * INTO v_caller FROM public.profiles WHERE id = auth.uid();
    IF NOT FOUND OR v_caller.is_active IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'code', 'ACCOUNT_INACTIVE', 'error', 'Your account is currently suspended.');
    END IF;
  END IF;

  IF p_journey_ids IS NULL OR COALESCE(array_length(p_journey_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', true, 'occupancy', '{}'::jsonb);
  END IF;

  FOR v_row IN
    SELECT
      j.id AS journey_id,
      CASE
        WHEN v.safe_capacity IS NOT NULL AND v.safe_capacity > 0 THEN
          LEAST(v.safe_capacity, COALESCE(NULLIF(j.proposed_allocation, 0), v.safe_capacity), 32)
        ELSE 0
      END AS raw_capacity,
      COALESCE(v.seated_capacity, 20) AS vehicle_seated_capacity,
      COALESCE(v.standing_capacity, 12) AS vehicle_standing_capacity,
      COALESCE(bk.seated_count, 0) AS seated_count,
      COALESCE(bk.standing_count, 0) AS standing_count,
      COALESCE(bk.active_count, 0) AS active_bookings_count,
      COALESCE(wl.waitlist_count, 0) AS waitlist_count,
      ls.stop_update AS latest_stop_update
    FROM public.journeys j
    LEFT JOIN public.vehicles v ON v.id = j.vehicle_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in') AND b.passenger_category = 'seated') AS seated_count,
        COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in') AND b.passenger_category = 'standing') AS standing_count,
        COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in')) AS active_count
      FROM public.bookings b
      WHERE b.journey_id = j.id
    ) bk ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE w.status = 'waiting') AS waitlist_count
      FROM public.waitlists w
      WHERE w.journey_id = j.id
    ) wl ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'event_type', jsu.event_type,
        'stop_name', s.name,
        'created_at', jsu.created_at
      ) AS stop_update
      FROM public.journey_stop_updates jsu
      JOIN public.stops s ON s.id = jsu.stop_id
      WHERE jsu.journey_id = j.id
      ORDER BY jsu.created_at DESC
      LIMIT 1
    ) ls ON TRUE
    WHERE j.id = ANY(p_journey_ids)
  LOOP
    DECLARE
      v_max_seated INTEGER;
      v_max_standing INTEGER;
      v_effective_capacity INTEGER;
    BEGIN
      v_max_seated := LEAST(v_row.vehicle_seated_capacity, 20, v_row.raw_capacity);
      v_max_standing := LEAST(v_row.vehicle_standing_capacity, 12, GREATEST(0, v_row.raw_capacity - v_max_seated));
      v_effective_capacity := v_max_seated + v_max_standing;

      v_result := v_result || jsonb_build_object(
        v_row.journey_id::text,
        jsonb_build_object(
          'seated_count', v_row.seated_count,
          'standing_count', v_row.standing_count,
          'active_bookings_count', v_row.active_bookings_count,
          'waitlist_count', v_row.waitlist_count,
          'seated_limit', v_max_seated,
          'standing_limit', v_max_standing,
          'effective_capacity', v_effective_capacity,
          'latest_stop_update', v_row.latest_stop_update
        )
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'occupancy', v_result);
END;
$$;

-- Audited operational incident reporting (eliminates direct client inserts to journey_operational_logs)
CREATE OR REPLACE FUNCTION public.report_operational_incident(
  p_journey_id UUID,
  p_actor_id UUID,
  p_category TEXT,
  p_severity public.incident_severity DEFAULT 'medium',
  p_description TEXT DEFAULT '',
  p_is_assisted BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_actor_id UUID;
  v_jwt_role TEXT;
  v_caller RECORD;
  v_journey RECORD;
  v_clean_category TEXT := trim(COALESCE(p_category, ''));
  v_clean_description TEXT := trim(COALESCE(p_description, ''));
  v_incident_id UUID;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_actor_id IS NOT NULL AND p_actor_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_actor_id := auth.uid();
  ELSE
    IF p_actor_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit actor attribution.');
    END IF;
    v_effective_actor_id := p_actor_id;
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_effective_actor_id;
  IF NOT FOUND OR v_caller.is_active IS NOT TRUE OR NOT (
    v_caller.role IN ('driver', 'boarding_officer')
    OR (v_caller.role = 'admin' AND v_caller.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only active transport staff and drivers may report incidents.');
  END IF;

  IF length(v_clean_category) < 2 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_CATEGORY', 'error', 'Incident category is required.');
  END IF;

  IF length(v_clean_description) < 5 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DESCRIPTION', 'error', 'Incident description must be at least 5 characters.');
  END IF;

  IF p_journey_id IS NOT NULL THEN
    SELECT j.*, r.transport_group_id
    INTO v_journey
    FROM public.journeys j
    JOIN public.routes r ON r.id = j.route_id
    WHERE j.id = p_journey_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Referenced journey not found.');
    END IF;

    IF v_caller.role = 'boarding_officer' THEN
      IF v_caller.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_caller.assigned_transport_group_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot report incidents on journeys outside your assigned hostel operation.');
      END IF;
    ELSIF v_caller.role = 'driver' THEN
      IF v_journey.driver_id IS DISTINCT FROM v_effective_actor_id AND NOT EXISTS (
        SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_actor_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'Permission denied: You are not assigned to this journey.');
      END IF;
    END IF;
  END IF;

  INSERT INTO public.incident_reports (
    journey_id,
    vehicle_id,
    reported_by,
    category,
    severity,
    description,
    status
  )
  VALUES (
    p_journey_id,
    CASE WHEN p_journey_id IS NOT NULL THEN v_journey.vehicle_id ELSE NULL END,
    v_effective_actor_id,
    v_clean_category,
    COALESCE(p_severity, 'medium'),
    v_clean_description,
    'reported'
  )
  RETURNING id INTO v_incident_id;

  IF p_journey_id IS NOT NULL THEN
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
      'INCIDENT_REPORTED',
      CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
      jsonb_build_object(
        'incident_id', v_incident_id,
        'category', v_clean_category,
        'severity', COALESCE(p_severity, 'medium'),
        'description', v_clean_description
      )
    );
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_actor_id,
    'INCIDENT_REPORTED',
    'incident_report',
    v_incident_id,
    jsonb_build_object('journey_id', p_journey_id, 'category', v_clean_category, 'severity', COALESCE(p_severity, 'medium'))
  );

  RETURN jsonb_build_object(
    'success', true,
    'incident_id', v_incident_id,
    'message', 'Incident reported and logged for administrative review.'
  );
END;
$$;

-- Super Admin user activation / deactivation governance
CREATE OR REPLACE FUNCTION public.admin_set_user_active_status(
  p_admin_id UUID,
  p_target_user_id UUID,
  p_is_active BOOLEAN,
  p_reason TEXT DEFAULT NULL
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
  v_target RECORD;
  v_clean_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit admin attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role <> 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only Super Administrators may activate or suspend accounts.');
  END IF;

  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TARGET', 'error', 'Target user ID is required.');
  END IF;

  IF p_target_user_id = v_effective_admin_id AND p_is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'code', 'SELF_DEACTIVATION_BLOCKED', 'error', 'Super Administrators cannot deactivate their own active session.');
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'USER_NOT_FOUND', 'error', 'Target user profile not found.');
  END IF;

  UPDATE public.profiles
  SET is_active = COALESCE(p_is_active, FALSE),
      updated_at = now()
  WHERE id = p_target_user_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    CASE WHEN COALESCE(p_is_active, FALSE) THEN 'USER_ACTIVATED' ELSE 'USER_DEACTIVATED' END,
    'profile',
    p_target_user_id,
    jsonb_build_object(
      'target_role', v_target.role,
      'previous_is_active', v_target.is_active,
      'next_is_active', COALESCE(p_is_active, FALSE),
      'reason', v_clean_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_target_user_id,
    'is_active', COALESCE(p_is_active, FALSE),
    'message', CASE WHEN COALESCE(p_is_active, FALSE) THEN 'Account reactivated successfully.' ELSE 'Account suspended successfully.' END
  );
END;
$$;

-- Audited recurring schedule template edit (preserves existing generated journeys)
CREATE OR REPLACE FUNCTION public.admin_update_schedule_template(
  p_admin_id UUID,
  p_schedule_id UUID,
  p_route_id UUID,
  p_day_of_week INTEGER,
  p_departure_time TIME,
  p_latest_departure_time TIME DEFAULT NULL,
  p_direction public.route_direction DEFAULT 'outbound',
  p_proposed_allocation INTEGER DEFAULT 32,
  p_notes TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE
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
  v_schedule RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit admin attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Schedule templates require Super Administrator or Bus Manager privileges.');
  END IF;

  IF p_day_of_week IS NULL OR p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DAY', 'error', 'Day of week must be between 0 (Sunday) and 6 (Saturday).');
  END IF;

  IF p_departure_time IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TIME', 'error', 'Departure time is required.');
  END IF;

  IF p_latest_departure_time IS NOT NULL AND p_latest_departure_time < p_departure_time THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_WINDOW', 'error', 'Latest departure time must be on or after the primary departure time.');
  END IF;

  IF p_proposed_allocation IS NULL OR p_proposed_allocation < 1 OR p_proposed_allocation > 32 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_ALLOCATION', 'error', 'Proposed allocation must be between 1 and 32 passengers.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.routes WHERE id = p_route_id AND is_active = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'code', 'ROUTE_NOT_FOUND', 'error', 'Selected route was not found or is inactive.');
  END IF;

  SELECT * INTO v_schedule FROM public.schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SCHEDULE_NOT_FOUND', 'error', 'Schedule template not found.');
  END IF;

  UPDATE public.schedules
  SET route_id = p_route_id,
      day_of_week = p_day_of_week,
      departure_time = p_departure_time,
      latest_departure_time = p_latest_departure_time,
      direction = COALESCE(p_direction, 'outbound'),
      proposed_allocation = p_proposed_allocation,
      notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
      is_active = COALESCE(p_is_active, v_schedule.is_active)
  WHERE id = p_schedule_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    'SCHEDULE_TEMPLATE_UPDATED',
    'schedule',
    p_schedule_id,
    jsonb_build_object(
      'route_id', p_route_id,
      'day_of_week', p_day_of_week,
      'departure_time', p_departure_time,
      'latest_departure_time', p_latest_departure_time,
      'proposed_allocation', p_proposed_allocation,
      'is_active', COALESCE(p_is_active, v_schedule.is_active)
    )
  );

  RETURN jsonb_build_object('success', true, 'schedule_id', p_schedule_id, 'message', 'Schedule template updated. Existing generated journeys remain preserved.');
END;
$$;

-- Audited recurring schedule active toggle (preserves existing generated journeys)
CREATE OR REPLACE FUNCTION public.admin_toggle_schedule_status(
  p_admin_id UUID,
  p_schedule_id UUID,
  p_is_active BOOLEAN
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
  v_schedule RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit admin attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Schedule toggles require Super Administrator or Bus Manager privileges.');
  END IF;

  SELECT * INTO v_schedule FROM public.schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SCHEDULE_NOT_FOUND', 'error', 'Schedule template not found.');
  END IF;

  UPDATE public.schedules
  SET is_active = COALESCE(p_is_active, FALSE)
  WHERE id = p_schedule_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    CASE WHEN COALESCE(p_is_active, FALSE) THEN 'SCHEDULE_ACTIVATED' ELSE 'SCHEDULE_DEACTIVATED' END,
    'schedule',
    p_schedule_id,
    jsonb_build_object('previous_is_active', v_schedule.is_active, 'next_is_active', COALESCE(p_is_active, FALSE))
  );

  RETURN jsonb_build_object(
    'success', true,
    'schedule_id', p_schedule_id,
    'is_active', COALESCE(p_is_active, FALSE),
    'message', CASE WHEN COALESCE(p_is_active, FALSE) THEN 'Schedule template activated.' ELSE 'Schedule template paused. Existing generated journeys remain intact.' END
  );
END;
$$;

-- Link / unlink Mode A smartphone profile to/from a driver record safely
CREATE OR REPLACE FUNCTION public.admin_link_driver_profile(
  p_admin_id UUID,
  p_driver_id UUID,
  p_profile_id UUID DEFAULT NULL
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
  v_driver RECORD;
  v_profile RECORD;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Invalid or untrusted execution context.');
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_admin_id IS NOT NULL AND p_admin_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch.');
    END IF;
    v_effective_admin_id := auth.uid();
  ELSE
    IF p_admin_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit admin attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Driver account linking requires Super Administrator or Bus Manager privileges.');
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'DRIVER_NOT_FOUND', 'error', 'Driver record not found.');
  END IF;

  IF p_profile_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id;
    IF NOT FOUND OR v_profile.role <> 'driver' OR v_profile.is_active IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_DRIVER_PROFILE',
        'error', 'Selected user account must be an active user with role "driver".'
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.drivers d WHERE d.profile_id = p_profile_id AND d.id <> p_driver_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'DRIVER_PROFILE_ALREADY_LINKED',
        'error', 'This driver user account is already linked to another driver profile.'
      );
    END IF;
  END IF;

  UPDATE public.drivers
  SET profile_id = p_profile_id,
      has_app_access = (p_profile_id IS NOT NULL),
      updated_at = now()
  WHERE id = p_driver_id;

  -- Synchronize future scheduled journeys assigned to this driver record
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET driver_id = p_profile_id,
      updated_at = now()
  WHERE driver_record_id = p_driver_id
    AND status = 'scheduled';
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    CASE WHEN p_profile_id IS NOT NULL THEN 'DRIVER_PROFILE_LINKED' ELSE 'DRIVER_PROFILE_UNLINKED' END,
    'driver',
    p_driver_id,
    jsonb_build_object(
      'previous_profile_id', v_driver.profile_id,
      'next_profile_id', p_profile_id,
      'has_app_access', (p_profile_id IS NOT NULL)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'driver_id', p_driver_id,
    'profile_id', p_profile_id,
    'has_app_access', (p_profile_id IS NOT NULL),
    'message', CASE
      WHEN p_profile_id IS NOT NULL THEN 'Driver linked to Mode A smartphone account.'
      ELSE 'Driver converted to Mode B (non-smartphone / unlinked).'
    END
  );
END;
$$;

-- ============================================================================
-- 8. STRICT LEAST-PRIVILEGE GRANTS & DEFAULT FUNCTION PRIVILEGES
-- ============================================================================

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Trigger helpers must never be callable directly by clients or service_role
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.prevent_audit_log_modification() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.enforce_journey_vehicle_availability() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.protect_journey_lifecycle() FROM PUBLIC, anon, authenticated, service_role;

-- Internal helpers
REVOKE EXECUTE ON FUNCTION public.gen_random_bytes(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gen_random_bytes(INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_driver_assignment_conflict(UUID, UUID, DATE, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_driver_assignment_conflict(UUID, UUID, DATE, TIMESTAMPTZ, UUID, UUID) TO service_role;

-- RLS and scheduling helpers
GRANT EXECUTE ON FUNCTION public.rls_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_user_is_active() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_admin_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_assigned_transport_group() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_driver_assigned_to_journey(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_staff_can_view_profile(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_route_duration_minutes(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID, UUID) TO authenticated, service_role;

-- Student RPCs (strictly authenticated callers only)
REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_waitlist_entry(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_waitlist_entry(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.select_student_hostel(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.select_student_hostel(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_student_profile(TEXT, TEXT, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_student_profile(TEXT, TEXT, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_student_departure_occupancy(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_departure_occupancy(UUID[]) TO authenticated, service_role;

-- Operational & workflow RPCs
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_passenger_no_show(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_bus_arrival(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_journey_boarding(UUID, UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_journey_boarding(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.authorise_journey_departure(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_journey_dispatch(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_vehicle_readiness(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, BOOLEAN, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_stop_update(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_departure_safe(UUID, UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_journey_arrival_safe(UUID, UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_operational_incident(UUID, UUID, TEXT, public.incident_severity, TEXT, BOOLEAN) TO authenticated, service_role;

-- Admin / scheduling RPCs
GRANT EXECUTE ON FUNCTION public.admin_create_journey(UUID, UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, INTEGER, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_incident_status(UUID, UUID, public.incident_status, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active_status(UUID, UUID, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_schedule_template(UUID, UUID, UUID, INTEGER, TIME, TIME, public.route_direction, INTEGER, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_toggle_schedule_status(UUID, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_link_driver_profile(UUID, UUID, UUID) TO authenticated, service_role;

