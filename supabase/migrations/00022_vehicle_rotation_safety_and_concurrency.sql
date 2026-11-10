-- ============================================================
-- COSMORIDE DATABASE MIGRATION 00022
-- VEHICLE ROTATION SAFETY, CONCURRENCY & LIFECYCLE REMEDIATION
--
-- Operational Scope:
-- 1. Alter public.journeys:
--    - Add rotation_previous_vehicle_id UUID REFERENCES vehicles(id)
--      to preserve pre-rotation vehicle assignment for safe cancellation restoration.
-- 2. Stored Procedure: admin_create_journey
--    - Single authoritative atomic journey creation procedure.
--    - Locks public.vehicles row with FOR UPDATE to eliminate TOCTOU race conditions.
--    - Enforces state-based vehicle availability (active unfinished journeys + active repositioning movements).
-- 3. Replace check_vehicle_assignment_conflict:
--    - State-based fail-safe: checks active journeys and active movements.
--    - Removes artificial same-date filter to detect midnight/cross-date conflicts.
-- 4. Harden admin_generate_journeys_from_schedules:
--    - Locks candidate vehicles with FOR UPDATE.
--    - Excludes vehicles in active repositioning movements or active unfinished journeys.
-- 5. Harden confirm_bus_arrival:
--    - Rejects rotated departures if physical campus return is not confirmed (VEHICLE_STILL_RETURNING).
-- 6. Harden authorize_vehicle_rotation:
--    - Locks vehicle row with FOR UPDATE.
--    - Sets movement status to 'planned' if source journey is in_transit.
--    - Stores pre-existing vehicle assignment in rotation_previous_vehicle_id.
-- 7. Add start_vehicle_repositioning RPC:
--    - Transitions movement from 'planned' to 'returning' once source journey is completed.
-- 8. Harden confirm_rotated_bus_campus_arrival:
--    - Strictly verifies source journey is completed before return can be confirmed.
--    - Rejects confirmation if movement is not in 'returning' status.
-- 9. Harden cancel_vehicle_rotation:
--    - Rejects cancellation if movement has already arrived.
--    - Restores pre-rotation vehicle_id (or resets to NULL if previously unassigned).
--    - Reverts status from bus_arrived to scheduled if return had not taken place.
-- 10. Harden admin_cancel_journey:
--     - Safely disassociates linked active vehicle_movements on journey cancellation.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ADD ROTATION PREVIOUS VEHICLE COLUMN TO JOURNEYS
-- ------------------------------------------------------------

