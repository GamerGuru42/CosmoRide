-- ============================================================
-- COSMORIDE DATABASE MIGRATION 00021
-- CONTROLLED VEHICLE ROTATION & EMPTY REPOSITIONING SUPPORT
--
-- Operational Scope:
-- 1. Extend profiles.admin_role to include 'operations_controller'.
-- 2. Create vehicle_movement_status enum ('planned', 'returning', 'arrived', 'cancelled').
-- 3. Create vehicle_movements table for empty repositioning (deadhead ferry trips).
--    - Completely separate from public.journeys.
--    - Never appears on student Departure Board (FIDS).
--    - Cannot accept student bookings or issue tickets.
-- 4. Alter public.journeys to track vehicle rotation linkage:
--    - is_rotated_vehicle (BOOLEAN DEFAULT FALSE)
--    - active_movement_id (UUID REFERENCES vehicle_movements)
--    - rotation_campus_return_confirmed_at (TIMESTAMPTZ)
--    - rotation_campus_return_confirmed_by (UUID REFERENCES profiles)
--    - rotated_from_journey_id (UUID REFERENCES journeys)
-- 5. Stored Procedures:
--    - authorize_vehicle_rotation: Gated strictly to 'operations_controller'.
--    - confirm_rotated_bus_campus_arrival: Validates return, releases next journey lock.
--    - cancel_vehicle_rotation: Safely cancels movement and unlocks next journey.
--    - check_vehicle_assignment_conflict: Prevents concurrent overlapping assignments.
-- 6. Hardening:
--    - open_journey_boarding blocks boarding if vehicle is still returning (VEHICLE_STILL_RETURNING).
--    - admin_generate_journeys_from_schedules verifies vehicle is not in conflicting assignment.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXTEND PROFILES ADMIN ROLE CHECK CONSTRAINT
-- ------------------------------------------------------------

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_admin_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_admin_role_check
  CHECK (admin_role IS NULL OR admin_role IN ('hostel_manager', 'bus_manager', 'super_admin', 'operations_controller'));

-- ------------------------------------------------------------
-- 2. VEHICLE MOVEMENT STATUS ENUM
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vehicle_movement_status') THEN
    CREATE TYPE public.vehicle_movement_status AS ENUM (
      'planned',
      'returning',
      'arrived',
      'cancelled'
    );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. VEHICLE MOVEMENTS TABLE (EMPTY REPOSITIONING)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.vehicle_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL DEFAULT 'empty_repositioning',
  origin_stop_id UUID REFERENCES public.stops(id) ON DELETE SET NULL,
  origin_name TEXT NOT NULL,
  destination_stop_id UUID REFERENCES public.stops(id) ON DELETE SET NULL,
  destination_name TEXT NOT NULL DEFAULT 'Main Campus Central Bus Park',
  source_journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE RESTRICT,
  next_journey_id UUID REFERENCES public.journeys(id) ON DELETE SET NULL,
  driver_record_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.vehicle_movement_status NOT NULL DEFAULT 'returning',
  initiated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrived_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  operational_reason TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movements_vehicle ON public.vehicle_movements(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_movements_status ON public.vehicle_movements(status);
CREATE INDEX IF NOT EXISTS idx_movements_source ON public.vehicle_movements(source_journey_id);
CREATE INDEX IF NOT EXISTS idx_movements_next ON public.vehicle_movements(next_journey_id);

-- ------------------------------------------------------------
-- 4. ALTER JOURNEYS TABLE FOR ROTATION ATTRIBUTION
-- ------------------------------------------------------------

ALTER TABLE public.journeys
  ADD COLUMN IF NOT EXISTS is_rotated_vehicle BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS active_movement_id UUID REFERENCES public.vehicle_movements(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotation_campus_return_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotation_campus_return_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotated_from_journey_id UUID REFERENCES public.journeys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journeys_rotation ON public.journeys(is_rotated_vehicle, rotation_campus_return_confirmed_at)
  WHERE is_rotated_vehicle = TRUE;

-- ------------------------------------------------------------
-- 5. ENABLE ROW LEVEL SECURITY ON VEHICLE MOVEMENTS
-- ------------------------------------------------------------

ALTER TABLE public.vehicle_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operational staff can view vehicle movements" ON public.vehicle_movements;
CREATE POLICY "Operational staff can view vehicle movements"
  ON public.vehicle_movements FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'boarding_officer', 'driver')
    )
  );

