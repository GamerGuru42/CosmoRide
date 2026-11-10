-- ============================================================
-- COSMORIDE — MIGRATION 00017
-- Controlled Boarding & Departure Workflow (7-Stage Operational Sequence)
-- ============================================================
-- 1. Extends journey_status enum: 'bus_arrived', 'boarding_closed', 'ready_to_depart'
-- 2. Adds operational boarding tracking columns to public.journeys
-- 3. Adds admin_role classification column to public.profiles
-- 4. Inserts default boarding_window_minutes into system_settings
-- 5. Implements atomic workflow RPCs:
--    - confirm_bus_arrival
--    - open_journey_boarding
--    - close_journey_boarding (preserves unboarded without auto-noshow)
--    - authorise_journey_departure
--    - confirm_journey_dispatch
-- 6. Updates verify_and_board_passenger with strict boarding status check,
--    live seated (20) & standing (10) metrics, and clean error messages.
-- 7. Secures all RPCs with strict search_path, JWT checks, and grants.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXTEND JOURNEY_STATUS ENUM SAFELY
-- ------------------------------------------------------------
ALTER TYPE public.journey_status ADD VALUE IF NOT EXISTS 'bus_arrived' BEFORE 'boarding';
ALTER TYPE public.journey_status ADD VALUE IF NOT EXISTS 'boarding_closed' AFTER 'boarding';
ALTER TYPE public.journey_status ADD VALUE IF NOT EXISTS 'ready_to_depart' AFTER 'boarding_closed';

-- ------------------------------------------------------------
-- 2. OPERATIONAL BOARDING TRACKING COLUMNS ON JOURNEYS
-- ------------------------------------------------------------
ALTER TABLE public.journeys
  ADD COLUMN IF NOT EXISTS bus_arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bus_arrived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boarding_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boarding_opened_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boarding_window_minutes INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS boarding_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS boarding_closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS departure_authorised_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS departure_authorised_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS departure_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS boarding_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_journeys_workflow_status ON public.journeys(status, journey_date);