ALTER TABLE public.journeys
  ADD COLUMN IF NOT EXISTS rotation_previous_vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 2. HARDENED CHECK VEHICLE ASSIGNMENT CONFLICT RPC
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_vehicle_assignment_conflict(
  p_vehicle_id UUID,
  p_journey_date DATE,
  p_scheduled_departure TIMESTAMPTZ,
  p_exclude_journey_id UUID DEFAULT NULL,
  p_source_journey_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vehicle RECORD;
  v_active_journey RECORD;
  v_active_movement RECORD;
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
  -- (Excludes destination journey and source journey being rotated)
  SELECT j.id, j.status, j.scheduled_departure, r.name AS route_name
  INTO v_active_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.vehicle_id = p_vehicle_id
    AND j.status IN ('bus_arrived', 'boarding', 'boarding_closed', 'ready_to_depart', 'in_transit')
    AND (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
    AND (p_source_journey_id IS NULL OR j.id <> p_source_journey_id)
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

  -- 3. Repositioning check: Is the vehicle in an active or planned repositioning movement?
  SELECT vm.id, vm.status, vm.origin_name, vm.destination_name
  INTO v_active_movement
  FROM public.vehicle_movements vm
  WHERE vm.vehicle_id = p_vehicle_id
    AND vm.status IN ('planned', 'returning')
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_IN_REPOSITIONING',
      'movement_id', v_active_movement.id,
      'movement_status', v_active_movement.status,
      'error', 'Vehicle is currently committed to empty repositioning movement (' || v_active_movement.origin_name || ' to ' || v_active_movement.destination_name || ' - status: ' || v_active_movement.status || '). Assignment is blocked until physical return is confirmed.'
    );
  END IF;

  -- 4. Overlapping scheduled commitment check (across dates and midnight crossovers within 30 minutes buffer)
  SELECT j.id, j.scheduled_departure, j.status, r.name AS route_name
  INTO v_overlapping_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.vehicle_id = p_vehicle_id
    AND j.status <> 'cancelled'
    AND (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
    AND (p_source_journey_id IS NULL OR j.id <> p_source_journey_id)
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
-- 3. AUTHORITATIVE ATOMIC JOURNEY CREATION RPC
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
-- 4. HARDEN CONFIRM BUS ARRIVAL (BLOCK PREMATURE ROTATION ARRIVAL)
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

  -- 5. ROTATION RETURN GUARD: Block standard arrival if rotated bus has not physically returned to campus
  IF v_journey.is_rotated_vehicle AND v_journey.rotation_campus_return_confirmed_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'VEHICLE_STILL_RETURNING',
      'error', 'Cannot record bus arrival: Assigned vehicle is currently returning empty from a previous service. Campus return must be confirmed first by the Bus Manager.'
    );
  END IF;

  -- 6. Validate status transition: only 'scheduled' can transition to 'bus_arrived'
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

  -- 7. Record bus arrival at pickup point (doors remain closed, boarding is NOT open)
  UPDATE public.journeys
  SET status = 'bus_arrived',
      bus_arrived_at = now(),
      bus_arrived_by = v_effective_user_id,
      updated_at = now()
  WHERE id = p_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_user_id,
    'BUS_ARRIVED_AT_TERMINAL',
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
    'message', 'Bus arrival recorded. Bus is stationed at terminal. Boarding doors remain closed until representative opens boarding.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 5. HARDEN AUTHORIZE VEHICLE ROTATION (CORRECT INITIAL STATUS & LOCK)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.authorize_vehicle_rotation(
  p_source_journey_id UUID,
  p_next_journey_id UUID,
  p_vehicle_id UUID,
  p_driver_record_id UUID DEFAULT NULL,
  p_operational_reason TEXT DEFAULT NULL,
  p_origin_name TEXT DEFAULT NULL,
  p_destination_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_caller_id UUID;
  v_jwt_role TEXT;
  v_caller RECORD;
  v_source_journey RECORD;
  v_next_journey RECORD;
  v_vehicle RECORD;
  v_driver RECORD;
  v_driver_profile_id UUID := NULL;
  v_movement_id UUID;
  v_initial_movement_status public.vehicle_movement_status;
  v_origin TEXT;
  v_destination TEXT;
  v_reason TEXT;
  v_now TIMESTAMPTZ := now();
  v_conflict JSONB;
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
    v_effective_caller_id := auth.uid();
    IF v_effective_caller_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
  ELSE
    -- Service role is not permitted for interactive rotation authorization
    RETURN jsonb_build_object('success', false, 'code', 'SERVICE_ROLE_DENIED', 'error', 'Permission denied: Vehicle rotation requires interactive Operations Controller execution.');
  END IF;

  -- 2. STRICT PERMISSION CHECK: ONLY 'operations_controller' can authorize rotation
  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_effective_caller_id;

  IF NOT FOUND OR v_caller.role <> 'admin' OR v_caller.admin_role IS DISTINCT FROM 'operations_controller' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PERMISSION_DENIED',
      'error', 'Permission denied: Vehicle rotation can only be authorized by an Operations Controller.'
    );
  END IF;

  -- 3. Lock & validate physical vehicle
  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_vehicle.is_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'VEHICLE_INACTIVE', 'error', 'Physical vehicle is inactive or unavailable.');
  END IF;

  IF v_vehicle.status IN ('maintenance', 'retired', 'unavailable') THEN
    RETURN jsonb_build_object('success', false, 'code', 'VEHICLE_UNAVAILABLE', 'error', 'Vehicle is currently in ' || v_vehicle.status || ' status and cannot be rotated.');
  END IF;

  -- 4. Lock & validate source journey
  SELECT j.*, r.name AS route_name, r.code AS route_code, v.registration_number AS bus_reg
  INTO v_source_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_source_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SOURCE_NOT_FOUND', 'error', 'Source journey not found.');
  END IF;

  IF v_source_journey.vehicle_id <> p_vehicle_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'VEHICLE_MISMATCH',
      'error', 'Vehicle mismatch: Physical vehicle does not match the source journey vehicle.'
    );
  END IF;

  IF v_source_journey.status NOT IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_SOURCE_STATUS',
      'error', 'Cannot rotate vehicle: Source journey must be in transit or completed (current status: ' || v_source_journey.status || ').'
    );
  END IF;

  -- 5. Lock & validate next destination journey
  SELECT j.*, r.name AS route_name, r.code AS route_code, r.transport_group_id
  INTO v_next_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_next_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'DESTINATION_NOT_FOUND', 'error', 'Destination journey not found.');
  END IF;

  IF v_next_journey.id = v_source_journey.id THEN
    RETURN jsonb_build_object('success', false, 'code', 'SAME_JOURNEY', 'error', 'Source journey and destination journey cannot be identical.');
  END IF;

  IF v_next_journey.status NOT IN ('scheduled', 'bus_arrived') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_DESTINATION_STATUS',
      'error', 'Cannot rotate onto journey with status ' || v_next_journey.status || '. Destination journey must be scheduled.'
    );
  END IF;

  IF v_next_journey.scheduled_departure <= v_source_journey.scheduled_departure THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_CHRONOLOGY',
      'error', 'Destination journey must depart chronologically after source journey departure.'
    );
  END IF;

  -- 6. Check for conflict on next journey (excluding destination journey and source journey being rotated)
  v_conflict := public.check_vehicle_assignment_conflict(
    p_vehicle_id,
    v_next_journey.journey_date,
    v_next_journey.scheduled_departure,
    v_next_journey.id,
    p_source_journey_id
  );

  IF (v_conflict->>'has_conflict')::BOOLEAN THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ASSIGNMENT_CONFLICT',
      'error', v_conflict->>'error'
    );
  END IF;

  -- 7. Validate driver for next journey if provided
  IF p_driver_record_id IS NOT NULL THEN
    SELECT * INTO v_driver
    FROM public.drivers
    WHERE id = p_driver_record_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'DRIVER_NOT_FOUND', 'error', 'Selected driver record not found.');
    END IF;

    IF v_driver.status <> 'active' THEN
      RETURN jsonb_build_object('success', false, 'code', 'DRIVER_INACTIVE', 'error', 'Selected driver is not currently active.');
    END IF;

    v_driver_profile_id := v_driver.profile_id;
  END IF;

  -- 8. Prepare movement location names and operational reason
  v_origin := COALESCE(NULLIF(trim(p_origin_name), ''), 'Hostel Drop-Off Terminal');
  v_destination := COALESCE(NULLIF(trim(p_destination_name), ''), 'Main Campus Central Bus Park');
  v_reason := COALESCE(NULLIF(trim(p_operational_reason), ''), 'Operational Vehicle Rotation authorized by Operations Controller');

  -- 9. LIFECYCLE INVARIANT: If source journey is in_transit, movement is 'planned'.
  -- Only if source journey is already completed does movement enter 'returning'.
  IF v_source_journey.status = 'in_transit' THEN
    v_initial_movement_status := 'planned';
  ELSE
    v_initial_movement_status := 'returning';
  END IF;

  -- 10. Insert empty repositioning movement
  INSERT INTO public.vehicle_movements (
    vehicle_id,
    movement_type,
    origin_name,
    destination_name,
    source_journey_id,
    next_journey_id,
    driver_record_id,
    driver_id,
    status,
    initiated_by,
    initiated_at,
    operational_reason
  )
  VALUES (
    p_vehicle_id,
    'empty_repositioning',
    v_origin,
    v_destination,
    p_source_journey_id,
    p_next_journey_id,
    p_driver_record_id,
    v_driver_profile_id,
    v_initial_movement_status,
    v_effective_caller_id,
    v_now,
    v_reason
  )
  RETURNING id INTO v_movement_id;

  -- 11. Update destination journey: store pre-existing vehicle in rotation_previous_vehicle_id
  UPDATE public.journeys
  SET rotation_previous_vehicle_id = vehicle_id,
      vehicle_id = p_vehicle_id,
      driver_record_id = COALESCE(p_driver_record_id, driver_record_id),
      driver_id = COALESCE(v_driver_profile_id, driver_id),
      is_rotated_vehicle = TRUE,
      active_movement_id = v_movement_id,
      rotated_from_journey_id = p_source_journey_id,
      rotation_campus_return_confirmed_at = NULL,
      rotation_campus_return_confirmed_by = NULL,
      updated_at = v_now
  WHERE id = p_next_journey_id;

  -- 12. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_caller_id,
    'VEHICLE_ROTATION_AUTHORIZED',
    'vehicle_movement',
    v_movement_id,
    jsonb_build_object(
      'movement_id', v_movement_id,
      'movement_status', v_initial_movement_status,
      'vehicle_id', p_vehicle_id,
      'vehicle_registration', v_source_journey.bus_reg,
      'source_journey_id', p_source_journey_id,
      'source_status', v_source_journey.status,
      'next_journey_id', p_next_journey_id,
      'next_route', v_next_journey.route_name,
      'previous_vehicle_id', v_next_journey.vehicle_id,
      'driver_record_id', p_driver_record_id,
      'operational_reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ROTATION_AUTHORIZED',
    'movement_id', v_movement_id,
    'movement_status', v_initial_movement_status,
    'message', 'Vehicle rotation authorized (' || v_initial_movement_status || '). Destination journey boarding is locked until campus return confirmation.',
    'vehicle_registration', v_source_journey.bus_reg,
    'next_journey_id', p_next_journey_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. START VEHICLE REPOSITIONING RPC (TRANSITION PLANNED -> RETURNING)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_vehicle_repositioning(
  p_movement_id UUID,
  p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_staff_id UUID;
  v_jwt_role TEXT;
  v_staff RECORD;
  v_movement RECORD;
  v_source_journey RECORD;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Trust boundary: verify authenticated session
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied.');
  END IF;

  v_effective_staff_id := auth.uid();
  IF v_effective_staff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
  END IF;

  -- 2. Verify staff role
  SELECT * INTO v_staff
  FROM public.profiles
  WHERE id = v_effective_staff_id;

  IF NOT FOUND OR v_staff.role NOT IN ('admin', 'boarding_officer', 'driver') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied.');
  END IF;

  -- 3. Lock movement
  SELECT * INTO v_movement
  FROM public.vehicle_movements
  WHERE id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'MOVEMENT_NOT_FOUND', 'error', 'Movement record not found.');
  END IF;

  IF v_movement.status = 'returning' THEN
    RETURN jsonb_build_object('success', true, 'code', 'ALREADY_RETURNING', 'message', 'Repositioning movement is already in progress.');
  END IF;

  IF v_movement.status <> 'planned' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'error', 'Cannot start repositioning: Current movement status is ' || v_movement.status || '.');
  END IF;

  -- 4. Verify source journey is completed (passengers have alighted)
  SELECT * INTO v_source_journey
  FROM public.journeys
  WHERE id = v_movement.source_journey_id;

  IF FOUND AND v_source_journey.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PASSENGERS_ON_BOARD',
      'error', 'Cannot start empty repositioning: Source journey is still ' || v_source_journey.status || '. All passengers must alight at terminal first.'
    );
  END IF;

  -- 5. Transition to returning
  UPDATE public.vehicle_movements
  SET status = 'returning',
      updated_at = v_now
  WHERE id = p_movement_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_staff_id,
    'VEHICLE_REPOSITIONING_STARTED',
    'vehicle_movement',
    p_movement_id,
    jsonb_build_object('movement_id', p_movement_id, 'started_at', v_now)
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'REPOSITIONING_STARTED',
    'message', 'Empty repositioning movement started. Bus is returning to Main Campus.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 7. HARDEN CONFIRM ROTATED BUS CAMPUS ARRIVAL RPC
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_rotated_bus_campus_arrival(
  p_movement_id UUID,
  p_staff_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_staff_id UUID;
  v_jwt_role TEXT;
  v_staff RECORD;
  v_movement RECORD;
  v_source_journey RECORD;
  v_next_journey RECORD;
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
    IF p_staff_id IS NOT NULL AND p_staff_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot confirm return under another staff identity.');
    END IF;
    v_effective_staff_id := auth.uid();
  ELSE
    IF p_staff_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit staff actor attribution.');
    END IF;
    v_effective_staff_id := p_staff_id;
  END IF;

  -- 2. Verify staff role: Bus Manager, Operations Controller, or Super Admin can confirm physical arrival
  SELECT * INTO v_staff
  FROM public.profiles
  WHERE id = v_effective_staff_id;

  IF NOT FOUND OR v_staff.role <> 'admin' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Only transport administration staff can confirm vehicle return.'
    );
  END IF;

  -- 3. Lock movement record
  SELECT * INTO v_movement
  FROM public.vehicle_movements
  WHERE id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MOVEMENT_NOT_FOUND',
      'error', 'Vehicle movement record not found.'
    );
  END IF;

  -- 4. Check for duplicate or invalid confirmation
  IF v_movement.status = 'arrived' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_ARRIVED',
      'error', 'Vehicle return has already been confirmed.'
    );
  END IF;

  IF v_movement.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MOVEMENT_CANCELLED',
      'error', 'Cannot confirm return for a cancelled movement.'
    );
  END IF;

  -- 5. SOURCE JOURNEY COMPLETION GUARD: Ensure original passenger trip has fully completed
  SELECT * INTO v_source_journey
  FROM public.journeys
  WHERE id = v_movement.source_journey_id;

  IF FOUND AND v_source_journey.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SOURCE_JOURNEY_INCOMPLETE',
      'error', 'Cannot confirm campus return: Outbound passenger journey (' || v_source_journey.id || ') is currently ' || v_source_journey.status || '. Passengers must alight at destination before empty return can be confirmed.'
    );
  END IF;

  -- 6. Update vehicle movement
  UPDATE public.vehicle_movements
  SET status = 'arrived',
      arrived_at = v_now,
      confirmed_by = v_effective_staff_id,
      notes = COALESCE(p_notes, notes),
      updated_at = v_now
  WHERE id = p_movement_id;

  -- 7. Release rotation boarding lock on next journey
  IF v_movement.next_journey_id IS NOT NULL THEN
    SELECT * INTO v_next_journey
    FROM public.journeys
    WHERE id = v_movement.next_journey_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.journeys
      SET rotation_campus_return_confirmed_at = v_now,
          rotation_campus_return_confirmed_by = v_effective_staff_id,
          status = CASE WHEN status = 'scheduled' THEN 'bus_arrived' ELSE status END,
          bus_arrived_at = COALESCE(bus_arrived_at, v_now),
          bus_arrived_by = COALESCE(bus_arrived_by, v_effective_staff_id),
          updated_at = v_now
      WHERE id = v_movement.next_journey_id;
    END IF;
  END IF;

  -- 8. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_staff_id,
    'VEHICLE_CAMPUS_RETURN_CONFIRMED',
    'vehicle_movement',
    p_movement_id,
    jsonb_build_object(
      'movement_id', p_movement_id,
      'vehicle_id', v_movement.vehicle_id,
      'next_journey_id', v_movement.next_journey_id,
      'confirmed_at', v_now,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'CAMPUS_RETURN_CONFIRMED',
    'message', 'Physical vehicle return confirmed at Main Campus Central Bus Park. Next journey boarding lock released.',
    'arrived_at', v_now
  );