DROP POLICY IF EXISTS "Administrators can manage vehicle movements" ON public.vehicle_movements;
CREATE POLICY "Administrators can manage vehicle movements"
  ON public.vehicle_movements FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
    )
  );

-- ------------------------------------------------------------
-- 6. RPC: CHECK VEHICLE ASSIGNMENT CONFLICT
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
  v_conflict RECORD;
  v_vehicle RECORD;
BEGIN
  -- Verify vehicle exists and is active
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

  -- Check for overlapping uncancelled departure on the same date (within 30 minutes operational buffer)
  SELECT j.id, j.scheduled_departure, j.status, r.name AS route_name
  INTO v_conflict
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.vehicle_id = p_vehicle_id
    AND j.journey_date = p_journey_date
    AND j.status <> 'cancelled'
    AND (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
    AND abs(extract(epoch from (j.scheduled_departure - p_scheduled_departure))) < 1800 -- 30 minutes
  ORDER BY j.scheduled_departure ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'ASSIGNMENT_CONFLICT',
      'conflict_journey_id', v_conflict.id,
      'conflict_time', v_conflict.scheduled_departure,
      'route_name', v_conflict.route_name,
      'error', 'Vehicle is already assigned to ' || v_conflict.route_name || ' departing at ' || to_char(v_conflict.scheduled_departure, 'HH24:MI') || '. Overlapping departures are prohibited.'
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
-- 7. RPC: AUTHORIZE VEHICLE ROTATION (CONTROLLER ONLY)
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
    -- Service role execution requires explicit administrative actor
    v_effective_caller_id := auth.uid();
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

  -- 3. Lock & validate source journey
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

  -- 4. Lock & validate next journey
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

  -- 5. Validate physical vehicle
  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id;

  IF NOT FOUND OR NOT v_vehicle.is_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'VEHICLE_INACTIVE', 'error', 'Physical vehicle is inactive.');
  END IF;

  -- 6. Check for conflict on next journey (excluding current next journey)
  v_conflict := public.check_vehicle_assignment_conflict(
    p_vehicle_id,
    v_next_journey.journey_date,
    v_next_journey.scheduled_departure,
    v_next_journey.id
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

  -- 9. Insert empty repositioning movement
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
    'returning',
    v_effective_caller_id,
    v_now,
    v_reason
  )
  RETURNING id INTO v_movement_id;

  -- 10. Update next journey with rotation lock
  UPDATE public.journeys
  SET vehicle_id = p_vehicle_id,
      driver_record_id = COALESCE(p_driver_record_id, driver_record_id),
      driver_id = COALESCE(v_driver_profile_id, driver_id),
      is_rotated_vehicle = TRUE,
      active_movement_id = v_movement_id,
      rotated_from_journey_id = p_source_journey_id,
      rotation_campus_return_confirmed_at = NULL,
      rotation_campus_return_confirmed_by = NULL,
      updated_at = v_now
  WHERE id = p_next_journey_id;

  -- 11. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_caller_id,
    'VEHICLE_ROTATION_AUTHORIZED',
    'vehicle_movement',
    v_movement_id,
    jsonb_build_object(
      'movement_id', v_movement_id,
      'vehicle_id', p_vehicle_id,
      'vehicle_registration', v_source_journey.bus_reg,
      'source_journey_id', p_source_journey_id,
      'next_journey_id', p_next_journey_id,
      'next_route', v_next_journey.route_name,
      'driver_record_id', p_driver_record_id,
      'operational_reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ROTATION_AUTHORIZED',
    'movement_id', v_movement_id,
    'message', 'Vehicle rotation authorized. Empty repositioning movement created. Boarding on next journey is locked until campus return confirmation.',
    'vehicle_registration', v_source_journey.bus_reg,
    'next_journey_id', p_next_journey_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 8. RPC: CONFIRM ROTATED BUS CAMPUS ARRIVAL (BUS MANAGER / ADMIN)
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
  v_next_journey RECORD;
  v_vehicle RECORD;
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

  -- 5. Update vehicle movement
  UPDATE public.vehicle_movements
  SET status = 'arrived',
      arrived_at = v_now,
      confirmed_by = v_effective_staff_id,
      notes = COALESCE(p_notes, notes),
      updated_at = v_now
  WHERE id = p_movement_id;

  -- 6. Release rotation boarding lock on next journey
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

  -- 7. Audit log
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
-- 9. RPC: CANCEL VEHICLE ROTATION (CONTROLLER ONLY)
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

  v_reason := COALESCE(NULLIF(trim(p_cancellation_reason), ''), 'Operational rotation cancelled by Operations Controller');

  -- 4. Update movement
  UPDATE public.vehicle_movements
  SET status = 'cancelled',
      cancelled_at = v_now,
      cancelled_by = v_effective_caller_id,
      cancellation_reason = v_reason,
      updated_at = v_now
  WHERE id = p_movement_id;

  -- 5. Unlock next journey (clear rotation flags)
  IF v_movement.next_journey_id IS NOT NULL THEN
    SELECT * INTO v_next_journey
    FROM public.journeys
    WHERE id = v_movement.next_journey_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.journeys
      SET is_rotated_vehicle = FALSE,
          active_movement_id = NULL,
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
      'cancellation_reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ROTATION_CANCELLED',
    'message', 'Vehicle rotation cancelled. Vehicle lock released on next journey.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 10. HARDEN open_journey_boarding WITH ROTATION RETURN CHECK
-- ------------------------------------------------------------

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

  -- 5. ROTATION RETURN GUARD: Block boarding if rotated vehicle has not confirmed return
  IF v_journey.is_rotated_vehicle AND v_journey.rotation_campus_return_confirmed_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'VEHICLE_STILL_RETURNING',
      'error', 'Cannot open boarding: Physical vehicle has not yet returned to campus and been confirmed.'
    );
  END IF;

  -- 6. Determine boarding window minutes
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

  -- 7. Validate state transitions
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

  -- 8. Update Journey to boarding open
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
    'message', 'Boarding opened successfully. Boarding countdown initialized to ' || v_window_mins || ' minutes.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 11. RPC: ADMIN GENERATE JOURNEYS WITH CONFLICT PREVENTION
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
  v_actor_type TEXT;
  v_exec_context TEXT;
  v_audit_action TEXT;
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
    v_actor_type := 'human_administrator';
    v_exec_context := 'interactive_admin_session';
    v_audit_action := 'ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE';

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
    v_actor_type := 'scheduled_system_job';
    v_exec_context := 'service_role_system_cron';
    v_audit_action := 'SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE';
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

    -- Pick available fleet vehicle with CONFLICT PREVENTION:
    -- Cannot be in an overlapping uncancelled departure (within 30 mins)
    SELECT v.* INTO v_vehicle
    FROM public.vehicles v
    WHERE v.is_active = TRUE
      AND v.status = 'available'
      AND NOT EXISTS (
        SELECT 1
        FROM public.journeys j
        WHERE j.vehicle_id = v.id
          AND j.journey_date = p_target_date
          AND j.status <> 'cancelled'
          AND abs(extract(epoch from (j.scheduled_departure - v_sched_departure_ts))) < 1800 -- 30 mins
      )
    ORDER BY v.created_at ASC
    LIMIT 1;

    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    IF v_vehicle.safe_capacity IS NULL OR v_vehicle.safe_capacity <= 0 THEN
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
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    v_audit_action,
    'journey_batch',
    NULL,
    jsonb_build_object(
      'target_date', p_target_date,
      'day_of_week', v_dow,
      'created_count', v_created_count,
      'skipped_count', v_skipped_count,
      'route_filter', p_route_id,
      'actor_type', v_actor_type,
      'execution_context', v_exec_context
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'JOURNEYS_GENERATED',
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'message', 'Generated ' || v_created_count || ' journey(s) for ' || p_target_date || ' (' || v_skipped_count || ' skipped).'
  );
END;
$$;

-- ------------------------------------------------------------
-- 12. GRANTS ON NEW RPCS
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.authorize_vehicle_rotation(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_vehicle_rotation(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_rotated_bus_campus_arrival(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_rotated_bus_campus_arrival(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_vehicle_rotation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_vehicle_rotation(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID) TO authenticated, service_role;