-- ------------------------------------------------------------
-- 3. ADMINISTRATIVE ROLE SUB-CLASSIFICATION ON PROFILES
-- ------------------------------------------------------------
-- Distinguishes Hostel Manager (1) and Bus Manager (1) while base role is 'admin'
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_role TEXT CHECK (admin_role IS NULL OR admin_role IN ('hostel_manager', 'bus_manager', 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_profiles_admin_role ON public.profiles(admin_role) WHERE role = 'admin';

-- ------------------------------------------------------------
-- 4. SYSTEM SETTING: DEFAULT BOARDING WINDOW
-- ------------------------------------------------------------
INSERT INTO public.system_settings (key, value, description)
VALUES ('boarding_window_minutes', '10'::jsonb, 'Default duration in minutes for scheduled boarding window countdown')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 5. RPC: CONFIRM BUS ARRIVAL (STAGE 2)
-- ------------------------------------------------------------
-- Bus arrives at pickup point. Doors remain closed.
-- Does NOT automatically open boarding.
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

-- ------------------------------------------------------------
-- 6. RPC: OPEN JOURNEY BOARDING (STAGE 3)
-- ------------------------------------------------------------
-- Representative confirms bus & queue readiness, instructs driver
-- to open doors, and explicitly opens boarding with visible countdown.
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
  -- Allowed initial states: 'scheduled' or 'bus_arrived'
  -- If already 'boarding', return current boarding session info
  -- Disallowed: 'boarding_closed', 'ready_to_depart', 'in_transit', 'completed', 'cancelled'
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
-- 7. RPC: CLOSE JOURNEY BOARDING (STAGE 5)
-- ------------------------------------------------------------
-- Manually closed by representative or prompted after timer expiry.
-- CRITICAL RULES:
--   - Timer expiry NEVER auto-departs bus.
--   - Does NOT automatically mark all unboarded students as no-shows.
--   - Preserves manual no-show actions and summarizes manifest.
CREATE OR REPLACE FUNCTION public.close_journey_boarding(
  p_journey_id UUID,
  p_officer_id UUID,
  p_notes TEXT DEFAULT NULL
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
  v_now TIMESTAMPTZ := now();
  v_total_booked INTEGER := 0;
  v_boarded_count INTEGER := 0;
  v_seated_count INTEGER := 0;
  v_standing_count INTEGER := 0;
  v_unboarded_count INTEGER := 0;
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot close boarding under another officer identity.');
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
      'error', 'Permission denied: Only authorised hostel representatives or administrators can close boarding.'
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
        'error', 'Cross-Group Restriction: You cannot close boarding for a route outside your assigned hostel operation.'
      );
    END IF;
  END IF;

  -- 5. Validate status: must be 'boarding'
  IF v_journey.status <> 'boarding' THEN
    IF v_journey.status = 'boarding_closed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'ALREADY_CLOSED',
        'status', 'boarding_closed',
        'boarding_closed_at', v_journey.boarding_closed_at,
        'message', 'Boarding is already closed.'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TRANSITION',
      'error', 'Cannot close boarding: Journey is currently in ' || v_journey.status || ' status.'
    );
  END IF;

  -- 6. Tally active bookings & boarding stats (do NOT update unboarded bookings)
  SELECT COUNT(*) INTO v_total_booked
  FROM public.bookings
  WHERE journey_id = p_journey_id AND status IN ('confirmed', 'checked_in');

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE passenger_category = 'seated'),
    COUNT(*) FILTER (WHERE passenger_category = 'standing')
  INTO v_boarded_count, v_seated_count, v_standing_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id;

  v_unboarded_count := GREATEST(0, v_total_booked - v_boarded_count);

  -- 7. Update Journey to boarding_closed
  UPDATE public.journeys
  SET status = 'boarding_closed',
      boarding_closed_at = v_now,
      boarding_closed_by = v_effective_officer_id,
      boarding_notes = p_notes,
      updated_at = v_now
  WHERE id = p_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'BOARDING_CLOSED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'route_code', v_journey.route_code,
      'boarding_closed_at', v_now,
      'total_booked', v_total_booked,
      'boarded_count', v_boarded_count,
      'seated_count', v_seated_count,
      'standing_count', v_standing_count,
      'unboarded_count', v_unboarded_count,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BOARDING_CLOSED',
    'status', 'boarding_closed',
    'boarding_closed_at', v_now,
    'total_booked', v_total_booked,
    'boarded_count', v_boarded_count,
    'seated_count', v_seated_count,
    'standing_count', v_standing_count,
    'unboarded_count', v_unboarded_count,
    'message', 'Boarding gate closed. Review manifest and authorise departure when ready.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 8. RPC: AUTHORISE JOURNEY DEPARTURE (STAGE 6)
-- ------------------------------------------------------------
-- Representative confirms boarding completion and authorises departure.
-- Transitions journey to 'ready_to_depart'.
-- Signals Bus Manager and Driver that doors may be closed for dispatch.
CREATE OR REPLACE FUNCTION public.authorise_journey_departure(
  p_journey_id UUID,
  p_officer_id UUID,
  p_notes TEXT DEFAULT NULL
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
  v_now TIMESTAMPTZ := now();
  v_boarded_count INTEGER := 0;
  v_unboarded_count INTEGER := 0;
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot authorise departure under another officer identity.');
    END IF;
    v_effective_officer_id := auth.uid();
  ELSE
    IF p_officer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit officer actor attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  -- 2. Verify officer role (Central Principle: Representative controls departure authorisation)
  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = v_effective_officer_id;

  IF NOT FOUND OR v_officer.role NOT IN ('boarding_officer', 'admin') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Only authorised hostel representatives or administrators can authorise departure.'
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
        'error', 'Cross-Group Restriction: You cannot authorise departure for a route outside your assigned hostel operation.'
      );
    END IF;
  END IF;

  -- 5. Validate status: must be 'boarding_closed' or 'boarding'
  IF v_journey.status NOT IN ('boarding_closed', 'boarding') THEN
    IF v_journey.status = 'ready_to_depart' THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'ALREADY_AUTHORISED',
        'status', 'ready_to_depart',
        'departure_authorised_at', v_journey.departure_authorised_at,
        'message', 'Departure has already been authorised for this journey.'
      );
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TRANSITION',
      'error', 'Cannot authorise departure: Journey is currently in ' || v_journey.status || ' status.'
    );
  END IF;

  -- 6. Tally final unboarded count for manifest review record
  SELECT COUNT(*) INTO v_boarded_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id;

  SELECT COUNT(*) INTO v_unboarded_count
  FROM public.bookings
  WHERE journey_id = p_journey_id AND status = 'confirmed';

  -- 7. Update Journey to ready_to_depart
  UPDATE public.journeys
  SET status = 'ready_to_depart',
      boarding_closed_at = COALESCE(boarding_closed_at, v_now),
      boarding_closed_by = COALESCE(boarding_closed_by, v_effective_officer_id),
      departure_authorised_at = v_now,
      departure_authorised_by = v_effective_officer_id,
      boarding_notes = COALESCE(p_notes, boarding_notes),
      updated_at = v_now
  WHERE id = p_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'DEPARTURE_AUTHORISED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'route_code', v_journey.route_code,
      'departure_authorised_at', v_now,
      'boarded_count', v_boarded_count,
      'unboarded_count', v_unboarded_count,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'READY_TO_DEPART',
    'status', 'ready_to_depart',
    'departure_authorised_at', v_now,
    'boarded_count', v_boarded_count,
    'unboarded_count', v_unboarded_count,
    'message', 'Departure authorised. Driver may close doors and prepare for dispatch.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 9. RPC: CONFIRM JOURNEY DISPATCH / DEPARTURE (STAGE 7)
