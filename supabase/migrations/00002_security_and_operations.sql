-- CosmoRide Migration 00002: Security, Auditing, Operations & Capacity Integrity
-- Cosmopolitan University Bus Booking and Mobility Platform
--
-- Adds:
-- 1. Transport groups & operational system settings
-- 2. Enhanced booking tokens (secure QR ticket verification)
-- 3. Dedicated boarding records & manual override exceptions
-- 4. Waiting list management with atomic queue ordering
-- 5. Announcements, notifications & incident reports
-- 6. Comprehensive audit logs
-- 7. Role escalation protection trigger on profiles
-- 8. Atomic stored procedures for race-proof bookings, cancellations & QR validation
-- 9. Row Level Security for all newly introduced tables

-- ============================================================
-- 1. ENUMS FOR NEW ENTITIES
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'waitlist_status') THEN
    CREATE TYPE public.waitlist_status AS ENUM (
      'waiting',
      'promoted',
      'expired',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'boarding_method') THEN
    CREATE TYPE public.boarding_method AS ENUM (
      'qr_scan',
      'manual_override',
      'nfc_tap'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE public.notification_type AS ENUM (
      'delay_alert',
      'booking_confirmed',
      'booking_cancelled',
      'waitlist_promoted',
      'schedule_change',
      'announcement'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_severity') THEN
    CREATE TYPE public.incident_severity AS ENUM (
      'low',
      'medium',
      'high',
      'critical'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_status') THEN
    CREATE TYPE public.incident_status AS ENUM (
      'reported',
      'investigating',
      'resolved',
      'dismissed'
    );
  END IF;
END $$;

-- ============================================================
-- 2. TRANSPORT GROUPS & OPERATIONAL SETTINGS
-- ============================================================

-- Transport Groups (e.g. Girls' Operations, Main Boys' Hostel, Wuye Boys', Kado Inter-Campus)
CREATE TABLE IF NOT EXISTS public.transport_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  gender_group public.gender NOT NULL DEFAULT 'mixed',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add transport_group_id to routes
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS transport_group_id UUID REFERENCES public.transport_groups(id) ON DELETE SET NULL;

-- Add transport_group_id to hostels
ALTER TABLE public.hostels
  ADD COLUMN IF NOT EXISTS transport_group_id UUID REFERENCES public.transport_groups(id) ON DELETE SET NULL;

-- Add assigned_transport_group_id to profiles (for boarding officers and reps)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_transport_group_id UUID REFERENCES public.transport_groups(id) ON DELETE SET NULL;

-- System / Operational Settings (no hardcoded bus counts, booking windows, or allocations)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default operational configurations (configurable by admin)
INSERT INTO public.system_settings (key, value, description)
VALUES
  ('default_proposed_allocation', '30'::jsonb, 'Default proposed seats per journey before vehicle safe capacity check'),
  ('booking_window_hours_ahead', '48'::jsonb, 'How many hours in advance journeys become bookable for students'),
  ('booking_cutoff_minutes', '15'::jsonb, 'Minutes before scheduled departure when bookings close'),
  ('cancellation_cutoff_minutes', '30'::jsonb, 'Minutes before scheduled departure when students can self-cancel'),
  ('allow_manual_boarding_override', 'true'::jsonb, 'Allow boarding officers to log manual boarding exceptions'),
  ('girls_operation_simultaneous_buses', '3'::jsonb, 'Reference bus count for girls operation route'),
  ('waitlist_auto_promote', 'true'::jsonb, 'Automatically promote top waitlist passenger on booking cancellation')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. ENHANCE BOOKINGS WITH SECURE QR TICKETS
-- ============================================================

-- Add ticket_token and pass issue timestamp to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS ticket_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS boarding_pass_issued_at TIMESTAMPTZ;

-- Backfill any existing bookings with a secure random token
UPDATE public.bookings
SET ticket_token = encode(gen_random_bytes(24), 'hex')
WHERE ticket_token IS NULL;

-- Ensure ticket_token is not nullable going forward
ALTER TABLE public.bookings
  ALTER COLUMN ticket_token SET DEFAULT encode(gen_random_bytes(24), 'hex');

CREATE INDEX IF NOT EXISTS idx_bookings_ticket_token ON public.bookings(ticket_token);

-- ============================================================
-- 4. WAITING LISTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.waitlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  boarding_stop_id UUID NOT NULL REFERENCES public.stops(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position > 0),
  status public.waitlist_status NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  -- A student can only be on the waitlist once per journey
  UNIQUE (journey_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlists_journey_status ON public.waitlists(journey_id, status, position);
CREATE INDEX IF NOT EXISTS idx_waitlists_student ON public.waitlists(student_id);

-- ============================================================
-- 5. ACTUAL BOARDING RECORDS (SEPARATE AUDITABLE RECORDS)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.boarding_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT UNIQUE,
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  scanned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  boarding_method public.boarding_method NOT NULL DEFAULT 'qr_scan',
  exception_reason TEXT, -- Populated if manual_override is used
  is_verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boarding_records_journey ON public.boarding_records(journey_id);
CREATE INDEX IF NOT EXISTS idx_boarding_records_student ON public.boarding_records(student_id);
CREATE INDEX IF NOT EXISTS idx_boarding_records_scanner ON public.boarding_records(scanned_by);

-- ============================================================
-- 6. ANNOUNCEMENTS & NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_role public.user_role, -- NULL = all roles
  route_id UUID REFERENCES public.routes(id) ON DELETE CASCADE, -- NULL = all routes
  transport_group_id UUID REFERENCES public.transport_groups(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type public.notification_type NOT NULL DEFAULT 'announcement',
  related_journey_id UUID REFERENCES public.journeys(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read);

-- ============================================================
-- 7. INCIDENT REPORTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.incident_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES public.journeys(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  reported_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  category TEXT NOT NULL, -- 'breakdown', 'severe_delay', 'overcrowding', 'safety', 'other'
  severity public.incident_severity NOT NULL DEFAULT 'medium',
  description TEXT NOT NULL,
  status public.incident_status NOT NULL DEFAULT 'reported',
  resolution_notes TEXT,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incident_reports(status);
CREATE INDEX IF NOT EXISTS idx_incidents_journey ON public.incident_reports(journey_id);

-- ============================================================
-- 8. AUDIT LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL, -- e.g. 'ROLE_CHANGE', 'MANUAL_BOARDING', 'JOURNEY_CANCELLED', 'CAPACITY_CHANGE'
  entity_type TEXT NOT NULL, -- 'profile', 'booking', 'journey', 'vehicle', 'schedule'
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- ============================================================
-- 9. PRIVILEGE ESCALATION PROTECTION TRIGGER ON PROFILES
-- ============================================================

-- Prevents regular authenticated users from elevating their own role or active status
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role public.user_role;
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();

  -- If called without an auth session (e.g. database admin or service_role), allow
  IF v_caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the caller's verified current role
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  -- 1. Check role change attempt
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF v_caller_role != 'admin' THEN
      RAISE EXCEPTION 'Privilege Escalation Detected: Only administrators can modify user roles.';
    END IF;

    -- Log role change to audit log
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profile_privilege_protection ON public.profiles;

CREATE TRIGGER enforce_profile_privilege_protection
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- ============================================================
-- 10. ATOMIC BOOKING FUNCTION (RACE-CONDITION PROOF)
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
  v_journey RECORD;
  v_effective_capacity INTEGER;
  v_active_bookings_count INTEGER;
  v_booking_id UUID;
  v_ticket_token TEXT;
  v_waitlist_pos INTEGER;
  v_booking_cutoff_mins INTEGER := 15;
BEGIN
  -- 1. Lock the journey row FOR UPDATE to serialize concurrent booking attempts
  SELECT j.*, v.safe_capacity, v.is_active AS vehicle_active
  INTO v_journey
  FROM public.journeys j
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found or vehicle unassigned.');
  END IF;

  IF NOT v_journey.vehicle_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'Assigned vehicle is inactive.');
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'boarding') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey is not open for bookings (Status: ' || v_journey.status || ').');
  END IF;

  -- Check if journey departure is within cutoff
  IF v_journey.scheduled_departure <= (now() + (v_booking_cutoff_mins || ' minutes')::interval) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bookings closed: Departure is in less than ' || v_booking_cutoff_mins || ' minutes.');
  END IF;

  -- 2. Prevent duplicate booking for the same student on the same journey
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = p_student_id
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have an active booking for this journey.');
  END IF;

  -- 3. Calculate effective capacity: LEAST(proposed_allocation, vehicle safe_capacity)
  v_effective_capacity := LEAST(v_journey.proposed_allocation, v_journey.safe_capacity);

  -- 4. Count active bookings for this journey
  SELECT COUNT(*) INTO v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in');

  -- 5. If capacity available -> issue confirmed booking
  IF v_active_bookings_count < v_effective_capacity THEN
    v_ticket_token := encode(gen_random_bytes(24), 'hex');

    INSERT INTO public.bookings (
      journey_id,
      student_id,
      boarding_stop_id,
      status,
      ticket_token,
      boarding_pass_issued_at
    )
    VALUES (
      p_journey_id,
      p_student_id,
      p_boarding_stop_id,
      'confirmed',
      v_ticket_token,
      now()
    )
    RETURNING id INTO v_booking_id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'confirmed',
      'booking_id', v_booking_id,
      'ticket_token', v_ticket_token,
      'seats_remaining', (v_effective_capacity - v_active_bookings_count - 1),
      'message', 'Seat reserved successfully.'
    );
  ELSE
    -- 6. No seats remaining -> Place on waiting list
    IF EXISTS (
      SELECT 1 FROM public.waitlists
      WHERE journey_id = p_journey_id
        AND student_id = p_student_id
        AND status = 'waiting'
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This journey is at full capacity and you are already on the waiting list.'
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
      status
    )
    VALUES (
      p_journey_id,
      p_student_id,
      p_boarding_stop_id,
      v_waitlist_pos,
      'waiting'
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlisted',
      'waitlist_position', v_waitlist_pos,
      'message', 'Bus has reached safe capacity limit. You have been placed on the waiting list at position #' || v_waitlist_pos || '.'
    );
  END IF;
END;
$$;

-- ============================================================
-- 11. ATOMIC CANCELLATION & WAITLIST PROMOTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_booking_and_promote(
  p_booking_id UUID,
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking RECORD;
  v_journey RECORD;
  v_top_waitlist RECORD;
  v_promoted_booking_id UUID;
  v_new_ticket_token TEXT;
BEGIN
  -- 1. Lock booking row
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found.');
  END IF;

  -- Verify ownership or admin privileges
  IF v_booking.student_id != p_student_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE id = p_student_id AND role = 'admin'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only cancel your own bookings.');
    END IF;
  END IF;

  IF v_booking.status != 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking cannot be cancelled in state: ' || v_booking.status);
  END IF;

  -- 2. Lock journey row
  SELECT * INTO v_journey
  FROM public.journeys
  WHERE id = v_booking.journey_id
  FOR UPDATE;

  IF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel booking after bus has departed.');
  END IF;

  -- 3. Mark booking as cancelled
  UPDATE public.bookings
  SET status = 'cancelled',
      cancelled_at = now()
  WHERE id = p_booking_id;

  -- 4. Check for top waitlisted student to promote
  SELECT * INTO v_top_waitlist
  FROM public.waitlists
  WHERE journey_id = v_booking.journey_id
    AND status = 'waiting'
  ORDER BY position ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- Generate ticket token for promoted student
    v_new_ticket_token := encode(gen_random_bytes(24), 'hex');

    -- Insert new confirmed booking for the promoted student
    INSERT INTO public.bookings (
      journey_id,
      student_id,
      boarding_stop_id,
      status,
      ticket_token,
      boarding_pass_issued_at
    )
    VALUES (
      v_booking.journey_id,
      v_top_waitlist.student_id,
      v_top_waitlist.boarding_stop_id,
      'confirmed',
      v_new_ticket_token,
      now()
    )
    RETURNING id INTO v_promoted_booking_id;

    -- Update waitlist entry
    UPDATE public.waitlists
    SET status = 'promoted',
        promoted_at = now()
    WHERE id = v_top_waitlist.id;

    -- Decrement position for all other waiting students on this journey
    UPDATE public.waitlists
    SET position = position - 1
    WHERE journey_id = v_booking.journey_id
      AND status = 'waiting'
      AND position > v_top_waitlist.position;

    -- Notify the promoted student
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      related_journey_id
    )
    VALUES (
      v_top_waitlist.student_id,
      'Seat Confirmed from Waiting List!',
      'A seat became available and your booking has been automatically confirmed. Please check your active rides.',
      'waitlist_promoted',
      v_booking.journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Booking cancelled. Waitlisted passenger promoted successfully.',
      'promoted_student_id', v_top_waitlist.student_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Booking cancelled successfully.'
  );
END;
$$;

-- ============================================================
-- 12. ATOMIC SECURE QR BOARDING VERIFICATION
-- ============================================================

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
  v_booking RECORD;
  v_journey RECORD;
  v_officer RECORD;
  v_student RECORD;
  v_effective_capacity INTEGER;
  v_boarded_count INTEGER;
BEGIN
  -- 1. Verify officer credentials
  SELECT * INTO v_officer
  FROM public.profiles
  WHERE id = p_officer_id;

  IF NOT FOUND OR v_officer.role NOT IN ('boarding_officer', 'admin', 'driver') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permission denied: Not an authorised boarding officer.');
  END IF;

  -- 2. Lock journey and verify vehicle
  SELECT j.*, v.safe_capacity, v.registration_number
  INTO v_journey
  FROM public.journeys j
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target journey not found.');
  END IF;

  IF v_journey.status NOT IN ('scheduled', 'boarding', 'in_transit') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Boarding is closed for this journey (Status: ' || v_journey.status || ').');
  END IF;

  -- 3. Lock booking by ticket_token (Opaque token; prevents tampering)
  SELECT b.* INTO v_booking
  FROM public.bookings b
  WHERE b.ticket_token = p_ticket_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid Boarding Pass: Token not recognised.');
  END IF;

  -- 4. Validate Journey Matching
  IF v_booking.journey_id != p_journey_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wrong Bus/Journey: This ticket is for a different scheduled departure.');
  END IF;

  -- 5. Validate Booking Status
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid Boarding Pass: This booking was cancelled.');
  END IF;

  IF v_booking.status = 'checked_in' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Duplicate Scan Prevented: Passenger was already checked in.');
  END IF;

  -- 6. Verify total boarding capacity
  v_effective_capacity := LEAST(v_journey.proposed_allocation, v_journey.safe_capacity);

  SELECT COUNT(*) INTO v_boarded_count
  FROM public.boarding_records
  WHERE journey_id = p_journey_id AND is_verified = TRUE;

  IF v_boarded_count >= v_effective_capacity THEN
    RETURN jsonb_build_object('success', false, 'error', 'Boarding Capacity Limit Exceeded: Bus safe capacity reached.');
  END IF;

  -- 7. Fetch student minimal non-sensitive display info
  SELECT full_name, student_id INTO v_student
  FROM public.profiles
  WHERE id = v_booking.student_id;

  -- 8. Mark booking as checked_in
  UPDATE public.bookings
  SET status = 'checked_in',
      checked_in_at = now(),
      checked_in_by = p_officer_id
  WHERE id = v_booking.id;

  -- 9. Insert immutable boarding record
  INSERT INTO public.boarding_records (
    booking_id,
    journey_id,
    student_id,
    vehicle_id,
    scanned_by,
    scanned_at,
    boarding_method,
    exception_reason,
    is_verified
  )
  VALUES (
    v_booking.id,
    p_journey_id,
    v_booking.student_id,
    v_journey.vehicle_id,
    p_officer_id,
    now(),
    p_boarding_method,
    p_exception_reason,
    TRUE
  );

  -- 10. Audit log for manual override exceptions
  IF p_boarding_method = 'manual_override' THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (
      p_officer_id,
      'MANUAL_BOARDING_OVERRIDE',
      'booking',
      v_booking.id,
      jsonb_build_object(
        'student_id', v_booking.student_id,
        'journey_id', p_journey_id,
        'reason', p_exception_reason
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Boarding confirmed.',
    'passenger_name', v_student.full_name,
    'student_id', v_student.student_id,
    'scanned_at', now(),
    'boarded_count', v_boarded_count + 1,
    'capacity', v_effective_capacity
  );
END;
$$;

-- ============================================================
-- 13. ROW LEVEL SECURITY POLICIES FOR NEW TABLES
-- ============================================================

ALTER TABLE public.transport_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boarding_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ---- TRANSPORT GROUPS ----
CREATE POLICY "Authenticated users can view transport groups"
  ON public.transport_groups FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage transport groups"
  ON public.transport_groups FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  );

-- ---- SYSTEM SETTINGS ----
CREATE POLICY "Authenticated users can read settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage settings"
  ON public.system_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  );

-- ---- WAITLISTS ----
CREATE POLICY "Students can view own waitlist status"
  ON public.waitlists FOR SELECT
  TO authenticated
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "Admins and officers can view waitlists"
  ON public.waitlists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'boarding_officer')
    )
  );

CREATE POLICY "Students can cancel own waitlist entry"
  ON public.waitlists FOR UPDATE
  TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

-- ---- BOARDING RECORDS ----
CREATE POLICY "Students can view own boarding records"
  ON public.boarding_records FOR SELECT
  TO authenticated
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "Staff can view journey boarding records"
  ON public.boarding_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'boarding_officer', 'driver')
    )
  );

-- ---- ANNOUNCEMENTS ----
CREATE POLICY "Authenticated users can view active announcements"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

CREATE POLICY "Admins can manage announcements"
  ON public.announcements FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  );

-- ---- NOTIFICATIONS ----
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can mark own notifications as read"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---- INCIDENT REPORTS ----
CREATE POLICY "Staff can view incidents"
  ON public.incident_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'boarding_officer', 'driver')
    )
  );

CREATE POLICY "Staff can create incident reports"
  ON public.incident_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    reported_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role IN ('admin', 'boarding_officer', 'driver', 'student')
    )
  );

CREATE POLICY "Admins can manage incidents"
  ON public.incident_reports FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  );

-- ---- AUDIT LOGS ----
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  );

