-- ============================================================
-- COSMORIDE DATABASE MIGRATION 00021
-- VEHICLE ASSIGNMENT SAFETY, CONCURRENCY & CORE MOBILITY INTEGRITY
--
-- Operational Scope:
-- 1. Streamline core transport schema: safely drop experimental
--    vehicle rotation tables, columns, enums, and procedures.
-- 2. Clean profiles.admin_role constraint to core transport roles:
--    ('hostel_manager', 'bus_manager', 'super_admin').
-- 3. Atomic Vehicle Assignment Protection:
--    - Single authoritative check_vehicle_assignment_conflict RPC.
--    - Rejects inactive, retired, or maintenance vehicles.
--    - Detects active unfinished journeys (bus_arrived, boarding,
--      boarding_closed, ready_to_depart, in_transit).
--    - Detects overlapping departures within a 30-minute window across dates
--      and midnight crossovers.
-- 4. Authoritative Journey Creation (admin_create_journey):
--    - Row-level lock (FOR UPDATE) on the vehicle record.
--    - Enforces safe capacity ceiling (LEAST of proposed allocation and safe capacity).
-- 5. Bulk Schedule Generation Hardening (admin_generate_journeys_from_schedules):
--    - Concurrency-safe vehicle locking (FOR UPDATE SKIP LOCKED).
--    - Strict multi-condition availability checks.
-- 6. Direct PostgREST Write Protection & Defense-in-Depth:
--    - Replace open Admin ALL policy on journeys with scoped UPDATE and DELETE.
--    - Direct INSERT is restricted; creation must pass through admin_create_journey.
--    - Database trigger trg_enforce_journey_vehicle_availability enforces
--      availability checks on every journey assignment.
-- 7. Controlled Boarding Workflow:
--    - Standard clean confirm_bus_arrival and open_journey_boarding RPCs.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CLEANUP OF EXPERIMENTAL ROTATION OBJECTS
-- ------------------------------------------------------------

-- Safely drop experimental rotation procedures if they exist
DROP FUNCTION IF EXISTS public.authorize_vehicle_rotation;
DROP FUNCTION IF EXISTS public.confirm_rotated_bus_campus_arrival;
DROP FUNCTION IF EXISTS public.cancel_vehicle_rotation;
DROP FUNCTION IF EXISTS public.start_vehicle_repositioning;

-- Safely drop legacy/overloaded variants of conflict checker
DROP FUNCTION IF EXISTS public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID, UUID);
DROP FUNCTION IF EXISTS public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID);

-- Safely drop rotation tracking columns from journeys if present
ALTER TABLE public.journeys
  DROP COLUMN IF EXISTS is_rotated_vehicle,
  DROP COLUMN IF EXISTS active_movement_id,
  DROP COLUMN IF EXISTS rotation_campus_return_confirmed_at,
  DROP COLUMN IF EXISTS rotation_campus_return_confirmed_by,
  DROP COLUMN IF EXISTS rotated_from_journey_id,
  DROP COLUMN IF EXISTS rotation_previous_vehicle_id;

-- Safely drop experimental movements table and enum if present
DROP TABLE IF EXISTS public.vehicle_movements CASCADE;
DROP TYPE IF EXISTS public.vehicle_movement_status;

-- Clean profiles admin_role constraint
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_admin_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_admin_role_check
  CHECK (admin_role IS NULL OR admin_role IN ('hostel_manager', 'bus_manager', 'super_admin'));