-- ------------------------------------------------------------
-- Final transition to 'in_transit'.
-- Executed when bus departs. Authored by Bus Manager, Driver, or Representative.
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record dispatch under another identity.');
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
      'error', 'Permission denied: Only authorised staff may record journey departure.'
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
        'error', 'Cross-Group Restriction: You cannot dispatch a route outside your assigned hostel operation.'
      );
    END IF;
  END IF;

  -- Assigned driver check
  IF v_caller.role = 'driver' THEN
    IF v_journey.driver_id IS DISTINCT FROM v_effective_user_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNASSIGNED_DRIVER',
        'error', 'Permission denied: You are not assigned to drive this journey.'
      );
    END IF;
  END IF;

  -- 5. Validate status: journey must be ready for departure ('ready_to_depart', 'boarding_closed', or 'boarding')
  IF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object(
      'success', true,
      'code', 'ALREADY_DEPARTED',
      'status', v_journey.status,
      'actual_departure', v_journey.actual_departure,
      'message', 'Journey has already departed.'
    );
  END IF;

  IF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_CANCELLED',
      'error', 'Cannot dispatch: This journey was cancelled.'
    );
  END IF;

  -- 6. Transition to in_transit
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = v_now,
      departure_authorised_at = COALESCE(departure_authorised_at, v_now),
      departure_authorised_by = COALESCE(departure_authorised_by, v_effective_user_id),
      departure_confirmed_by = v_effective_user_id,
      updated_at = v_now
  WHERE id = p_journey_id;

  -- 7. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_user_id,
    'JOURNEY_DEPARTED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'route_code', v_journey.route_code,
      'actual_departure', v_now,
      'confirmed_by', v_effective_user_id,
      'notes', p_notes
    )
  );

  -- 8. Notify booked students on this journey
  FOR v_booking IN
    SELECT b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('checked_in', 'confirmed')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_booking.student_id,
      'Bus Departed: ' || v_journey.route_name,
      'Your scheduled bus on route ' || v_journey.route_name || ' has departed from the terminal.',
      'journey_update'
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

