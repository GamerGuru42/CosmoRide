-- CosmoRide Migration 00005: Transport Administration & Operational Control Centre
-- Cosmopolitan University, Nigeria
--
-- Implements:
-- 1. Fleet enhancements: vehicle operational status, ownership type, vehicle reference, maintenance notes.
-- 2. Driver enhancements: license expiry date.
-- 3. Announcement targeting enhancements: optional campus_id scope.
-- 4. Atomic administrative procedures:
--    - admin_generate_journeys_from_schedules: Generates daily journeys from active schedule templates.
--    - admin_cancel_journey: Safely cancels a journey, voids bookings, notifies students, logs audit trail.
--    - admin_update_system_setting: Updates configurable policies with audit logging.
--    - admin_update_incident_status: Updates incident resolution state with audit trail.
-- 5. Additional institutional system settings for booking policies.

-- ============================================================
-- 1. FLEET & DRIVER ENHANCEMENTS
-- ============================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'available', -- 'available', 'assigned', 'maintenance', 'unavailable', 'retired'
  ADD COLUMN IF NOT EXISTS ownership_type TEXT NOT NULL DEFAULT 'university_owned', -- 'university_owned', 'contracted', 'leased'
  ADD COLUMN IF NOT EXISTS vehicle_reference TEXT,
  ADD COLUMN IF NOT EXISTS maintenance_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_vehicles_status ON public.vehicles(status);

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS license_expiry DATE;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS campus_id UUID REFERENCES public.campuses(id) ON DELETE CASCADE;

-- Insert additional booking policy configurations
INSERT INTO public.system_settings (key, value, description)
VALUES
  ('max_active_bookings_per_student', '2'::jsonb, 'Maximum number of concurrent active future bookings a student can hold'),
  ('allow_same_day_booking', 'true'::jsonb, 'Whether students are permitted to book journeys departing on the current calendar day'),
  ('require_journey_approval', 'false'::jsonb, 'Whether scheduled journeys require supervisor release before public booking opens')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. ATOMIC JOURNEY GENERATION FROM SCHEDULE TEMPLATES
-- ============================================================

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
  v_admin RECORD;
  v_dow INTEGER;
  v_sched RECORD;
  v_vehicle RECORD;
  v_driver RECORD;
  v_created_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_effective_alloc INTEGER;
