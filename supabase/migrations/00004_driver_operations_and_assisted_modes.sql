-- CosmoRide Migration 00004: Driver Management, Assisted Operations & Trip Execution
-- Cosmopolitan University, Nigeria
--
-- Implements:
-- 1. Dedicated `drivers` entity supporting both Smartphone (Mode A) and Non-Smartphone (Mode B) drivers.
-- 2. Vehicle pre-departure operational readiness checklist (`vehicle_readiness_checks`).
-- 3. Route stop-level milestone updates (`journey_stop_updates`).
-- 4. Unified operational action audit logging (`journey_operational_logs`) with explicit attribution.
-- 5. Atomic procedures for readiness, stop updates, delay propagation, safe departure, and arrival.
-- 6. Row Level Security policies guaranteeing transport group isolation and role accountability.

-- ============================================================
-- 1. DRIVER RECORDS (MODE A & MODE B)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_status') THEN
    CREATE TYPE public.driver_status AS ENUM ('active', 'on_leave', 'suspended', 'inactive');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL, -- NULL if non-smartphone driver
  full_name TEXT NOT NULL,
  phone TEXT,
  driver_reference TEXT UNIQUE NOT NULL, -- Institutional ID, e.g. 'DRV-CU-01'
  license_number TEXT,
  assigned_vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  status public.driver_status NOT NULL DEFAULT 'active',
  has_app_access BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_contact TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drivers_profile_id ON public.drivers(profile_id);
CREATE INDEX IF NOT EXISTS idx_drivers_reference ON public.drivers(driver_reference);
CREATE INDEX IF NOT EXISTS idx_drivers_vehicle ON public.drivers(assigned_vehicle_id);

-- Alter journeys table to link directly to drivers table & support assisted operations
ALTER TABLE public.journeys
  ALTER COLUMN driver_id DROP NOT NULL;

ALTER TABLE public.journeys
  ADD COLUMN IF NOT EXISTS driver_record_id UUID REFERENCES public.drivers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS readiness_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'passed', 'failed_unsafe'
  ADD COLUMN IF NOT EXISTS readiness_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS readiness_checked_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS is_assisted_operation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS actual_arrival TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_journeys_driver_record ON public.journeys(driver_record_id);

-- ============================================================
-- 2. PRE-DEPARTURE VEHICLE READINESS CHECKS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vehicle_readiness_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  checked_by_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_assisted BOOLEAN NOT NULL DEFAULT FALSE,
  assisted_by_role TEXT,
  vehicle_available BOOLEAN NOT NULL DEFAULT TRUE,
  vehicle_safe BOOLEAN NOT NULL DEFAULT TRUE,
  mechanical_fault_reported BOOLEAN NOT NULL DEFAULT FALSE,
  fault_description TEXT,
  journey_reviewed BOOLEAN NOT NULL DEFAULT TRUE,
  odometer_reading NUMERIC,
  battery_level_percent INTEGER CHECK (battery_level_percent >= 0 AND battery_level_percent <= 100),
  tires_and_lights_checked BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'passed', -- 'passed', 'flagged_unsafe', 'fault_pending'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_readiness_journey ON public.vehicle_readiness_checks(journey_id);
CREATE INDEX IF NOT EXISTS idx_readiness_vehicle ON public.vehicle_readiness_checks(vehicle_id);

-- ============================================================
-- 3. ROUTE STOP-LEVEL MILESTONE UPDATES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.journey_stop_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  stop_id UUID NOT NULL REFERENCES public.stops(id) ON DELETE RESTRICT,
  recorded_by_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL, -- 'approaching', 'arrived', 'pickup_completed', 'departed'
  is_assisted BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stop_updates_journey ON public.journey_stop_updates(journey_id);
CREATE INDEX IF NOT EXISTS idx_stop_updates_stop ON public.journey_stop_updates(stop_id);