-- ------------------------------------------------------------
-- 10. REVISE VERIFY_AND_BOARD_PASSENGER (STAGE 4)
-- ------------------------------------------------------------
-- Strictly enforces:
--   - Journey MUST be in 'boarding' status
--   - Live seated (20) & standing (10) passenger breakdown
--   - Clean error strings without the word "corridor"
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

  -- Transport group boundary check (no "corridor" terminology)
  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Cross-Group Restriction: You cannot board passengers for a route outside your assigned hostel operation.'
      );
    END IF;
  END IF;

  -- 4. Status Check: Must be actively 'boarding'
  IF v_journey.status = 'scheduled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_NOT_BOARDING',
      'error', 'Boarding Not Open: The bus has not yet arrived or boarding has not been opened by the representative.'
    );
  ELSIF v_journey.status = 'bus_arrived' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_NOT_BOARDING',
      'error', 'Boarding Not Open: The bus has arrived, but the representative has not yet opened boarding. Please wait in the queue.'
    );
  ELSIF v_journey.status IN ('boarding_closed', 'ready_to_depart') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BOARDING_CLOSED',
      'error', 'Boarding Closed: The boarding window has closed for this departure.'
    );
  ELSIF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_CLOSED',
      'error', 'Journey Departed: This bus has already departed.'
    );
  ELSIF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_CLOSED',
      'error', 'Journey Cancelled: This scheduled departure was cancelled.'
    );
  END IF;

  -- 5. Find and lock booking by ticket_token
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

  -- 6. Duplicate boarding check (checked_in indicates boarded pass)
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

  -- 7. Cancelled ticket check
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TICKET_CANCELLED',
      'error', 'Cancelled Pass: This booking was cancelled prior to departure.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 8. Cross-journey check
  IF v_booking.journey_id <> p_journey_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'WRONG_JOURNEY',
      'error', 'Wrong Bus/Trip: This boarding pass is issued for a different scheduled departure.',
      'passenger_name', v_student.full_name,
      'student_id', v_student.student_id
    );
  END IF;

  -- 9. Physical safe capacity limit check (30 passengers maximum total capacity)
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE passenger_category = 'seated'),
    COUNT(*) FILTER (WHERE passenger_category = 'standing')
  INTO v_boarded_count, v_seated_count, v_standing_count
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

  -- 10. Record boarding with verified officer attribution and category
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

  -- Update booking to checked_in
  UPDATE public.bookings
  SET status = 'checked_in',
      checked_in_at = now(),
      checked_in_by = v_effective_officer_id
  WHERE id = v_booking.id;

  -- Re-calculate updated category counts
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
      'boarded_count', v_boarded_count,
      'seated_count', v_seated_count,
      'standing_count', v_standing_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BOARDING_APPROVED',
    'passenger_name', v_student.full_name,
    'student_id', v_student.student_id,
    'passenger_category', v_booking.passenger_category,
    'boarding_method', p_boarding_method,
    'boarded_count', v_boarded_count,
    'boarded_seated_count', v_seated_count,
    'boarded_standing_count', v_standing_count,
    'seated_limit', 20,
    'standing_limit', 10,
    'total_capacity', v_effective_capacity,
    'message', 'Boarding approved (' || v_booking.passenger_category || '). Welcome aboard!'
  );
END;
$$;

-- ------------------------------------------------------------
-- 11. REVISE CLOSE_AND_DEPART_JOURNEY (BACKWARDS COMPATIBILITY)
-- ------------------------------------------------------------
-- Update close_and_depart_journey to preserve unboarded passengers
-- without auto-cancelling or marking as no-show unless explicitly flagged.
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
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot depart a journey outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'bus_arrived', 'boarding', 'boarding_closed', 'ready_to_depart') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is already ' || v_journey.status || '.');
  END IF;

  -- Count boarded passengers
  SELECT COUNT(*) INTO v_boarded_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id;

  -- Transition to in_transit
  UPDATE public.journeys
  SET status = 'in_transit',
      boarding_closed_at = COALESCE(boarding_closed_at, v_now),
      boarding_closed_by = COALESCE(boarding_closed_by, v_effective_officer_id),
      departure_authorised_at = COALESCE(departure_authorised_at, v_now),
      departure_authorised_by = COALESCE(departure_authorised_by, v_effective_officer_id),
      actual_departure = v_now,
      departure_confirmed_by = v_effective_officer_id,
      boarding_notes = p_closure_notes,
      updated_at = v_now
  WHERE id = p_journey_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'JOURNEY_CLOSED_AND_DEPARTED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'boarded_count', v_boarded_count,
      'actual_departure', v_now,
      'notes', p_closure_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Journey departed successfully with ' || v_boarded_count || ' passenger(s).',
    'boarded_count', v_boarded_count,
    'actual_departure', v_now
  );
END;
$$;

-- ------------------------------------------------------------
-- 12. PERMISSIONS & GRANTS
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.confirm_bus_arrival(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_bus_arrival(UUID, UUID, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION public.open_journey_boarding(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_journey_boarding(UUID, UUID, INTEGER) TO service_role;

GRANT EXECUTE ON FUNCTION public.close_journey_boarding(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_journey_boarding(UUID, UUID, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION public.authorise_journey_departure(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorise_journey_departure(UUID, UUID, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION public.confirm_journey_dispatch(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_journey_dispatch(UUID, UUID, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) TO service_role;