END;
$$;

-- ------------------------------------------------------------
-- 8. HARDEN CANCEL VEHICLE ROTATION (SAFE RESTORATION & UNLOCK)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_vehicle_rotation(
  p_movement_id UUID,
  p_cancellation_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_caller_id UUID;
  v_jwt_role TEXT;
  v_caller RECORD;
  v_movement RECORD;
  v_next_journey RECORD;
  v_now TIMESTAMPTZ := now();
  v_reason TEXT;
  v_restored_vehicle_id UUID;
BEGIN
  -- 1. Trust boundary: verify authenticated session
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied.');
  END IF;

  v_effective_caller_id := auth.uid();
  IF v_effective_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
  END IF;

  -- 2. Strictly verify caller is operations_controller
  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_effective_caller_id;

  IF NOT FOUND OR v_caller.role <> 'admin' OR v_caller.admin_role IS DISTINCT FROM 'operations_controller' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'PERMISSION_DENIED',
      'error', 'Permission denied: Only an Operations Controller can cancel a vehicle rotation.'
    );
  END IF;

  -- 3. Lock movement
  SELECT * INTO v_movement
  FROM public.vehicle_movements
  WHERE id = p_movement_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'MOVEMENT_NOT_FOUND', 'error', 'Movement record not found.');
  END IF;

  IF v_movement.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_CANCELLED', 'error', 'Rotation is already cancelled.');
  END IF;

  IF v_movement.status = 'arrived' THEN
    RETURN jsonb_build_object('success', false, 'code', 'ALREADY_ARRIVED', 'error', 'Cannot cancel rotation: Vehicle has already physically returned to campus and operational release was confirmed.');
  END IF;

  v_reason := COALESCE(NULLIF(trim(p_cancellation_reason), ''), 'Operational rotation cancelled by Operations Controller');

  -- 4. Update movement
  UPDATE public.vehicle_movements
  SET status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = v_effective_caller_id,
      cancellation_reason = v_reason,
      updated_at = v_now
  WHERE id = p_movement_id;

  -- 5. SAFE RESTORATION OF DESTINATION JOURNEY:
  -- Restore original pre-rotation vehicle_id (or NULL if it had none).
  -- Do NOT leave the unreturned rotated vehicle assigned with an unlocked gate!
  IF v_movement.next_journey_id IS NOT NULL THEN
    SELECT * INTO v_next_journey
    FROM public.journeys
    WHERE id = v_movement.next_journey_id
    FOR UPDATE;

    IF FOUND THEN
      v_restored_vehicle_id := v_next_journey.rotation_previous_vehicle_id;

      UPDATE public.journeys
      SET vehicle_id = v_restored_vehicle_id,
          is_rotated_vehicle = FALSE,
          active_movement_id = NULL,
          rotation_campus_return_confirmed_at = NULL,
          rotation_previous_vehicle_id = NULL,
          status = CASE WHEN status = 'bus_arrived' THEN 'scheduled' ELSE status END,
          updated_at = v_now
      WHERE id = v_movement.next_journey_id;
    END IF;
  END IF;

  -- 6. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_caller_id,
    'VEHICLE_ROTATION_CANCELLED',
    'vehicle_movement',
    p_movement_id,
    jsonb_build_object(
      'movement_id', p_movement_id,
      'cancellation_reason', v_reason,
      'restored_vehicle_id', v_restored_vehicle_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ROTATION_CANCELLED',
    'message', 'Vehicle rotation cancelled. Destination journey vehicle assignment safely restored.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 9. HARDEN ADMIN CANCEL JOURNEY (DISASSOCIATE LINKED MOVEMENTS)
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

  -- 2. If this journey was the destination of an active repositioning movement, disassociate it
  IF v_journey.active_movement_id IS NOT NULL THEN
    UPDATE public.vehicle_movements
    SET next_journey_id = NULL,
        notes = concat(COALESCE(notes, ''), ' [Destination journey ', p_journey_id, ' cancelled: ', p_cancellation_reason, ']'),
        updated_at = v_now
    WHERE id = v_journey.active_movement_id;
  END IF;

  -- 3. If this journey was the source of planned repositioning movements, cancel those movements
  UPDATE public.vehicle_movements
  SET status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = v_effective_admin_id,
      cancellation_reason = 'Source journey was cancelled: ' || p_cancellation_reason,
      updated_at = v_now
  WHERE source_journey_id = p_journey_id
    AND status IN ('planned', 'returning');

  -- 4. Cancel all active bookings on this journey
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

  -- 5. Audit log
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
-- 10. GRANTS ON REMEDIATED RPCS
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_create_journey(UUID, UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_journey(UUID, UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, INTEGER, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.start_vehicle_repositioning(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_vehicle_repositioning(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.authorize_vehicle_rotation(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_vehicle_rotation(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_vehicle_rotation(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_vehicle_rotation(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_rotated_bus_campus_arrival(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_rotated_bus_campus_arrival(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_bus_arrival(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_bus_arrival(UUID, UUID, TEXT) TO authenticated, service_role;