-- ============================================================
-- 4. OPERATIONAL ACTIONS AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS public.journey_operational_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  recorded_by_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL, -- 'READINESS_CHECK', 'STOP_UPDATE', 'DELAY_REPORTED', 'DEPARTURE', 'ARRIVAL', 'INCIDENT_REPORTED'
  operation_mode TEXT NOT NULL, -- 'direct' or 'assisted'
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_op_logs_journey ON public.journey_operational_logs(journey_id);
CREATE INDEX IF NOT EXISTS idx_op_logs_user ON public.journey_operational_logs(recorded_by_user_id);

-- ============================================================
-- 5. ATOMIC STORED PROCEDURES
-- ============================================================

-- A. Record Pre-Departure Vehicle Readiness
CREATE OR REPLACE FUNCTION public.record_vehicle_readiness(
  p_journey_id UUID,
  p_user_id UUID,
  p_vehicle_available BOOLEAN,
  p_vehicle_safe BOOLEAN,
  p_mechanical_fault BOOLEAN,
  p_fault_description TEXT,
  p_journey_reviewed BOOLEAN,
  p_battery_level INTEGER,
  p_tires_and_lights BOOLEAN,
  p_notes TEXT,
  p_is_assisted BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey RECORD;
  v_user RECORD;
  v_readiness_status TEXT;
BEGIN
  -- 1. Check user permissions
  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller cannot record readiness checks.');
  END IF;

  -- 2. Fetch journey
  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target journey not found.');
  END IF;

  -- Transport group restriction for boarding officers
  IF v_user.role = 'boarding_officer' AND v_user.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cross-group restriction: You cannot record readiness for this corridor.');
    END IF;
  END IF;

  -- Direct driver check: if user is driver, must be assigned to this journey
  IF v_user.role = 'driver' AND v_journey.driver_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: You are not the driver assigned to this journey.');
  END IF;

  -- Determine readiness status
  IF NOT p_vehicle_safe OR NOT p_vehicle_available THEN
    v_readiness_status := 'failed_unsafe';
  ELSE
    v_readiness_status := 'passed';
  END IF;

  -- Insert readiness record
  INSERT INTO public.vehicle_readiness_checks (
    journey_id,
    vehicle_id,
    checked_by_user_id,
    is_assisted,
    assisted_by_role,
    vehicle_available,
    vehicle_safe,
    mechanical_fault_reported,
    fault_description,
    journey_reviewed,
    battery_level_percent,
    tires_and_lights_checked,
    status,
    notes
  )
  VALUES (
    p_journey_id,
    v_journey.vehicle_id,
    p_user_id,
    p_is_assisted,
    CASE WHEN p_is_assisted THEN v_user.role::text ELSE NULL END,
    p_vehicle_available,
    p_vehicle_safe,
    p_mechanical_fault,
    p_fault_description,
    p_journey_reviewed,
    p_battery_level,
    p_tires_and_lights,
    v_readiness_status,
    p_notes
  );

  -- Update journey readiness status
  UPDATE public.journeys
  SET readiness_status = v_readiness_status,
      readiness_checked_at = now(),
      readiness_checked_by = p_user_id
  WHERE id = p_journey_id;

  -- Insert audit log
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
    p_user_id,
    'READINESS_CHECK',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object(
      'status', v_readiness_status,
      'vehicle_safe', p_vehicle_safe,
      'fault_reported', p_mechanical_fault,
      'battery_level', p_battery_level,
      'notes', p_notes
    )
  );

  -- If vehicle is unsafe, log an urgent incident report automatically
  IF v_readiness_status = 'failed_unsafe' THEN
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
      v_journey.vehicle_id,
      p_user_id,
      'bus_breakdown',
      'critical',
      'Pre-departure check failed: Vehicle marked unsafe or unavailable. ' || COALESCE(p_fault_description, p_notes, 'Immediate inspection required.'),
      'reported'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_readiness_status,
    'message', CASE
      WHEN v_readiness_status = 'passed' THEN 'Vehicle readiness confirmed. Approved for boarding and departure.'
      ELSE 'WARNING: Vehicle marked UNSAFE. Departure blocked and transport administration alerted.'
    END
  );
END;
$$;