BEGIN
  -- 1. Verify caller is an administrator
  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Caller must be an administrator.');
  END IF;

  -- 2. Day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  v_dow := EXTRACT(DOW FROM p_target_date);

  -- 3. Loop over active schedules matching day of week
  FOR v_sched IN
    SELECT s.*, r.transport_group_id
    FROM public.schedules s
    JOIN public.routes r ON r.id = s.route_id
    WHERE s.is_active = TRUE
      AND s.day_of_week = v_dow
      AND (p_route_id IS NULL OR s.route_id = p_route_id)
    ORDER BY s.departure_time ASC
  LOOP
    -- Check if journey already exists for this schedule and target date
    IF EXISTS (
      SELECT 1 FROM public.journeys
      WHERE schedule_id = v_sched.id AND journey_date = p_target_date
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Find an available vehicle (preferring active vehicles not in maintenance or retired)
    SELECT * INTO v_vehicle
    FROM public.vehicles
    WHERE is_active = TRUE AND status IN ('available', 'assigned')
    ORDER BY id ASC
    LIMIT 1;

    IF NOT FOUND THEN
      -- Fallback to any active vehicle
      SELECT * INTO v_vehicle
      FROM public.vehicles
      WHERE is_active = TRUE
      ORDER BY id ASC
      LIMIT 1;
    END IF;

    -- Find an active driver record for this vehicle or general pool
    SELECT * INTO v_driver
    FROM public.drivers
    WHERE status = 'active'
    ORDER BY id ASC
    LIMIT 1;

    -- Calculate safe capacity ceiling
    IF v_vehicle.safe_capacity IS NOT NULL THEN
      v_effective_alloc := LEAST(v_sched.proposed_allocation, v_vehicle.safe_capacity);
    ELSE
      v_effective_alloc := v_sched.proposed_allocation;
    END IF;

    -- Insert journey
    INSERT INTO public.journeys (
      schedule_id,
      route_id,
      vehicle_id,
      driver_id,
      driver_record_id,
      journey_date,
      scheduled_departure,
      proposed_allocation,
      status,
      created_by
    )
    VALUES (
      v_sched.id,
      v_sched.route_id,
      v_vehicle.id,
      v_driver.profile_id,
      v_driver.id,
      p_target_date,
      (p_target_date || ' ' || v_sched.departure_time)::timestamptz,
      v_effective_alloc,
      'scheduled',
      p_admin_id
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  -- 4. Record audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, details)
  VALUES (
    p_admin_id,
    'SCHEDULE_JOURNEYS_GENERATED',
    'journey',
    jsonb_build_object(
      'target_date', p_target_date,
      'created_count', v_created_count,
      'skipped_count', v_skipped_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Generated ' || v_created_count || ' scheduled journeys for ' || p_target_date || ' (' || v_skipped_count || ' already existed).',
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

-- ============================================================
-- 3. ATOMIC JOURNEY CANCELLATION WORKFLOW
-- ============================================================

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
  v_admin RECORD;
  v_journey RECORD;
  v_booking RECORD;
  v_cancelled_bookings INTEGER := 0;
BEGIN
  -- Verify admin
  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Only administrators can cancel scheduled journeys.');
  END IF;

  -- Lock journey
  SELECT j.*, r.code AS route_code, r.name AS route_name
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;

  IF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is already marked cancelled.');
  END IF;

  -- Update journey status
  UPDATE public.journeys
  SET status = 'cancelled',
      delay_reason = 'CANCELLED: ' || p_cancellation_reason
  WHERE id = p_journey_id;

  -- Cancel all active bookings on this journey and notify students
  FOR v_booking IN
    SELECT id, student_id
    FROM public.bookings
    WHERE journey_id = p_journey_id AND status IN ('confirmed', 'checked_in')
  LOOP
    UPDATE public.bookings
    SET status = 'cancelled',
        cancelled_at = now()
    WHERE id = v_booking.id;

    -- Insert student notification
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      related_journey_id
    )
    VALUES (
      v_booking.student_id,
      'Journey Cancelled: ' || v_journey.route_code,
      'The scheduled departure for ' || v_journey.route_name || ' on ' || v_journey.journey_date || ' has been cancelled by transport administration. Reason: ' || p_cancellation_reason,
      'booking_cancelled',
      p_journey_id
    );

    v_cancelled_bookings := v_cancelled_bookings + 1;
  END LOOP;

  -- Cancel any waitlists
  UPDATE public.waitlists
  SET status = 'cancelled',
      cancelled_at = now()
  WHERE journey_id = p_journey_id AND status = 'waiting';

  -- Record audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_admin_id,
    'JOURNEY_CANCELLED_BY_ADMIN',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'reason', p_cancellation_reason,
      'cancelled_bookings', v_cancelled_bookings
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Journey cancelled. ' || v_cancelled_bookings || ' student booking(s) voided and notified.',
    'cancelled_bookings', v_cancelled_bookings
  );
END;
$$;

-- ============================================================
-- 4. ATOMIC SYSTEM SETTING UPDATE
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
  v_admin RECORD;
  v_old_value JSONB;
BEGIN
  -- Verify admin
  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  SELECT value INTO v_old_value
  FROM public.system_settings
  WHERE key = p_key;

  INSERT INTO public.system_settings (key, value, description, updated_by, updated_at)
  VALUES (p_key, p_value, p_description, p_admin_id, now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, public.system_settings.description),
      updated_by = p_admin_id,
      updated_at = now();

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, details)
  VALUES (
    p_admin_id,
    'SYSTEM_SETTING_UPDATED',
    'system_setting',
    jsonb_build_object(
      'key', p_key,
      'old_value', v_old_value,
      'new_value', p_value
    )
  );

  RETURN jsonb_build_object('success', true, 'message', 'Setting ' || p_key || ' updated successfully.');
END;
$$;

-- ============================================================
-- 5. ATOMIC INCIDENT STATUS UPDATE
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_update_incident_status(
  p_admin_id UUID,
  p_incident_id UUID,
  p_status public.incident_status,
  p_resolution_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin RECORD;
BEGIN
  -- Verify admin
  SELECT * INTO v_admin
  FROM public.profiles
  WHERE id = p_admin_id;

  IF NOT FOUND OR v_admin.role != 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied.');
  END IF;

  UPDATE public.incident_reports
  SET status = p_status,
      resolution_notes = p_resolution_notes,
      resolved_by = p_admin_id,
      resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_incident_id;

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_admin_id,
    'INCIDENT_STATUS_UPDATED',
    'incident_report',
    p_incident_id,
    jsonb_build_object(
      'new_status', p_status,
      'resolution_notes', p_resolution_notes
    )
  );

  RETURN jsonb_build_object('success', true, 'message', 'Incident updated to ' || p_status || '.');
END;
$$;