-- ------------------------------------------------------------
-- 2. AUTHORITATIVE VEHICLE ASSIGNMENT CONFLICT CHECKER
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_vehicle_assignment_conflict(
  p_vehicle_id UUID,
  p_journey_date DATE,
  p_scheduled_departure TIMESTAMPTZ,
  p_exclude_journey_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vehicle RECORD;
  v_active_journey RECORD;
  v_overlapping_journey RECORD;
BEGIN
  -- 1. Verify vehicle exists and is active
  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_NOT_FOUND',
      'error', 'Selected vehicle does not exist.'
    );
  END IF;

  IF NOT v_vehicle.is_active THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_INACTIVE',
      'error', 'Selected vehicle is currently marked inactive.'
    );
  END IF;

  IF v_vehicle.status IN ('maintenance', 'retired', 'unavailable') THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_UNAVAILABLE',
      'error', 'Vehicle is currently in ' || v_vehicle.status || ' status and cannot be assigned.'
    );
  END IF;

  -- 2. State-based check: Is the vehicle currently committed to an active unfinished journey?
  SELECT j.id, j.status, j.scheduled_departure, r.name AS route_name
  INTO v_active_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.vehicle_id = p_vehicle_id
    AND j.status IN ('bus_arrived', 'boarding', 'boarding_closed', 'ready_to_depart', 'in_transit')
    AND (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_CURRENTLY_ACTIVE',
      'conflict_journey_id', v_active_journey.id,
      'status', v_active_journey.status,
      'route_name', v_active_journey.route_name,
      'error', 'Vehicle is currently committed to active trip (' || v_active_journey.route_name || ' - status: ' || v_active_journey.status || '). It cannot be assigned until operational completion.'
    );
  END IF;

  -- 3. Overlapping scheduled commitment check (across dates and midnight crossovers within 30 minutes buffer)
  SELECT j.id, j.scheduled_departure, j.status, r.name AS route_name
  INTO v_overlapping_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.vehicle_id = p_vehicle_id
    AND j.status <> 'cancelled'
    AND (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
    AND abs(extract(epoch from (j.scheduled_departure - p_scheduled_departure))) < 1800 -- 30 minutes
  ORDER BY j.scheduled_departure ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'ASSIGNMENT_CONFLICT',
      'conflict_journey_id', v_overlapping_journey.id,
      'conflict_time', v_overlapping_journey.scheduled_departure,
      'route_name', v_overlapping_journey.route_name,
      'error', 'Vehicle is already assigned to ' || v_overlapping_journey.route_name || ' departing at ' || to_char(v_overlapping_journey.scheduled_departure, 'HH24:MI') || '. Overlapping commitments are prohibited.'
    );
  END IF;

  RETURN jsonb_build_object(
    'has_conflict', false,
    'code', 'AVAILABLE',
    'message', 'Vehicle is available for assignment.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. ATOMIC JOURNEY CREATION WITH ROW-LEVEL LOCKING
-- ------------------------------------------------------------

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
  v_vehicle RECORD;
  v_driver_record RECORD;
  v_driver_profile_id UUID := p_driver_id;
  v_effective_alloc INTEGER;
  v_conflict JSONB;
  v_journey_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Trust boundary: verify authenticated session
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Untrusted execution context.');
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
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit administrative actor attribution.');
    END IF;
    v_effective_admin_id := p_admin_id;
  END IF;

  -- 2. Verify admin role
  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = v_effective_admin_id;

  IF NOT FOUND OR v_admin.role <> 'admin' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only administrators can schedule journeys.');
  END IF;

  IF NOT v_admin.is_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'INACTIVE_ADMIN', 'error', 'Permission denied: Administrator account is inactive.');
  END IF;

  -- 3. Verify route exists and is active
  SELECT * INTO v_route
  FROM public.routes
  WHERE id = p_route_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ROUTE_NOT_FOUND', 'error', 'Selected route does not exist.');
  END IF;

  IF NOT v_route.is_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'ROUTE_INACTIVE', 'error', 'Selected route is inactive.');
  END IF;

  -- 4. CONCURRENCY LOCK: Lock vehicle row exclusively for assignment check
  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'VEHICLE_NOT_FOUND', 'error', 'Selected vehicle does not exist.');
  END IF;

  IF NOT v_vehicle.is_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'VEHICLE_INACTIVE', 'error', 'Selected vehicle is currently marked inactive.');
  END IF;

  IF v_vehicle.status IN ('maintenance', 'retired', 'unavailable') THEN
    RETURN jsonb_build_object('success', false, 'code', 'VEHICLE_UNAVAILABLE', 'error', 'Vehicle is currently in ' || v_vehicle.status || ' status and cannot be assigned.');
  END IF;

  -- 5. Authoritative availability check while holding vehicle row lock
  v_conflict := public.check_vehicle_assignment_conflict(
    p_vehicle_id,
    p_journey_date,
    p_scheduled_departure,
    NULL
  );

  IF (v_conflict->>'has_conflict')::BOOLEAN THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', v_conflict->>'code',
      'error', v_conflict->>'error'
    );
  END IF;

  -- 6. Validate and derive driver
  IF p_driver_record_id IS NOT NULL THEN
    SELECT * INTO v_driver_record
    FROM public.drivers
    WHERE id = p_driver_record_id;

    IF FOUND THEN
      v_driver_profile_id := COALESCE(v_driver_record.profile_id, v_driver_profile_id);
    END IF;
  END IF;

  -- 7. Safe capacity ceiling
  v_effective_alloc := LEAST(COALESCE(p_proposed_allocation, 32), v_vehicle.safe_capacity);

  -- 8. Atomic insertion
  INSERT INTO public.journeys (
    route_id,
    vehicle_id,
    driver_id,
    driver_record_id,
    journey_date,
    scheduled_departure,
    proposed_allocation,
    schedule_id,
    status,
    created_by,
    created_at,
    updated_at
  )
  VALUES (
    p_route_id,
    p_vehicle_id,
    v_driver_profile_id,
    p_driver_record_id,
    p_journey_date,
    p_scheduled_departure,
    v_effective_alloc,
    p_schedule_id,
    'scheduled',
    v_effective_admin_id,
    v_now,
    v_now
  )
  RETURNING id INTO v_journey_id;

  -- 9. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    'JOURNEY_CREATED',
    'journey',
    v_journey_id,
    jsonb_build_object(
      'journey_id', v_journey_id,
      'route_id', p_route_id,
      'route_code', v_route.code,
      'vehicle_id', p_vehicle_id,
      'vehicle_registration', v_vehicle.registration_number,
      'scheduled_departure', p_scheduled_departure,
      'proposed_allocation', v_effective_alloc
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'JOURNEY_CREATED',
    'journey_id', v_journey_id,
    'message', 'Journey scheduled successfully with authoritative vehicle assignment lock.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. HARDENED BULK SCHEDULE GENERATION
-- ------------------------------------------------------------

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
  v_sched_departure_ts TIMESTAMPTZ;
  v_latest_departure_ts TIMESTAMPTZ;
BEGIN
  -- 1. Trust boundary: verify execution context and extract JWT claim
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED_CONTEXT',
      'error', 'Permission denied: Untrusted or invalid execution context.'
    );
  END IF;

  -- 2. Actor attribution
  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNAUTHENTICATED_SESSION',
        'error', 'Permission denied: Interactive session must provide authenticated UID.'
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

    SELECT * INTO v_admin
    FROM public.profiles
    WHERE id = v_effective_admin_id;

    IF NOT FOUND OR v_admin.role <> 'admin' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNAUTHORIZED_ADMIN_ACTOR',
        'error', 'Permission denied: Caller must possess administrator role.'
      );
    END IF;

    IF NOT v_admin.is_active THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INACTIVE_ADMIN_ACTOR',
        'error', 'Permission denied: Administrator account is inactive.'
      );
    END IF;
  ELSE
    v_effective_admin_id := NULL;
  END IF;

  v_dow := EXTRACT(DOW FROM p_target_date);

  -- 3. Iterate through active schedule templates for this day of week
  FOR v_sched IN
    SELECT s.*, r.name AS route_name, r.is_active AS route_active
    FROM public.schedules s
    JOIN public.routes r ON r.id = s.route_id
    WHERE s.day_of_week = v_dow
      AND s.is_active = TRUE
      AND r.is_active = TRUE
      AND (p_route_id IS NULL OR s.route_id = p_route_id)
    ORDER BY s.departure_time ASC
  LOOP
    -- Prevent duplicate journey instance on the same schedule and date
    IF EXISTS (
      SELECT 1 FROM public.journeys
      WHERE schedule_id = v_sched.id
        AND journey_date = p_target_date
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Compute scheduled departure timestamp explicitly in Africa/Lagos timezone
    v_sched_departure_ts := timezone('Africa/Lagos', (p_target_date || ' ' || v_sched.departure_time)::timestamp);

    v_latest_departure_ts := CASE
      WHEN v_sched.latest_departure_time IS NOT NULL THEN
        timezone('Africa/Lagos', (p_target_date || ' ' || v_sched.latest_departure_time)::timestamp)
      ELSE
        v_sched_departure_ts
    END;

    -- Pick available fleet vehicle with CONCURRENCY ROW LOCK and COMPREHENSIVE CONFLICT CHECKS
    SELECT v.* INTO v_vehicle
    FROM public.vehicles v
    WHERE v.is_active = TRUE
      AND v.status = 'available'
      AND v.safe_capacity > 0
      -- Check 1: No active unfinished journeys currently occupying this vehicle
      AND NOT EXISTS (
        SELECT 1
        FROM public.journeys j
        WHERE j.vehicle_id = v.id
          AND j.status IN ('bus_arrived', 'boarding', 'boarding_closed', 'ready_to_depart', 'in_transit')
      )
      -- Check 2: No overlapping uncancelled departure within 30 minutes (across all dates/crossovers)
      AND NOT EXISTS (
        SELECT 1
        FROM public.journeys j
        WHERE j.vehicle_id = v.id
          AND j.status <> 'cancelled'
          AND abs(extract(epoch from (j.scheduled_departure - v_sched_departure_ts))) < 1800
      )
    ORDER BY v.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Pick available driver
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
      latest_permitted_departure,
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
      v_sched_departure_ts,
      v_latest_departure_ts,
      v_effective_alloc,
      'scheduled',
      v_effective_admin_id
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  -- 4. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, details)
  VALUES (
    v_effective_admin_id,
    'JOURNEYS_GENERATED_FROM_SCHEDULES',
    'schedule_batch',
    jsonb_build_object(
      'target_date', p_target_date,
      'day_of_week', v_dow,
      'route_filter', p_route_id,
      'created_count', v_created_count,
      'skipped_count', v_skipped_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'target_date', p_target_date,
    'day_of_week', v_dow,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'message', 'Generated ' || v_created_count || ' journey(s) for ' || p_target_date || ' (' || v_skipped_count || ' skipped).'
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. AUTHORITATIVE JOURNEY CANCELLATION
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
  v_now TIMESTAMPTZ := now();
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

  -- 1. Cancel the journey
  UPDATE public.journeys
  SET status = 'cancelled',
      delay_reason = p_cancellation_reason,
      updated_at = v_now
  WHERE id = p_journey_id;

  -- 2. Cancel all active bookings on this journey and emit notifications
  FOR v_booking IN
    SELECT b.id, b.student_id, p.full_name
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.student_id
    WHERE b.journey_id = p_journey_id
      AND b.status IN ('confirmed', 'checked_in')
  LOOP
    UPDATE public.bookings
    SET status = 'cancelled',
        cancelled_at = v_now
    WHERE id = v_booking.id;

    v_cancelled_bookings := v_cancelled_bookings + 1;

    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      metadata
    ) VALUES (
      v_booking.student_id,
      'Journey Cancelled',
      'Your booking for route ' || v_journey.route_name || ' has been cancelled. Reason: ' || p_cancellation_reason,
      'journey_cancelled',
      jsonb_build_object(
        'journey_id', p_journey_id,
        'booking_id', v_booking.id,
        'cancellation_reason', p_cancellation_reason
      )
    );
  END LOOP;

  -- 3. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    'JOURNEY_CANCELLED_BY_ADMIN',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'cancellation_reason', p_cancellation_reason,
      'cancelled_bookings_count', v_cancelled_bookings
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'JOURNEY_CANCELLED',
    'cancelled_bookings_count', v_cancelled_bookings,
    'message', 'Journey cancelled successfully. ' || v_cancelled_bookings || ' student booking(s) cancelled and notified.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. CONTROLLED BOARDING WORKFLOW (CLEAN PROCEDURES)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_bus_arrival(
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
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record arrival under another identity.');
    END IF;
    v_effective_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit user actor attribution.');
    END IF;
    v_effective_user_id := p_user_id;
  END IF;

  -- 2. Verify caller role
  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_effective_user_id;

  IF NOT FOUND OR v_caller.role NOT IN ('boarding_officer', 'admin', 'driver') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Only authorised staff may record bus arrival.'
    );
  END IF;

  -- 3. Lock Journey
  SELECT j.*, r.transport_group_id, r.name AS route_name, r.code AS route_code
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey record not found.');
  END IF;

  -- 4. Check transport group isolation for boarding officers
  IF v_caller.role = 'boarding_officer' THEN
    IF v_caller.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_caller.assigned_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Cross-Group Restriction: You cannot record arrival for a route outside your assigned hostel operation.'
      );
    END IF;
  END IF;

  -- Drivers can only confirm arrival for their assigned journey
  IF v_caller.role = 'driver' THEN
    IF v_journey.driver_id IS DISTINCT FROM v_effective_user_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNASSIGNED_DRIVER',
        'error', 'Permission denied: You are not assigned to drive this journey.'
      );
    END IF;
  END IF;

  -- 5. Validate status transition: only 'scheduled' can transition to 'bus_arrived'
  IF v_journey.status <> 'scheduled' THEN
    IF v_journey.status = 'bus_arrived' THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'ALREADY_ARRIVED',
        'status', 'bus_arrived',
        'bus_arrived_at', v_journey.bus_arrived_at,
        'message', 'Bus arrival has already been confirmed for this journey.'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TRANSITION',
      'error', 'Cannot record bus arrival: Journey is currently in ' || v_journey.status || ' status.'
    );
  END IF;

  -- 6. Record bus arrival at pickup point (doors remain closed, boarding is NOT open)
  UPDATE public.journeys
  SET status = 'bus_arrived',
      bus_arrived_at = now(),
      bus_arrived_by = v_effective_user_id,
      updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_user_id,
    'BUS_ARRIVED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'route_code', v_journey.route_code,
      'bus_arrived_at', now(),
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BUS_ARRIVED',
    'status', 'bus_arrived',
    'bus_arrived_at', now(),
    'message', 'Bus arrival confirmed. Doors remain closed while queue forms. Boarding is not yet open.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.open_journey_boarding(
  p_journey_id UUID,
  p_officer_id UUID,
  p_window_minutes INTEGER DEFAULT NULL
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
  v_window_mins INTEGER;
  v_setting_row RECORD;
  v_now TIMESTAMPTZ := now();
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot open boarding under another officer identity.');
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
      'error', 'Permission denied: Only authorised hostel representatives or administrators can open boarding.'
    );
  END IF;

  -- 3. Lock Journey
  SELECT j.*, r.transport_group_id, r.name AS route_name, r.code AS route_code
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey record not found.');
  END IF;

  -- 4. Check transport group isolation for boarding officers
  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Cross-Group Restriction: You cannot open boarding for a route outside your assigned hostel operation.'
      );
    END IF;
  END IF;

  -- 5. Determine boarding window minutes
  IF p_window_minutes IS NOT NULL AND p_window_minutes > 0 AND p_window_minutes <= 60 THEN
    v_window_mins := p_window_minutes;
  ELSE
    SELECT value INTO v_setting_row
    FROM public.system_settings
    WHERE key = 'boarding_window_minutes';

    IF FOUND AND (v_setting_row.value #>> '{}')::INTEGER > 0 THEN
      v_window_mins := (v_setting_row.value #>> '{}')::INTEGER;
    ELSE
      v_window_mins := 10;
    END IF;
  END IF;

  -- 6. Validate state transitions:
  IF v_journey.status = 'boarding' THEN
    RETURN jsonb_build_object(
      'success', true,
      'code', 'ALREADY_OPEN',
      'status', 'boarding',
      'boarding_opened_at', v_journey.boarding_opened_at,
      'boarding_window_minutes', v_journey.boarding_window_minutes,
      'message', 'Boarding is already in progress.'
    );
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'bus_arrived') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TRANSITION',
      'error', 'Cannot open boarding: Journey is currently in ' || v_journey.status || ' status.'
    );
  END IF;

  -- 7. Update Journey to boarding open
  UPDATE public.journeys
  SET status = 'boarding',
      bus_arrived_at = COALESCE(bus_arrived_at, v_now),
      bus_arrived_by = COALESCE(bus_arrived_by, v_effective_officer_id),
      boarding_opened_at = v_now,
      boarding_opened_by = v_effective_officer_id,
      boarding_window_minutes = v_window_mins,
      updated_at = v_now
  WHERE id = p_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'BOARDING_OPENED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'route_code', v_journey.route_code,
      'boarding_opened_at', v_now,
      'boarding_window_minutes', v_window_mins,
      'expires_at', v_now + (interval '1 minute' * v_window_mins)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BOARDING_OPENED',
    'status', 'boarding',
    'boarding_opened_at', v_now,
    'boarding_window_minutes', v_window_mins,
    'expires_at', v_now + (interval '1 minute' * v_window_mins),
    'message', 'Boarding is now open. The ' || v_window_mins || '-minute countdown has started.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 7. RLS POLICY HARDENING: PREVENT DIRECT POSTGREST JOURNEY INSERT