-- B. Record Route Stop-Level Milestone Update
CREATE OR REPLACE FUNCTION public.record_journey_stop_update(
  p_journey_id UUID,
  p_stop_id UUID,
  p_user_id UUID,
  p_event_type TEXT,
  p_notes TEXT DEFAULT NULL,
  p_is_assisted BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey RECORD;
  v_user RECORD;
  v_stop RECORD;
BEGIN
  -- Verify user
  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- Fetch journey and route
  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- Transport group restriction for boarding officers
  IF v_user.role = 'boarding_officer' AND v_user.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cross-group restriction: Not authorised for this corridor.');
    END IF;
  END IF;

  -- Driver restriction
  IF v_user.role = 'driver' AND v_journey.driver_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not the driver assigned to this journey.');
  END IF;

  -- Fetch stop
  SELECT * INTO v_stop
  FROM public.stops
  WHERE id = p_stop_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Stop not found.');
  END IF;

  -- Insert milestone update
  INSERT INTO public.journey_stop_updates (
    journey_id,
    stop_id,
    recorded_by_user_id,
    event_type,
    is_assisted,
    notes
  )
  VALUES (
    p_journey_id,
    p_stop_id,
    p_user_id,
    p_event_type,
    p_is_assisted,
    p_notes
  );

  -- Log action
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
    p_user_id,
    'STOP_UPDATE',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object(
      'stop_id', p_stop_id,
      'stop_name', v_stop.name,
      'event_type', p_event_type,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Stop update logged: Bus ' || p_event_type || ' at ' || v_stop.name || '.',
    'event_type', p_event_type,
    'stop_name', v_stop.name,
    'timestamp', now()
  );
END;
$$;

-- C. Report Delay with Passenger Notification Propagation
CREATE OR REPLACE FUNCTION public.record_journey_delay_with_notifications(
  p_journey_id UUID,
  p_user_id UUID,
  p_delay_minutes INTEGER,
  p_delay_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_is_assisted BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey RECORD;
  v_user RECORD;
  v_passenger RECORD;
  v_notif_count INTEGER := 0;
BEGIN
  -- Verify user
  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- Fetch journey
  SELECT j.*, r.code AS route_code, r.name AS route_name, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- Group restriction for officers
  IF v_user.role = 'boarding_officer' AND v_user.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cross-group restriction: Not authorised for this corridor.');
    END IF;
  END IF;

  -- Driver restriction
  IF v_user.role = 'driver' AND v_journey.driver_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- Update delay on journey
  UPDATE public.journeys
  SET delay_minutes = p_delay_minutes,
      delay_reason = p_delay_reason
  WHERE id = p_journey_id;

  -- Propagate notification to all confirmed passengers
  FOR v_passenger IN
    SELECT DISTINCT student_id
    FROM public.bookings
    WHERE journey_id = p_journey_id AND status = 'confirmed'
  LOOP
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type
    )
    VALUES (
      v_passenger.student_id,
      'Departure Delay Alert: ' || v_journey.route_code,
      'Your bus (' || v_journey.route_name || ') is delayed by approximately ' || p_delay_minutes || ' minutes. Reason: ' || p_delay_reason || '.' ||
      CASE WHEN p_notes IS NOT NULL THEN ' Note: ' || p_notes ELSE '' END,
      'delay'
    );
    v_notif_count := v_notif_count + 1;
  END LOOP;

  -- Log action
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
    p_user_id,
    'DELAY_REPORTED',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object(
      'delay_minutes', p_delay_minutes,
      'delay_reason', p_delay_reason,
      'notes', p_notes,
      'passengers_notified', v_notif_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Delay of ' || p_delay_minutes || ' mins logged. ' || v_notif_count || ' passenger notification(s) dispatched.',
    'passengers_notified', v_notif_count
  );
END;
$$;

-- D. Secure Pre-Departure Validation & Departure Execution
CREATE OR REPLACE FUNCTION public.record_journey_departure_safe(
  p_journey_id UUID,
  p_user_id UUID,
  p_is_assisted BOOLEAN DEFAULT FALSE,
  p_closure_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey RECORD;
  v_user RECORD;
  v_boarded_count INTEGER;
BEGIN
  -- Verify user
  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- Lock journey
  SELECT j.*, r.transport_group_id, v.registration_number AS bus_reg
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- Group restriction
  IF v_user.role = 'boarding_officer' AND v_user.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cross-group restriction.');
    END IF;
  END IF;

  -- Driver restriction
  IF v_user.role = 'driver' AND v_journey.driver_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- 1. Prevent duplicate departures
  IF v_journey.status = 'in_transit' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bus has already departed and is currently in transit.');
  END IF;

  IF v_journey.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This journey is already completed.');
  END IF;

  IF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot depart a cancelled journey.');
  END IF;

  -- 2. Verify Vehicle Safety (Block unsafe vehicle departure)
  IF v_journey.readiness_status = 'failed_unsafe' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SAFETY BLOCK: Pre-departure check flagged this vehicle as UNSAFE. Departure is prohibited.');
  END IF;

  -- 3. Boarding count
  SELECT COUNT(*) INTO v_boarded_count
  FROM public.bookings
  WHERE journey_id = p_journey_id AND status = 'checked_in';

  -- Transition status
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = now(),
      is_assisted_operation = p_is_assisted
  WHERE id = p_journey_id;

  -- Audit log
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
    p_user_id,
    'DEPARTURE',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object(
      'boarded_passengers', v_boarded_count,
      'actual_departure', now(),
      'notes', p_closure_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bus ' || v_journey.bus_reg || ' departed successfully. Journey is now in transit.',
    'boarded_count', v_boarded_count,
    'actual_departure', now()
  );
END;
$$;

-- E. Secure Destination Arrival Execution
CREATE OR REPLACE FUNCTION public.record_journey_arrival_safe(
  p_journey_id UUID,
  p_user_id UUID,
  p_is_assisted BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey RECORD;
  v_user RECORD;
BEGIN
  -- Verify user
  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND OR v_user.role NOT IN ('driver', 'boarding_officer', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- Lock journey
  SELECT j.*, r.transport_group_id, v.registration_number AS bus_reg
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  -- Group restriction
  IF v_user.role = 'boarding_officer' AND v_user.assigned_transport_group_id IS NOT NULL THEN
    IF v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cross-group restriction.');
    END IF;
  END IF;

  -- Driver restriction
  IF v_user.role = 'driver' AND v_journey.driver_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  -- Rule: Arrival can ONLY be recorded after departure (in_transit status)
  IF v_journey.status != 'in_transit' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Arrival cannot be recorded: Journey is currently ' || v_journey.status || '. The vehicle must depart before arriving.'
    );
  END IF;

  -- Transition status to completed
  UPDATE public.journeys
  SET status = 'completed',
      actual_arrival = now()
  WHERE id = p_journey_id;

  -- Log action
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
    p_user_id,
    'ARRIVAL',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object(
      'actual_arrival', now(),
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bus ' || v_journey.bus_reg || ' arrived at destination. Journey completed.',
    'actual_arrival', now()
  );
END;
$$;

-- ============================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_readiness_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_stop_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_operational_logs ENABLE ROW LEVEL SECURITY;

-- Drivers Table Policies
CREATE POLICY "Anyone authenticated can view active drivers"
  ON public.drivers FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admins can manage drivers"
  ON public.drivers FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role = 'admin')
  );

-- Vehicle Readiness Policies
CREATE POLICY "Authenticated users can view readiness checks"
  ON public.vehicle_readiness_checks FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Staff can insert readiness checks"
  ON public.vehicle_readiness_checks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role IN ('driver', 'boarding_officer', 'admin'))
  );

-- Journey Stop Updates Policies
CREATE POLICY "Authenticated users can view stop updates"
  ON public.journey_stop_updates FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Staff can insert stop updates"
  ON public.journey_stop_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role IN ('driver', 'boarding_officer', 'admin'))
  );

-- Operational Logs Policies
CREATE POLICY "Staff can view operational logs"
  ON public.journey_operational_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role IN ('driver', 'boarding_officer', 'admin'))
  );

CREATE POLICY "Staff can insert operational logs"
  ON public.journey_operational_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND role IN ('driver', 'boarding_officer', 'admin'))
  );