-- ------------------------------------------------------------

-- Drop the legacy broad ALL policy on journeys
DROP POLICY IF EXISTS "Admins can manage journeys" ON public.journeys;

-- Grant Admins UPDATE capability (e.g. updating delay notes or operational flags)
CREATE POLICY "Admins can update journeys"
  ON public.journeys FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Grant Admins DELETE capability if needed
CREATE POLICY "Admins can delete journeys"
  ON public.journeys FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Notice: No INSERT policy is provided for 'authenticated'.
-- Direct INSERT via PostgREST is blocked; all journey creation must use admin_create_journey.

-- ------------------------------------------------------------
-- 8. DEFENSE-IN-DEPTH TRIGGER: DATABASE-LEVEL VEHICLE AVAILABILITY
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_journey_vehicle_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conflict JSONB;
BEGIN
  -- If vehicle_id is NULL or journey is cancelled, skip check
  IF NEW.vehicle_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, if vehicle_id and scheduled_departure did not change, skip check
  IF TG_OP = 'UPDATE' THEN
    IF OLD.vehicle_id IS NOT DISTINCT FROM NEW.vehicle_id
       AND OLD.scheduled_departure IS NOT DISTINCT FROM NEW.scheduled_departure THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Check vehicle assignment conflict
  v_conflict := public.check_vehicle_assignment_conflict(
    NEW.vehicle_id,
    NEW.journey_date,
    NEW.scheduled_departure,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END
  );

  IF (v_conflict->>'has_conflict')::BOOLEAN THEN
    RAISE EXCEPTION 'Vehicle assignment conflict: % (code: %)',
      (v_conflict->>'error'),
      (v_conflict->>'code')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journey_vehicle_availability ON public.journeys;

CREATE TRIGGER trg_enforce_journey_vehicle_availability
  BEFORE INSERT OR UPDATE OF vehicle_id, scheduled_departure ON public.journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_journey_vehicle_availability();

-- ------------------------------------------------------------
-- 9. PERMISSIONS & FUNCTION GRANTS
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_create_journey(UUID, UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_journey(UUID, UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, INTEGER, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_bus_arrival(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_bus_arrival(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.open_journey_boarding(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_journey_boarding(UUID, UUID, INTEGER) TO authenticated, service_role;
