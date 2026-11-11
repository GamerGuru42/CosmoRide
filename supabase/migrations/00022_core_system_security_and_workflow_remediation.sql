-- ============================================================================
-- COSMORIDE — MIGRATION 00022
-- Consolidated Core System Security, RLS, Scheduling & Workflow Remediation
-- ============================================================================
-- Strictly additive forward migration preserving migrations 00001-00021.
-- Vehicle Rotation remains permanently removed and is not reintroduced.
--
-- Remediations implemented:
-- 1. Route duration column (`routes.estimated_duration_minutes`, nullable) and
--    duration-aware, fail-closed vehicle & driver availability enforcement.
-- 2. Trigger hardening (`trg_enforce_journey_vehicle_availability`) covering
--    insert, vehicle/route/schedule/delay/driver updates, and un-cancellation.
-- 3. Non-recursive SECURITY DEFINER RLS helper functions eliminating profiles <->
--    journeys <-> bookings policy recursion and enforcing `admin_role` boundaries.
-- 4. Hardened `protect_profile_privileges()` trigger preventing non-super_admin
--    privilege escalation and protecting `admin_role`, `role`, `is_active`,
--    `assigned_transport_group_id`, `hostel_id`, and `student_id`.
-- 5. Removal of legacy permissive/fail-open RLS policies across core tables.
-- 6. Student onboarding & eligibility fixes (`complete_student_profile` with
--    optional active hostel linkage, `select_student_hostel`, closed gender checks,
--    and `TOO_MANY_ROWS` / `boarding_records` category upgrade sync fixes).
-- 7. Strict 7-stage journey workflow enforcement across `confirm_bus_arrival`,
--    `open_journey_boarding`, `close_journey_boarding`,
--    `authorise_journey_departure`, `confirm_journey_dispatch`,
--    `close_and_depart_journey`, `record_journey_departure_safe`,
--    `record_journey_arrival_safe`, and `record_journey_delay_with_notifications`.
-- 8. Audited RPCs `mark_passenger_no_show` and `cancel_waitlist_entry`, plus
--    fixed `admin_cancel_journey` notification enum/columns & waitlist cleanup.
-- 9. Strict least-privilege REVOKE/GRANT permissions on all RPCs & helpers.
-- ============================================================================

-- ============================================================================
-- 1. SCHEMA ADDITIONS (NO FABRICATED DEFAULTS)
-- ============================================================================

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routes_estimated_duration_minutes_check'
  ) THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_estimated_duration_minutes_check
      CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0);
  END IF;
END $$;

-- ============================================================================
-- 2. NON-RECURSIVE SECURITY DEFINER RLS HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rls_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.rls_user_is_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid()),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_admin_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p.role = 'admin' AND p.is_active = TRUE THEN p.admin_role
    ELSE NULL
  END
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.rls_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.is_active = TRUE
      AND p.admin_role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_assigned_transport_group()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.assigned_transport_group_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.is_active = TRUE;
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
    FROM public.journeys j
    LEFT JOIN public.drivers d ON d.id = j.driver_record_id
    WHERE j.id = p_journey_id
      AND (
        j.driver_id = auth.uid()
        OR d.profile_id = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.rls_staff_can_view_profile(p_target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT id, role, admin_role, assigned_transport_group_id, is_active
  INTO v_caller
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT FOUND OR v_caller.is_active IS NOT TRUE THEN
    RETURN FALSE;
  END IF;

  IF v_caller.role = 'admin' THEN
    RETURN TRUE;
  END IF;

  -- Boarding officers: fail closed unless assigned_transport_group_id is non-null
  IF v_caller.role = 'boarding_officer' THEN
    IF v_caller.assigned_transport_group_id IS NULL THEN
      RETURN FALSE;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.profiles target
      JOIN public.hostels h ON h.id = target.hostel_id
      WHERE target.id = p_target_profile_id
        AND h.transport_group_id = v_caller.assigned_transport_group_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.journeys j ON j.id = b.journey_id
      JOIN public.routes r ON r.id = j.route_id
      WHERE b.student_id = p_target_profile_id
        AND r.transport_group_id = v_caller.assigned_transport_group_id
    );
  END IF;

  -- Drivers: strictly students with active bookings on journeys assigned to caller
  IF v_caller.role = 'driver' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.journeys j ON j.id = b.journey_id
      LEFT JOIN public.drivers d ON d.id = j.driver_record_id
      WHERE b.student_id = p_target_profile_id
        AND (
          j.driver_id = auth.uid()
          OR d.profile_id = auth.uid()
        )
    );
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_route_duration_minutes(p_route_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    r.estimated_duration_minutes,
    NULLIF(
      (
        SELECT MAX(rs.estimated_minutes_from_start)
        FROM public.route_stops rs
        WHERE rs.route_id = r.id
      ),
      0
    )
  )
  FROM public.routes r
  WHERE r.id = p_route_id;
$$;

-- ============================================================================
-- 3. PROFILE PRIVILEGE PROTECTION TRIGGER (SUPER_ADMIN BOUNDARY)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT;
  v_caller RECORD;
  v_internal_onboarding TEXT;
BEGIN
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  v_internal_onboarding := NULLIF(current_setting('cosmoride.internal_student_onboarding', true), '');

  -- Trusted backend/migration/trigger execution contexts
  IF v_jwt_role IS NULL OR v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Resolve current caller role & admin_role cleanly
  SELECT role, admin_role, is_active
  INTO v_caller
  FROM public.profiles
  WHERE id = auth.uid();

  -- First-time profile self-registration via SECURITY DEFINER onboarding RPCs
  IF v_internal_onboarding = 'on' AND auth.uid() IS NOT NULL AND NEW.id = auth.uid() THEN
    -- Still disallow any role, admin_role, assigned_transport_group_id, or is_active tampering
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.admin_role IS DISTINCT FROM OLD.admin_role
       OR NEW.assigned_transport_group_id IS DISTINCT FROM OLD.assigned_transport_group_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Privilege escalation prohibited via self-onboarding.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Restrict direct profile privilege modifications strictly to active super_admin
  IF NOT FOUND OR v_caller.is_active IS NOT TRUE OR v_caller.role <> 'admin' OR v_caller.admin_role <> 'super_admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only a super administrator can alter user roles.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.admin_role IS DISTINCT FROM OLD.admin_role THEN
      RAISE EXCEPTION 'Only a super administrator can alter administrative sub-roles.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Only a super administrator can activate or deactivate accounts.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.assigned_transport_group_id IS DISTINCT FROM OLD.assigned_transport_group_id THEN
      RAISE EXCEPTION 'Only a super administrator can reassign hostel transport groups.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.hostel_id IS DISTINCT FROM OLD.hostel_id THEN
      RAISE EXCEPTION 'Hostel assignment cannot be modified directly. Use official onboarding or contact administration.'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.student_id IS NOT NULL AND trim(OLD.student_id) <> '' AND NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'Matriculation number cannot be modified once registered.'
        USING ERRCODE = '42501';
    END IF;

    -- Prevent non-super_admin users from registering or overwriting student_id outside onboarding RPC
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
      RAISE EXCEPTION 'Matriculation number must be registered via official student registration.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Safety check: Non-admin profiles must never retain an admin_role
  IF NEW.role <> 'admin' AND NEW.admin_role IS NOT NULL THEN
    NEW.admin_role := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profile_privilege_protection ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_protection
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileges();

-- ============================================================================
-- 4. FAIL-CLOSED RLS POLICIES (REMOVE LEGACY & RECURSIVE POLICIES)
-- ============================================================================

-- ---- A. PROFILES ----
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Boarding officers can view hostel students" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Scoped profile visibility policy" ON public.profiles;
DROP POLICY IF EXISTS "Scoped profile read access" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own non-privileged profile" ON public.profiles;
DROP POLICY IF EXISTS "Super admins can update any profile" ON public.profiles;

CREATE POLICY "Scoped profile read access"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR public.rls_is_admin()
    OR public.rls_staff_can_view_profile(id)
  );

CREATE POLICY "Users can update own non-privileged profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "Super admins can update any profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

-- ---- B. REFERENCE / INFRASTRUCTURE TABLES (SUPER_ADMIN WRITES ONLY) ----
DROP POLICY IF EXISTS "Admins can manage campuses" ON public.campuses;
CREATE POLICY "Super admins can manage campuses"
  ON public.campuses FOR ALL
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

DROP POLICY IF EXISTS "Admins can manage hostels" ON public.hostels;
CREATE POLICY "Super admins can manage hostels"
  ON public.hostels FOR ALL
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

DROP POLICY IF EXISTS "Admins can manage routes" ON public.routes;
CREATE POLICY "Super admins can manage routes"
  ON public.routes FOR ALL
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

DROP POLICY IF EXISTS "Admins can manage stops" ON public.stops;
CREATE POLICY "Super admins can manage stops"
  ON public.stops FOR ALL
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

DROP POLICY IF EXISTS "Admins can manage route stops" ON public.route_stops;
CREATE POLICY "Super admins can manage route stops"
  ON public.route_stops FOR ALL
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

DROP POLICY IF EXISTS "Admins can manage transport groups" ON public.transport_groups;
CREATE POLICY "Super admins can manage transport groups"
  ON public.transport_groups FOR ALL
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

DROP POLICY IF EXISTS "Admins can manage settings" ON public.system_settings;
CREATE POLICY "Super admins can manage settings"
  ON public.system_settings FOR ALL
  TO authenticated
  USING (public.rls_is_super_admin())
  WITH CHECK (public.rls_is_super_admin());

-- ---- C. FLEET, DRIVERS & SCHEDULES (BUS_MANAGER & SUPER_ADMIN) ----
DROP POLICY IF EXISTS "Admins can manage vehicles" ON public.vehicles;
CREATE POLICY "Fleet admins can manage vehicles"
  ON public.vehicles FOR ALL
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'bus_manager'))
  WITH CHECK (public.rls_admin_role() IN ('super_admin', 'bus_manager'));

DROP POLICY IF EXISTS "Anyone authenticated can view active drivers" ON public.drivers;
DROP POLICY IF EXISTS "Admins can manage drivers" ON public.drivers;
DROP POLICY IF EXISTS "Operational staff can view drivers" ON public.drivers;
DROP POLICY IF EXISTS "Fleet admins can manage drivers" ON public.drivers;

CREATE POLICY "Operational staff can view drivers"
  ON public.drivers FOR SELECT
  TO authenticated
  USING (
    public.rls_user_role() IN ('admin', 'boarding_officer', 'driver')
  );

CREATE POLICY "Fleet admins can manage drivers"
  ON public.drivers FOR ALL
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'bus_manager'))
  WITH CHECK (public.rls_admin_role() IN ('super_admin', 'bus_manager'));

DROP POLICY IF EXISTS "Admins can manage schedules" ON public.schedules;
CREATE POLICY "Fleet admins can manage schedules"
  ON public.schedules FOR ALL
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'bus_manager'))
  WITH CHECK (public.rls_admin_role() IN ('super_admin', 'bus_manager'));

-- ---- D. JOURNEYS (NO DIRECT DRIVER/HOSTEL BYPASSES, NO RECURSION) ----
DROP POLICY IF EXISTS "Drivers can update their own journeys" ON public.journeys;
DROP POLICY IF EXISTS "Scoped journey access policy" ON public.journeys;
DROP POLICY IF EXISTS "Admins can update journeys" ON public.journeys;
DROP POLICY IF EXISTS "Admins can delete journeys" ON public.journeys;

CREATE POLICY "Scoped journey access policy"
  ON public.journeys FOR SELECT
  TO authenticated
  USING (
    public.rls_is_admin()
    OR (public.rls_user_role() = 'student' AND status <> 'cancelled')
    OR (public.rls_user_role() = 'driver' AND public.rls_driver_assigned_to_journey(id))
    OR (
      public.rls_user_role() = 'boarding_officer'
      AND public.rls_assigned_transport_group() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.routes r
        WHERE r.id = journeys.route_id
          AND r.transport_group_id = public.rls_assigned_transport_group()
      )
    )
  );

CREATE POLICY "Admins can update journeys"
  ON public.journeys FOR UPDATE
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'bus_manager'))
  WITH CHECK (public.rls_admin_role() IN ('super_admin', 'bus_manager'));

CREATE POLICY "Admins can delete journeys"
  ON public.journeys FOR DELETE
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'bus_manager'));

-- ---- E. BOOKINGS (ALL MUTATIONS STRICTLY VIA AUDITED RPCs) ----
DROP POLICY IF EXISTS "Students can create own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Students can cancel own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Boarding officers can view assigned group bookings" ON public.bookings;
DROP POLICY IF EXISTS "Boarding officers can update assigned group bookings" ON public.bookings;
DROP POLICY IF EXISTS "Drivers can view their journey bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can manage bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Boarding officers can view scoped bookings" ON public.bookings;

CREATE POLICY "Admins can view all bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (public.rls_is_admin());

CREATE POLICY "Boarding officers can view scoped bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    public.rls_user_role() = 'boarding_officer'
    AND public.rls_assigned_transport_group() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.journeys j
      JOIN public.routes r ON r.id = j.route_id
      WHERE j.id = bookings.journey_id
        AND r.transport_group_id = public.rls_assigned_transport_group()
    )
  );

CREATE POLICY "Drivers can view their journey bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    public.rls_user_role() = 'driver'
    AND public.rls_driver_assigned_to_journey(journey_id)
  );

-- ---- F. WAITLISTS & BOARDING RECORDS ----
-- Waitlist join, promotion, and cancellation occur strictly via atomic RPCs (book_journey_seat / cancel_booking_and_promote / cancel_waitlist_entry).
DROP POLICY IF EXISTS "Staff can view corridor waitlists" ON public.waitlists;
DROP POLICY IF EXISTS "Staff can view group waitlists" ON public.waitlists;
DROP POLICY IF EXISTS "Students can cancel own waitlist entry" ON public.waitlists;

CREATE POLICY "Staff can view group waitlists"
  ON public.waitlists FOR SELECT
  TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR public.rls_is_admin()
    OR (
      public.rls_user_role() = 'boarding_officer'
      AND public.rls_assigned_transport_group() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.journeys j
        JOIN public.routes r ON r.id = j.route_id
        WHERE j.id = waitlists.journey_id
          AND r.transport_group_id = public.rls_assigned_transport_group()
      )
    )
    OR (
      public.rls_user_role() = 'driver'
      AND public.rls_driver_assigned_to_journey(journey_id)
    )
  );

DROP POLICY IF EXISTS "Scoped staff boarding records access" ON public.boarding_records;
CREATE POLICY "Scoped staff boarding records access"
  ON public.boarding_records FOR SELECT
  TO authenticated
  USING (
    student_id = (SELECT auth.uid())
    OR public.rls_is_admin()
    OR (
      public.rls_user_role() = 'boarding_officer'
      AND public.rls_assigned_transport_group() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.journeys j
        JOIN public.routes r ON r.id = j.route_id
        WHERE j.id = boarding_records.journey_id
          AND r.transport_group_id = public.rls_assigned_transport_group()
      )
    )
    OR (
      public.rls_user_role() = 'driver'
      AND public.rls_driver_assigned_to_journey(journey_id)
    )
  );

-- ---- G. ANNOUNCEMENTS, INCIDENTS & AUDIT LOGS ----
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;
CREATE POLICY "Authorised admins can manage announcements"
  ON public.announcements FOR ALL
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager'))
  WITH CHECK (public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager'));

DROP POLICY IF EXISTS "Staff can view incidents" ON public.incident_reports;
DROP POLICY IF EXISTS "Staff can create incident reports" ON public.incident_reports;
DROP POLICY IF EXISTS "Admins can manage incidents" ON public.incident_reports;

CREATE POLICY "Staff can view incidents"
  ON public.incident_reports FOR SELECT
  TO authenticated
  USING (public.rls_user_role() IN ('admin', 'boarding_officer', 'driver'));

CREATE POLICY "Staff can create incident reports"
  ON public.incident_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    reported_by = (SELECT auth.uid())
    AND public.rls_user_role() IN ('admin', 'boarding_officer', 'driver')
  );

CREATE POLICY "Authorised admins can manage incidents"
  ON public.incident_reports FOR UPDATE
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager'))
  WITH CHECK (public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager'));

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Only authenticated admins can insert audit logs for themselves" ON public.audit_logs;

CREATE POLICY "Governance admins can view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.rls_admin_role() IN ('super_admin', 'hostel_manager'));

CREATE POLICY "Authorised admins can insert audit logs"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.rls_admin_role() IN ('super_admin', 'bus_manager', 'hostel_manager')
  );

-- ---- H. OPERATIONAL TELEMETRY LOGS ----
DROP POLICY IF EXISTS "Staff can insert readiness checks" ON public.vehicle_readiness_checks;
CREATE POLICY "Staff can insert readiness checks"
  ON public.vehicle_readiness_checks FOR INSERT
  TO authenticated
  WITH CHECK (
    checked_by_user_id = (SELECT auth.uid())
    AND public.rls_user_role() IN ('driver', 'boarding_officer', 'admin')
  );

DROP POLICY IF EXISTS "Staff can insert stop updates" ON public.journey_stop_updates;
CREATE POLICY "Staff can insert stop updates"
  ON public.journey_stop_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    recorded_by_user_id = (SELECT auth.uid())
    AND public.rls_user_role() IN ('driver', 'boarding_officer', 'admin')
  );

DROP POLICY IF EXISTS "Staff can insert operational logs" ON public.journey_operational_logs;
CREATE POLICY "Staff can insert operational logs"
  ON public.journey_operational_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    recorded_by_user_id = (SELECT auth.uid())
    AND public.rls_user_role() IN ('driver', 'boarding_officer', 'admin')
  );

-- ============================================================================
-- 5. DURATION-AWARE VEHICLE & DRIVER AVAILABILITY + CONCURRENCY GUARDS
-- ============================================================================

DROP FUNCTION IF EXISTS public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID);
DROP FUNCTION IF EXISTS public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID, UUID);

CREATE OR REPLACE FUNCTION public.check_vehicle_assignment_conflict(
  p_vehicle_id UUID,
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
  v_jwt_role TEXT;
  v_caller RECORD;
  v_vehicle RECORD;
  v_new_duration_minutes INTEGER;
  v_active_trip RECORD;
  v_cand RECORD;
  v_existing_duration_minutes INTEGER;
  v_existing_start TIMESTAMPTZ;
  v_existing_end TIMESTAMPTZ;
  v_new_end TIMESTAMPTZ;
BEGIN
  -- 1. Context verification when invoked directly as an RPC
  IF pg_catalog.pg_trigger_depth() = 0 THEN
    v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
    IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
      RETURN jsonb_build_object(
        'has_conflict', true,
        'code', 'UNAUTHORIZED',
        'error', 'Permission denied: Invalid or untrusted execution context.'
      );
    END IF;

    IF v_jwt_role = 'authenticated' THEN
      IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'UNAUTHORIZED',
          'error', 'Permission denied: Unauthenticated session.'
        );
      END IF;

      SELECT role, admin_role, is_active INTO v_caller
      FROM public.profiles
      WHERE id = auth.uid();

      IF NOT FOUND OR v_caller.is_active IS NOT TRUE OR (
        v_caller.role <> 'admin' OR v_caller.admin_role NOT IN ('super_admin', 'bus_manager', 'hostel_manager')
      ) THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'FORBIDDEN',
          'error', 'Permission denied: Only authorised transport administrators may inspect vehicle scheduling conflicts.'
        );
      END IF;
    END IF;
  END IF;

  IF p_vehicle_id IS NULL THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_REQUIRED',
      'error', 'A valid vehicle must be specified.'
    );
  END IF;

  IF p_scheduled_departure IS NULL THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'INVALID_DEPARTURE',
      'error', 'Scheduled departure timestamp is required.'
    );
  END IF;

  -- 2. Lock candidate vehicle row to serialize concurrent assignments
  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_NOT_FOUND',
      'error', 'Selected vehicle record not found.'
    );
  END IF;

  IF v_vehicle.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_INACTIVE',
      'error', 'Selected vehicle (' || v_vehicle.registration_number || ') is currently inactive.'
    );
  END IF;

  IF v_vehicle.status <> 'available' THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_UNAVAILABLE',
      'error', 'Selected vehicle (' || v_vehicle.registration_number || ') is currently in "' || v_vehicle.status || '" status.'
    );
  END IF;

  IF v_vehicle.safe_capacity IS NULL OR v_vehicle.safe_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'CAPACITY_NOT_CONFIGURED',
      'error', 'Selected vehicle (' || v_vehicle.registration_number || ') has unconfigured safe capacity.'
    );
  END IF;

  IF p_route_id IS NOT NULL THEN
    v_new_duration_minutes := public.resolve_route_duration_minutes(p_route_id);
  END IF;

  -- 3. Reject if vehicle has ANY unfinished in-progress commitment
  SELECT j.id, j.status, j.scheduled_departure, r.name AS route_name
  INTO v_active_trip
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.vehicle_id = p_vehicle_id
    AND j.status IN ('bus_arrived', 'boarding', 'boarding_closed', 'ready_to_depart', 'in_transit')
    AND (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
  ORDER BY j.scheduled_departure ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'has_conflict', true,
      'code', 'VEHICLE_CURRENTLY_ACTIVE',
      'conflicting_journey_id', v_active_trip.id,
      'error', 'Vehicle ' || v_vehicle.registration_number || ' is currently active on "' || v_active_trip.route_name || '" (status: ' || v_active_trip.status || ') and cannot be assigned until that journey completes.'
    );
  END IF;

  -- 4. Duration-aware & cross-midnight interval check across scheduled/completed trips
  FOR v_cand IN
    SELECT
      j.id,
      j.route_id,
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
    WHERE j.vehicle_id = p_vehicle_id
      AND j.status IN ('scheduled', 'completed')
      AND (p_exclude_journey_id IS NULL OR j.id <> p_exclude_journey_id)
      AND (
        j.journey_date = p_journey_date
        OR j.scheduled_departure BETWEEN (p_scheduled_departure - INTERVAL '24 hours') AND (p_scheduled_departure + INTERVAL '24 hours')
      )
    ORDER BY j.scheduled_departure ASC
  LOOP
    v_existing_duration_minutes := v_cand.duration_minutes;
    v_existing_start := CASE
      WHEN v_cand.status = 'completed' AND v_cand.actual_departure IS NOT NULL THEN v_cand.actual_departure
      ELSE v_cand.scheduled_departure + (COALESCE(v_cand.delay_minutes, 0) * INTERVAL '1 minute')
    END;

    -- Exact or sub-minute identical start
    IF ABS(EXTRACT(EPOCH FROM (v_existing_start - p_scheduled_departure))) < 60 THEN
      RETURN jsonb_build_object(
        'has_conflict', true,
        'code', 'ASSIGNMENT_CONFLICT',
        'conflicting_journey_id', v_cand.id,
        'error', 'Vehicle ' || v_vehicle.registration_number || ' is already scheduled on "' || v_cand.route_name || '" at ' || to_char(v_existing_start AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI') || ' WAT.'
      );
    END IF;

    IF v_cand.status = 'completed' THEN
      -- Completed journey: check actual finish time against candidate window
      IF v_cand.actual_arrival IS NOT NULL THEN
        v_existing_end := v_cand.actual_arrival;
      ELSIF v_existing_duration_minutes IS NOT NULL THEN
        v_existing_end := v_existing_start + (v_existing_duration_minutes * INTERVAL '1 minute');
      ELSE
        -- Completed without arrival timestamp or duration: fail closed on same day if candidate isn't clearly after start + 24h
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ROUTE_DURATION_UNCONFIGURED',
          'conflicting_journey_id', v_cand.id,
          'error', 'Completed trip "' || v_cand.route_name || '" lacks arrival time and route duration; cannot verify historical overlap.'
        );
      END IF;

      IF p_scheduled_departure >= v_existing_end THEN
        CONTINUE;
      END IF;

      -- Candidate is earlier than completed trip's actual finish
      IF v_new_duration_minutes IS NULL THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ROUTE_DURATION_UNCONFIGURED',
          'conflicting_journey_id', v_cand.id,
          'error', 'Route duration must be configured before scheduling a trip prior to existing journey "' || v_cand.route_name || '".'
        );
      END IF;

      v_new_end := p_scheduled_departure + (v_new_duration_minutes * INTERVAL '1 minute');
      IF v_new_end > v_existing_start THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ASSIGNMENT_CONFLICT',
          'conflicting_journey_id', v_cand.id,
          'error', 'Vehicle ' || v_vehicle.registration_number || ' overlaps with "' || v_cand.route_name || '".'
        );
      END IF;

      CONTINUE;
    END IF;

    -- Scheduled commitment
    IF v_existing_start < p_scheduled_departure THEN
      IF v_existing_duration_minutes IS NULL THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ROUTE_DURATION_UNCONFIGURED',
          'conflicting_journey_id', v_cand.id,
          'error', 'Vehicle ' || v_vehicle.registration_number || ' is scheduled for "' || v_cand.route_name || '" at ' || to_char(v_existing_start AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD HH24:MI') || ' WAT, whose route duration is unconfigured. Configure duration or wait for trip completion before reusing this vehicle.'
        );
      END IF;

      v_existing_end := v_existing_start + (v_existing_duration_minutes * INTERVAL '1 minute');
      IF v_existing_end > p_scheduled_departure THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ASSIGNMENT_CONFLICT',
          'conflicting_journey_id', v_cand.id,
          'error', 'Vehicle ' || v_vehicle.registration_number || ' will still be committed to "' || v_cand.route_name || '" until ' || to_char(v_existing_end AT TIME ZONE 'Africa/Lagos', 'HH24:MI') || ' WAT.'
        );
      END IF;
    ELSE
      -- Existing trip starts after candidate departure
      IF v_new_duration_minutes IS NULL THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ROUTE_DURATION_UNCONFIGURED',
          'conflicting_journey_id', v_cand.id,
          'error', 'Selected route duration is unconfigured; cannot verify vehicle ' || v_vehicle.registration_number || ' clears before "' || v_cand.route_name || '" at ' || to_char(v_existing_start AT TIME ZONE 'Africa/Lagos', 'HH24:MI') || ' WAT.'
        );
      END IF;

      v_new_end := p_scheduled_departure + (v_new_duration_minutes * INTERVAL '1 minute');
      IF v_new_end > v_existing_start THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ASSIGNMENT_CONFLICT',
          'conflicting_journey_id', v_cand.id,
          'error', 'Candidate trip finishes at ' || to_char(v_new_end AT TIME ZONE 'Africa/Lagos', 'HH24:MI') || ' WAT, conflicting with "' || v_cand.route_name || '" at ' || to_char(v_existing_start AT TIME ZONE 'Africa/Lagos', 'HH24:MI') || ' WAT.'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'has_conflict', false,
    'code', 'AVAILABLE',
    'vehicle_registration', v_vehicle.registration_number,
    'safe_capacity', v_vehicle.safe_capacity
  );
END;
$$;

-- Driver overlap check helper (internal / RPC)
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

  -- Resolve & lock driver record when specified or linked by profile_id
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

  -- Block if driver is mid-journey right now
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
        'code', 'DRIVER_ASSIGNMENT_CONFLICT',
        'error', 'Driver already has an overlapping assignment on "' || v_cand.route_name || '".'
      );
    END IF;

    IF v_cand.status = 'completed' THEN
      v_existing_end := COALESCE(
        v_cand.actual_arrival,
        CASE WHEN v_cand.duration_minutes IS NOT NULL THEN v_existing_start + (v_cand.duration_minutes * INTERVAL '1 minute') ELSE NULL END
      );

      IF v_existing_end IS NULL THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ROUTE_DURATION_UNCONFIGURED',
          'error', 'Driver historical trip "' || v_cand.route_name || '" lacks duration/arrival confirmation.'
        );
      END IF;

      IF p_scheduled_departure >= v_existing_end THEN
        CONTINUE;
      END IF;
    END IF;

    IF v_existing_start < p_scheduled_departure THEN
      IF v_cand.duration_minutes IS NULL THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ROUTE_DURATION_UNCONFIGURED',
          'error', 'Driver is scheduled on "' || v_cand.route_name || '" with unconfigured route duration.'
        );
      END IF;

      v_existing_end := v_existing_start + (v_cand.duration_minutes * INTERVAL '1 minute');
      IF v_existing_end > p_scheduled_departure THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'DRIVER_ASSIGNMENT_CONFLICT',
          'error', 'Driver commitment to "' || v_cand.route_name || '" overlaps candidate departure.'
        );
      END IF;
    ELSE
      IF v_new_duration_minutes IS NULL THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'ROUTE_DURATION_UNCONFIGURED',
          'error', 'Candidate route duration must be configured before overlapping driver commitments.'
        );
      END IF;

      v_new_end := p_scheduled_departure + (v_new_duration_minutes * INTERVAL '1 minute');
      IF v_new_end > v_existing_start THEN
        RETURN jsonb_build_object(
          'has_conflict', true,
          'code', 'DRIVER_ASSIGNMENT_CONFLICT',
          'error', 'Candidate trip conflicts with driver upcoming assignment on "' || v_cand.route_name || '".'
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'has_conflict', false,
    'code', 'AVAILABLE',
    'resolved_driver_record_id', v_resolved_driver_record_id,
    'resolved_driver_id', v_resolved_profile_id
  );
END;
$$;

-- Hardened trigger covering vehicle, route, schedule, delay, driver & un-cancellation
CREATE OR REPLACE FUNCTION public.enforce_journey_vehicle_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_veh_check JSONB;
  v_drv_check JSONB;
  v_effective_departure TIMESTAMPTZ;
  v_effective_date DATE;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Skip overlap re-checks on pure lifecycle transitions (e.g. boarding -> completed)
    IF OLD.status <> 'cancelled'
       AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
       AND NEW.route_id IS NOT DISTINCT FROM OLD.route_id
       AND NEW.scheduled_departure IS NOT DISTINCT FROM OLD.scheduled_departure
       AND NEW.delay_minutes IS NOT DISTINCT FROM OLD.delay_minutes
       AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id
       AND NEW.driver_record_id IS NOT DISTINCT FROM OLD.driver_record_id THEN
      RETURN NEW;
    END IF;
  END IF;

  v_effective_departure := NEW.scheduled_departure + (COALESCE(NEW.delay_minutes, 0) * INTERVAL '1 minute');
  v_effective_date := COALESCE((v_effective_departure AT TIME ZONE 'Africa/Lagos')::DATE, NEW.journey_date);

  v_veh_check := public.check_vehicle_assignment_conflict(
    NEW.vehicle_id,
    v_effective_date,
    v_effective_departure,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END,
    NEW.route_id
  );

  IF COALESCE((v_veh_check ->> 'has_conflict')::BOOLEAN, TRUE) THEN
    RAISE EXCEPTION '%', COALESCE(v_veh_check ->> 'error', 'Vehicle availability conflict.')
      USING ERRCODE = '23514';
  END IF;

  IF NEW.driver_record_id IS NOT NULL OR NEW.driver_id IS NOT NULL THEN
    v_drv_check := public.check_driver_assignment_conflict(
      NEW.driver_record_id,
      NEW.driver_id,
      v_effective_date,
      v_effective_departure,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END,
      NEW.route_id
    );

    IF COALESCE((v_drv_check ->> 'has_conflict')::BOOLEAN, TRUE) THEN
      RAISE EXCEPTION '%', COALESCE(v_drv_check ->> 'error', 'Driver availability conflict.')
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journey_vehicle_availability ON public.journeys;
CREATE TRIGGER trg_enforce_journey_vehicle_availability
  BEFORE INSERT OR UPDATE OF vehicle_id, route_id, scheduled_departure, delay_minutes, status, driver_id, driver_record_id ON public.journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_journey_vehicle_availability();

-- Journey lifecycle, safety gate & workflow integrity trigger
-- Blocks direct PostgREST/client mutation of lifecycle, readiness, or delay fields
-- while permitting admins to edit non-lifecycle scheduling fields on non-terminal trips.
CREATE OR REPLACE FUNCTION public.protect_journey_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT;
  v_internal_workflow TEXT;
BEGIN
  -- Enforce hard safety gate regardless of execution context
  IF (NEW.status = 'in_transit' OR (NEW.actual_departure IS NOT NULL AND OLD.actual_departure IS NULL))
     AND NEW.readiness_status = 'failed_unsafe' THEN
    RAISE EXCEPTION 'Safety violation: Pre-departure vehicle check was flagged unsafe. Dispatch blocked.'
      USING ERRCODE = '42501';
  END IF;

  -- Enforce strict 7-stage lifecycle ordering whenever status changes
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'scheduled' AND NEW.status IN ('bus_arrived', 'cancelled'))
      OR (OLD.status = 'bus_arrived' AND NEW.status IN ('boarding', 'cancelled'))
      OR (OLD.status = 'boarding' AND NEW.status IN ('boarding_closed', 'cancelled'))
      OR (OLD.status = 'boarding_closed' AND NEW.status IN ('ready_to_depart', 'cancelled'))
      OR (OLD.status = 'ready_to_depart' AND NEW.status IN ('in_transit', 'cancelled'))
      OR (OLD.status = 'in_transit' AND NEW.status = 'completed')
    ) THEN
      RAISE EXCEPTION 'Invalid journey status transition from "%" to "%". Use controlled operational workflow RPCs.', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  v_internal_workflow := NULLIF(current_setting('cosmoride.internal_journey_workflow', true), '');

  -- Trusted workflow RPCs, migrations, and service_role maintenance contexts
  IF v_internal_workflow = 'on' OR v_jwt_role IS NULL OR v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Direct authenticated updates (e.g., Admins) must not mutate terminal/live journeys or lifecycle/safety/delay columns
  IF OLD.status IN ('in_transit', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Direct modification of active, completed, or cancelled journeys is prohibited.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.bus_arrived_at IS DISTINCT FROM OLD.bus_arrived_at
     OR NEW.bus_arrived_by IS DISTINCT FROM OLD.bus_arrived_by
     OR NEW.boarding_opened_at IS DISTINCT FROM OLD.boarding_opened_at
     OR NEW.boarding_opened_by IS DISTINCT FROM OLD.boarding_opened_by
     OR NEW.boarding_closed_at IS DISTINCT FROM OLD.boarding_closed_at
     OR NEW.boarding_closed_by IS DISTINCT FROM OLD.boarding_closed_by
     OR NEW.departure_authorised_at IS DISTINCT FROM OLD.departure_authorised_at
     OR NEW.departure_authorised_by IS DISTINCT FROM OLD.departure_authorised_by
     OR NEW.departure_confirmed_by IS DISTINCT FROM OLD.departure_confirmed_by
     OR NEW.actual_departure IS DISTINCT FROM OLD.actual_departure
     OR NEW.actual_arrival IS DISTINCT FROM OLD.actual_arrival
     OR NEW.readiness_status IS DISTINCT FROM OLD.readiness_status
     OR NEW.readiness_checked_at IS DISTINCT FROM OLD.readiness_checked_at
     OR NEW.readiness_checked_by IS DISTINCT FROM OLD.readiness_checked_by
     OR NEW.is_assisted_operation IS DISTINCT FROM OLD.is_assisted_operation
     OR NEW.delay_minutes IS DISTINCT FROM OLD.delay_minutes
     OR NEW.delay_reason IS DISTINCT FROM OLD.delay_reason THEN
    RAISE EXCEPTION 'Journey lifecycle, readiness, and delay fields can only be modified through authorised operational workflow RPCs.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_journey_lifecycle_protection ON public.journeys;
CREATE TRIGGER enforce_journey_lifecycle_protection
  BEFORE UPDATE ON public.journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_journey_lifecycle();

-- Hardened atomic manual journey creation (bus_manager & super_admin)
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
    v_effective_admin_id := p_admin_id;
  END IF;

  IF v_effective_admin_id IS NOT NULL THEN
    SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
    IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager') THEN
      RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only Super Administrators or the Bus Manager may create or dispatch journeys.');
    END IF;
  END IF;

  IF p_scheduled_departure IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DEPARTURE', 'error', 'Scheduled departure timestamp is required.');
  END IF;

  v_effective_date := COALESCE(p_journey_date, (p_scheduled_departure AT TIME ZONE 'Africa/Lagos')::DATE);

  SELECT * INTO v_route
  FROM public.routes
  WHERE id = p_route_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'ROUTE_NOT_FOUND', 'error', 'Active route not found.');
  END IF;

  -- Check vehicle lock + duration-aware conflict
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

  -- Check driver lock + conflict when driver is provided
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
    COALESCE(p_proposed_allocation, 32),
    COALESCE((v_conflict ->> 'safe_capacity')::INTEGER, 32),
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

-- Hardened recurring schedule generation (honest vehicle + driver conflict checks)
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
  v_effective_admin_id UUID := NULL;
  v_jwt_role TEXT;
  v_admin RECORD;
  v_dow INTEGER;
  v_sched RECORD;
  v_cand_vehicle RECORD;
  v_selected_vehicle RECORD;
  v_selected_driver RECORD;
  v_cand_driver RECORD;
  v_conflict JSONB;
  v_driver_conflict JSONB;
  v_created_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_skipped_reasons JSONB := '[]'::JSONB;
  v_effective_alloc INTEGER;
  v_actor_type TEXT;
  v_exec_context TEXT;
  v_audit_action TEXT;
  v_sched_departure_ts TIMESTAMPTZ;
  v_latest_departure_ts TIMESTAMPTZ;
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Administrator cannot impersonate another administrative actor.');
    END IF;
    v_effective_admin_id := auth.uid();
    v_actor_type := 'human_administrator';
    v_exec_context := 'interactive_admin_session';
    v_audit_action := 'ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE';

    SELECT * INTO v_admin FROM public.profiles WHERE id = v_effective_admin_id;
    IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager') THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED_ADMIN_ACTOR', 'error', 'Permission denied: Only Super Administrators or the Bus Manager may generate scheduled journeys.');
    END IF;
  ELSE
    v_effective_admin_id := NULL;
    v_actor_type := 'scheduled_system_job';
    v_exec_context := 'service_role_system_cron';
    v_audit_action := 'SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE';
  END IF;

  IF p_target_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DATE', 'error', 'Target schedule date is required.');
  END IF;

  v_dow := EXTRACT(DOW FROM p_target_date);

  FOR v_sched IN
    SELECT s.*, r.name AS route_name, r.is_active AS route_active
    FROM public.schedules s
    JOIN public.routes r ON r.id = s.route_id
    WHERE s.day_of_week = v_dow
      AND s.is_active = TRUE
      AND r.is_active = TRUE
      AND (p_route_id IS NULL OR s.route_id = p_route_id)
    ORDER BY s.departure_time ASC, s.created_at ASC
  LOOP
    -- Skip only if a non-cancelled journey already exists for this schedule/date
    IF EXISTS (
      SELECT 1 FROM public.journeys j
      WHERE j.schedule_id = v_sched.id
        AND j.journey_date = p_target_date
        AND j.status <> 'cancelled'
    ) THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || jsonb_build_array(
        jsonb_build_object('schedule_id', v_sched.id, 'route', v_sched.route_name, 'reason', 'ALREADY_EXISTS')
      );
      CONTINUE;
    END IF;

    v_sched_departure_ts := timezone('Africa/Lagos', (p_target_date || ' ' || v_sched.departure_time)::timestamp);
    v_latest_departure_ts := CASE
      WHEN v_sched.latest_departure_time IS NOT NULL THEN
        timezone('Africa/Lagos', (p_target_date || ' ' || v_sched.latest_departure_time)::timestamp)
      ELSE
        v_sched_departure_ts
    END;

    v_selected_vehicle := NULL;
    v_selected_driver := NULL;

    -- Find first available, safe, conflict-free vehicle locked FOR UPDATE SKIP LOCKED
    FOR v_cand_vehicle IN
      SELECT *
      FROM public.vehicles v
      WHERE v.is_active = TRUE
        AND v.status = 'available'
        AND v.safe_capacity IS NOT NULL
        AND v.safe_capacity > 0
      ORDER BY v.created_at ASC
      FOR UPDATE SKIP LOCKED
    LOOP
      v_conflict := public.check_vehicle_assignment_conflict(
        v_cand_vehicle.id,
        p_target_date,
        v_sched_departure_ts,
        NULL,
        v_sched.route_id
      );

      IF COALESCE((v_conflict ->> 'has_conflict')::BOOLEAN, TRUE) = FALSE THEN
        v_selected_vehicle := v_cand_vehicle;
        EXIT;
      END IF;
    END LOOP;

    IF v_selected_vehicle.id IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || jsonb_build_array(
        jsonb_build_object('schedule_id', v_sched.id, 'route', v_sched.route_name, 'reason', 'NO_CONFLICT_FREE_VEHICLE')
      );
      CONTINUE;
    END IF;

    -- Resolve an active conflict-free driver (prefer driver assigned to the selected vehicle first)
    FOR v_cand_driver IN
      SELECT d.*
      FROM public.drivers d
      WHERE d.status = 'active'
      ORDER BY
        CASE WHEN d.assigned_vehicle_id = v_selected_vehicle.id THEN 0 ELSE 1 END,
        d.created_at ASC
      FOR UPDATE SKIP LOCKED
    LOOP
      v_driver_conflict := public.check_driver_assignment_conflict(
        v_cand_driver.id,
        v_cand_driver.profile_id,
        p_target_date,
        v_sched_departure_ts,
        NULL,
        v_sched.route_id
      );

      IF COALESCE((v_driver_conflict ->> 'has_conflict')::BOOLEAN, TRUE) = FALSE THEN
        v_selected_driver := v_cand_driver;
        EXIT;
      END IF;
    END LOOP;

    IF v_selected_driver.id IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped_reasons := v_skipped_reasons || jsonb_build_array(
        jsonb_build_object('schedule_id', v_sched.id, 'route', v_sched.route_name, 'reason', 'NO_CONFLICT_FREE_DRIVER')
      );
      CONTINUE;
    END IF;

    v_effective_alloc := LEAST(v_selected_vehicle.safe_capacity, COALESCE(v_sched.proposed_allocation, 32), 32);

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
      v_sched.id,
      v_sched.route_id,
      v_selected_vehicle.id,
      v_selected_driver.profile_id,
      v_selected_driver.id,
      p_target_date,
      v_sched_departure_ts,
      v_latest_departure_ts,
      v_effective_alloc,
      'scheduled',
      v_effective_admin_id
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    v_audit_action,
    'journey_batch',
    NULL,
    jsonb_build_object(
      'target_date', p_target_date,
      'created_count', v_created_count,
      'skipped_count', v_skipped_count,
      'skipped_reasons', v_skipped_reasons,
      'actor_type', v_actor_type,
      'execution_context', v_exec_context,
      'route_id', p_route_id,
      'timestamp', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Generated ' || v_created_count || ' journeys (' || v_skipped_count || ' skipped).',
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'skipped_reasons', v_skipped_reasons,
    'actor_type', v_actor_type,
    'action', v_audit_action
  );
END;
$$;

-- Fixed admin_cancel_journey: valid notification_type ('journey_update'),
-- valid columns (no metadata column), waitlist cancellation + notification,
-- locked rows, and strict admin_role scope.
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
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager', 'hostel_manager') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Caller lacks administrative cancellation authority.');
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

  -- Cancel and notify active bookings
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

  -- Cancel and notify waiting list entries
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

-- ============================================================================
-- 6. STUDENT REGISTRATION, HOSTEL ELIGIBILITY, BOOKING & CAPACITY REBALANCE
-- ============================================================================

DROP FUNCTION IF EXISTS public.complete_student_profile(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.complete_student_profile(TEXT, TEXT, UUID);

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

  -- Validate optional hostel selection against active university hostels
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

  -- Immutability check for already-registered matriculation number
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

  -- Lock any duplicate student_id match
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

-- One-time hostel selection RPC for students whose hostel_id is still NULL
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

-- Hardened book_journey_seat:
-- - Fixes TOO_MANY_ROWS when historical cancelled rows exist
-- - Fails closed on gender-restricted routes when student gender is NULL
-- - Reuses existing waitlists row when re-joining after cancel/expired
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

  -- Fail-closed gender restriction: male/female hostel routes require matching non-null hostel gender
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

  -- Fail-closed transport group boundary check
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

  -- Prevent duplicate active booking (or re-booking after no_show)
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE journey_id = p_journey_id
      AND student_id = v_caller_id
      AND status IN ('confirmed', 'checked_in')
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'DUPLICATE_BOOKING', 'error', 'You already have a confirmed booking on this departure.');
  END IF;

  IF v_journey.safe_capacity IS NULL AND v_journey.proposed_allocation IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNVERIFIED_VEHICLE_CAPACITY',
      'error', 'Operation suspended: Vehicle physical safe capacity has not been certified by transport administration.'
    );
  END IF;

  v_effective_capacity := LEAST(
    COALESCE(v_journey.safe_capacity, v_journey.proposed_allocation, 32),
    COALESCE(v_journey.proposed_allocation, v_journey.safe_capacity, 32),
    32
  );

  v_max_seated := LEAST(COALESCE(v_journey.seated_capacity, 20), v_effective_capacity);
  v_max_standing := LEAST(COALESCE(v_journey.standing_capacity, 12), GREATEST(0, v_effective_capacity - v_max_seated));

  SELECT
    COUNT(*) FILTER (WHERE passenger_category = 'seated'),
    COUNT(*) FILTER (WHERE passenger_category = 'standing'),
    COUNT(*)
  INTO v_seated_count, v_standing_count, v_active_bookings_count
  FROM public.bookings
  WHERE journey_id = p_journey_id
    AND status IN ('confirmed', 'checked_in');

  IF v_active_bookings_count < v_effective_capacity THEN
    IF v_seated_count < v_max_seated THEN
      v_assigned_category := 'seated';
    ELSE
      v_assigned_category := 'standing';
    END IF;

    v_ticket_token := encode(extensions.gen_random_bytes(24), 'hex');

    -- Safely pick latest reusable cancelled booking row (prevents TOO_MANY_ROWS)
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
        'effective_capacity', v_effective_capacity
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
      'message', CASE
        WHEN v_assigned_category = 'seated' THEN 'Seated passenger place reserved successfully.'
        ELSE 'Standing passenger place reserved successfully (20 seats full).'
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

    -- Reuse existing waitlists row for (journey_id, student_id) if previously cancelled/promoted/expired
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
      'Added to Waiting List',
      'This departure has reached full passenger capacity (' || v_effective_capacity || ' max). You have been placed at position #' || v_waitlist_pos || ' on the waiting list.',
      'announcement'::public.notification_type,
      p_journey_id
    );

    RETURN jsonb_build_object(
      'success', true,
      'status', 'waitlist',
      'waitlist_position', v_waitlist_pos,
      'message', 'Bus at full passenger capacity (' || v_effective_capacity || ' max). You have been added to the waiting list at position #' || v_waitlist_pos || '.'
    );
  END IF;
END;
$$;

-- Hardened cancel_booking_and_promote:
-- - Fixes TOO_MANY_ROWS for re-activated cancelled bookings
-- - Synchronizes `boarding_records.passenger_category` when upgrading checked-in standing passengers
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

  -- Policy note: evaluated against scheduled_departure (consistent with booking_cutoff_minutes
  -- in book_journey_seat and system_settings wording "before scheduled departure").
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

      -- Synchronize boarding_records when the upgraded passenger had already checked in
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
  WHERE w.journey_id = v_booking.journey_id
    AND w.status = 'waiting'
  ORDER BY w.position ASC, w.created_at ASC
  LIMIT 1
  FOR UPDATE;

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
-- 7. BOARDING, NO-SHOW, AND STRICT 7-STAGE JOURNEY LIFECYCLE RPCS
-- ============================================================================

-- verify_and_board_passenger: LEAST capacity ceiling enforcement
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

  v_effective_capacity := LEAST(
    COALESCE(v_journey.safe_capacity, v_journey.proposed_allocation, 32),
    COALESCE(v_journey.proposed_allocation, v_journey.safe_capacity, 32),
    32
  );

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot board passengers for a route outside your assigned hostel operation.');
    END IF;
  END IF;

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

  SELECT p.full_name, p.student_id INTO v_student FROM public.profiles p WHERE p.id = v_booking.student_id;

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

  IF v_boarded_count >= v_effective_capacity THEN
    RETURN jsonb_build_object('success', false, 'code', 'BUS_FULL', 'error', 'Boarding Gate Blocked: Bus safe physical capacity of ' || v_effective_capacity || ' passengers reached.', 'passenger_name', v_student.full_name, 'student_id', v_student.student_id);
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
    'seated_limit', COALESCE(v_journey.seated_capacity, 20),
    'standing_limit', COALESCE(v_journey.standing_capacity, 12),
    'total_capacity', v_effective_capacity,
    'capacity', v_effective_capacity,
    'bus_registration', COALESCE(v_journey.vehicle_registration, v_journey.route_code)
  );
END;
$$;

-- Audited manual No-Show RPC (replaces client/server direct bookings table update)
CREATE OR REPLACE FUNCTION public.mark_passenger_no_show(
  p_booking_id UUID,
  p_officer_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_jwt_role TEXT;
  v_effective_officer_id UUID;
  v_officer RECORD;
  v_booking RECORD;
  v_journey RECORD;
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
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit officer actor attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  SELECT * INTO v_officer FROM public.profiles WHERE id = v_effective_officer_id;
  IF NOT FOUND OR v_officer.is_active IS NOT TRUE OR NOT (
    v_officer.role = 'boarding_officer'
    OR (v_officer.role = 'admin' AND v_officer.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Only authorised hostel representatives or administrators may record No-Show status.');
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'BOOKING_NOT_FOUND', 'error', 'Booking record not found.');
  END IF;

  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = v_booking.journey_id
  FOR UPDATE OF j;

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot update bookings outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_booking.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_BOOKING_STATUS', 'error', 'Only unboarded confirmed bookings can be marked as No-Show.');
  END IF;

  IF v_journey.status NOT IN ('boarding', 'boarding_closed', 'ready_to_depart') THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_JOURNEY_STATUS', 'error', 'No-Show may only be recorded during or after boarding closure (current status: ' || v_journey.status || ').');
  END IF;

  UPDATE public.bookings
  SET status = 'no_show'
  WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'PASSENGER_MARKED_NO_SHOW',
    'booking',
    p_booking_id,
    jsonb_build_object('journey_id', v_booking.journey_id, 'student_id', v_booking.student_id, 'notes', p_notes)
  );

  RETURN jsonb_build_object('success', true, 'journey_id', v_booking.journey_id, 'message', 'Passenger marked as No-Show.');
END;
$$;

-- Stage 2: confirm_bus_arrival (scheduled -> bus_arrived), supports driver_record_id
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
  v_now TIMESTAMPTZ := now();
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record arrival under another identity.');
    END IF;
    v_effective_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role requires explicit actor attribution.');
    END IF;
    v_effective_user_id := p_user_id;
  END IF;

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_effective_user_id;
  IF NOT FOUND OR v_caller.is_active IS NOT TRUE OR NOT (
    v_caller.role IN ('boarding_officer', 'driver')
    OR (v_caller.role = 'admin' AND v_caller.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only authorised staff or drivers may record bus arrival.');
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

  IF v_caller.role = 'boarding_officer' THEN
    IF v_caller.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_caller.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot manage a route outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_caller.role = 'driver' AND v_journey.driver_id IS DISTINCT FROM v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'Permission denied: You are not assigned to this journey.');
  END IF;

  IF v_journey.status = 'bus_arrived' THEN
    RETURN jsonb_build_object('success', true, 'code', 'ALREADY_ARRIVED', 'status', 'bus_arrived', 'bus_arrived_at', v_journey.bus_arrived_at, 'message', 'Bus arrival is already recorded.');
  END IF;

  IF v_journey.status <> 'scheduled' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', 'Cannot record bus arrival: Journey is currently in ' || v_journey.status || ' status.');
  END IF;

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'bus_arrived',
      bus_arrived_at = v_now,
      bus_arrived_by = v_effective_user_id,
      boarding_notes = COALESCE(p_notes, boarding_notes),
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_user_id,
    'BUS_ARRIVAL_CONFIRMED',
    'journey',
    p_journey_id,
    jsonb_build_object('journey_id', p_journey_id, 'route_code', v_journey.route_code, 'bus_arrived_at', v_now, 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BUS_ARRIVED',
    'status', 'bus_arrived',
    'bus_arrived_at', v_now,
    'message', 'Bus arrival confirmed. Boarding remains closed until explicitly opened by the representative.'
  );
END;
$$;

-- Stage 3: open_journey_boarding (strictly bus_arrived -> boarding)
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
  v_window_mins INTEGER := 10;
  v_now TIMESTAMPTZ := now();
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
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot open boarding under another identity.');
    END IF;
    v_effective_officer_id := auth.uid();
  ELSE
    IF p_officer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit officer attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  SELECT * INTO v_officer FROM public.profiles WHERE id = v_effective_officer_id;
  IF NOT FOUND OR v_officer.is_active IS NOT TRUE OR NOT (
    v_officer.role = 'boarding_officer'
    OR (v_officer.role = 'admin' AND v_officer.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only authorised hostel representatives and administrators may open boarding.');
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

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot open boarding outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_journey.status = 'boarding' THEN
    RETURN jsonb_build_object(
      'success', true,
      'code', 'ALREADY_BOARDING',
      'status', 'boarding',
      'boarding_opened_at', v_journey.boarding_opened_at,
      'boarding_window_minutes', v_journey.boarding_window_minutes,
      'message', 'Boarding is already open.'
    );
  END IF;

  IF v_journey.status <> 'bus_arrived' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_TRANSITION',
      'error', 'Cannot open boarding: Bus arrival must be confirmed first (current status: ' || v_journey.status || ').'
    );
  END IF;

  IF p_window_minutes IS NOT NULL AND p_window_minutes BETWEEN 1 AND 60 THEN
    v_window_mins := p_window_minutes;
  ELSE
    BEGIN
      SELECT COALESCE((value #>> '{}')::INTEGER, 10)
      INTO v_window_mins
      FROM public.system_settings
      WHERE key = 'boarding_window_minutes';
    EXCEPTION WHEN OTHERS THEN
      v_window_mins := 10;
    END;
    v_window_mins := COALESCE(v_window_mins, 10);
  END IF;

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'boarding',
      boarding_opened_at = v_now,
      boarding_opened_by = v_effective_officer_id,
      boarding_window_minutes = v_window_mins,
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'BOARDING_OPENED',
    'journey',
    p_journey_id,
    jsonb_build_object('journey_id', p_journey_id, 'route_code', v_journey.route_code, 'boarding_opened_at', v_now, 'window_minutes', v_window_mins)
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'BOARDING_OPEN',
    'status', 'boarding',
    'boarding_opened_at', v_now,
    'boarding_window_minutes', v_window_mins,
    'message', 'Boarding gate is now open (' || v_window_mins || ' min window).'
  );
END;
$$;

-- Stage 5: close_journey_boarding (boarding -> boarding_closed)
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
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit officer attribution.');
    END IF;
    v_effective_officer_id := p_officer_id;
  END IF;

  SELECT * INTO v_officer FROM public.profiles WHERE id = v_effective_officer_id;
  IF NOT FOUND OR v_officer.is_active IS NOT TRUE OR NOT (
    v_officer.role = 'boarding_officer'
    OR (v_officer.role = 'admin' AND v_officer.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied.');
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

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot close boarding outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_journey.status = 'boarding_closed' THEN
    RETURN jsonb_build_object('success', true, 'code', 'ALREADY_CLOSED', 'status', 'boarding_closed', 'boarding_closed_at', v_journey.boarding_closed_at, 'message', 'Boarding is already closed.');
  END IF;

  IF v_journey.status <> 'boarding' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', 'Cannot close boarding: Journey is currently in ' || v_journey.status || ' status.');
  END IF;

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

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'boarding_closed',
      boarding_closed_at = v_now,
      boarding_closed_by = v_effective_officer_id,
      boarding_notes = COALESCE(p_notes, boarding_notes),
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

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

-- Stage 6: authorise_journey_departure (strictly boarding_closed -> ready_to_depart)
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

  SELECT * INTO v_officer FROM public.profiles WHERE id = v_effective_officer_id;
  IF NOT FOUND OR v_officer.is_active IS NOT TRUE OR NOT (
    v_officer.role = 'boarding_officer'
    OR (v_officer.role = 'admin' AND v_officer.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only authorised hostel representatives or administrators can authorise departure.');
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

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot authorise departure outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_journey.status = 'ready_to_depart' THEN
    RETURN jsonb_build_object('success', true, 'code', 'ALREADY_AUTHORISED', 'status', 'ready_to_depart', 'departure_authorised_at', v_journey.departure_authorised_at, 'message', 'Departure has already been authorised.');
  END IF;

  IF v_journey.status <> 'boarding_closed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', 'Cannot authorise departure: Boarding must be closed first (current status: ' || v_journey.status || ').');
  END IF;

  SELECT COUNT(*) INTO v_boarded_count FROM public.boarding_records WHERE journey_id = p_journey_id;
  SELECT COUNT(*) INTO v_unboarded_count FROM public.bookings WHERE journey_id = p_journey_id AND status = 'confirmed';

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'ready_to_depart',
      departure_authorised_at = v_now,
      departure_authorised_by = v_effective_officer_id,
      boarding_notes = COALESCE(p_notes, boarding_notes),
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_officer_id,
    'DEPARTURE_AUTHORISED',
    'journey',
    p_journey_id,
    jsonb_build_object('journey_id', p_journey_id, 'route_code', v_journey.route_code, 'departure_authorised_at', v_now, 'boarded_count', v_boarded_count, 'unboarded_count', v_unboarded_count, 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'READY_TO_DEPART',
    'status', 'ready_to_depart',
    'departure_authorised_at', v_now,
    'boarded_count', v_boarded_count,
    'unboarded_count', v_unboarded_count,
    'message', 'Departure authorised. Bus is ready for final dispatch confirmation.'
  );
END;
$$;

-- Stage 7: confirm_journey_dispatch (strictly ready_to_depart -> in_transit, checks unsafe & driver_record_id, uses journey_update + related_journey_id)
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

  SELECT * INTO v_caller FROM public.profiles WHERE id = v_effective_user_id;
  IF NOT FOUND OR v_caller.is_active IS NOT TRUE OR NOT (
    v_caller.role IN ('boarding_officer', 'driver')
    OR (v_caller.role = 'admin' AND v_caller.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only authorised staff or drivers may record journey departure.');
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

  IF v_caller.role = 'boarding_officer' THEN
    IF v_caller.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_caller.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot dispatch a route outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_caller.role = 'driver' AND v_journey.driver_id IS DISTINCT FROM v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'Permission denied: You are not assigned to drive this journey.');
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

-- Hardened close_and_depart_journey (delegates strict ready_to_depart + safety check, no stage skipping)
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

  SELECT * INTO v_officer FROM public.profiles WHERE id = v_effective_officer_id;
  IF NOT FOUND OR v_officer.is_active IS NOT TRUE OR NOT (
    v_officer.role = 'boarding_officer'
    OR (v_officer.role = 'admin' AND v_officer.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Caller is not authorised.');
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

  IF v_officer.role = 'boarding_officer' THEN
    IF v_officer.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_officer.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot depart a journey outside your assigned hostel operation.');
    END IF;
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

-- Hardened driver / assisted operational RPCs (strictly clean terminology & ready_to_depart enforcement)
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
  v_effective_user_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_user RECORD;
  v_readiness_status TEXT;
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

  SELECT * INTO v_user FROM public.profiles WHERE id = v_effective_user_id;
  IF NOT FOUND OR v_user.is_active IS NOT TRUE OR NOT (
    v_user.role IN ('driver', 'boarding_officer')
    OR (v_user.role = 'admin' AND v_user.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Caller cannot record readiness checks.');
  END IF;

  SELECT j.*, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Target journey not found.');
  END IF;

  IF v_journey.status IN ('in_transit', 'completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'error', 'Cannot record pre-departure readiness check for a journey in "' || v_journey.status || '" status.');
  END IF;

  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: You cannot record readiness checks outside your assigned hostel operation.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id IS DISTINCT FROM v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'Permission denied: You are not the driver assigned to this journey.');
  END IF;

  IF NOT p_vehicle_safe OR NOT p_vehicle_available THEN
    v_readiness_status := 'failed_unsafe';
  ELSE
    v_readiness_status := 'passed';
  END IF;

  INSERT INTO public.vehicle_readiness_checks (
    journey_id, vehicle_id, checked_by_user_id, is_assisted, assisted_by_role,
    vehicle_available, vehicle_safe, mechanical_fault_reported, fault_description,
    journey_reviewed, battery_level_percent, tires_and_lights_checked, status, notes, created_at
  )
  VALUES (
    p_journey_id, v_journey.vehicle_id, v_effective_user_id, p_is_assisted,
    CASE WHEN p_is_assisted THEN v_user.role::text ELSE NULL END,
    p_vehicle_available, p_vehicle_safe, p_mechanical_fault, p_fault_description,
    p_journey_reviewed, p_battery_level, p_tires_and_lights, v_readiness_status, p_notes, now()
  );

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET readiness_status = v_readiness_status,
      readiness_checked_at = now(),
      readiness_checked_by = v_effective_user_id,
      is_assisted_operation = (is_assisted_operation OR p_is_assisted),
      updated_at = now()
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.journey_operational_logs (
    journey_id, driver_id, recorded_by_user_id, action_type, operation_mode, details
  )
  VALUES (
    p_journey_id, v_journey.driver_record_id, v_effective_user_id, 'READINESS_CHECK',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('status', v_readiness_status, 'is_safe', p_vehicle_safe, 'battery', p_battery_level)
  );

  RETURN jsonb_build_object(
    'success', true,
    'readiness_status', v_readiness_status,
    'message', CASE WHEN v_readiness_status = 'passed' THEN 'Vehicle cleared for safe departure.' ELSE 'Vehicle flagged as unsafe. Departure blocked.' END
  );
END;
$$;

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
  v_effective_user_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_user RECORD;
  v_stop RECORD;
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

  SELECT * INTO v_user FROM public.profiles WHERE id = v_effective_user_id;
  IF NOT FOUND OR v_user.is_active IS NOT TRUE OR NOT (
    v_user.role IN ('driver', 'boarding_officer')
    OR (v_user.role = 'admin' AND v_user.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied.');
  END IF;

  SELECT j.*, r.transport_group_id INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_journey.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'error', 'Cannot record milestone updates for a completed or cancelled journey.');
  END IF;

  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: Not authorised for this hostel operation.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id IS DISTINCT FROM v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'You are not the driver assigned to this journey.');
  END IF;

  SELECT * INTO v_stop FROM public.stops WHERE id = p_stop_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'STOP_NOT_FOUND', 'error', 'Stop not found.');
  END IF;

  INSERT INTO public.journey_stop_updates (
    journey_id, stop_id, recorded_by_user_id, event_type, is_assisted, notes, created_at
  )
  VALUES (
    p_journey_id, p_stop_id, v_effective_user_id, p_event_type, p_is_assisted, p_notes, now()
  );

  INSERT INTO public.journey_operational_logs (
    journey_id, driver_id, recorded_by_user_id, action_type, operation_mode, details
  )
  VALUES (
    p_journey_id, v_journey.driver_record_id, v_effective_user_id, 'STOP_UPDATE',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('stop_name', v_stop.name, 'event_type', p_event_type)
  );

  RETURN jsonb_build_object('success', true, 'message', 'Milestone update recorded: ' || v_stop.name || ' (' || p_event_type || ').');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_journey_delay_with_notifications(
  p_journey_id UUID,
  p_user_id UUID,
  p_delay_minutes INTEGER,
  p_delay_reason TEXT,
  p_is_assisted BOOLEAN DEFAULT FALSE
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
  v_user RECORD;
  v_passenger RECORD;
  v_notified_count INTEGER := 0;
  v_reason TEXT := trim(COALESCE(p_delay_reason, ''));
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

  SELECT * INTO v_user FROM public.profiles WHERE id = v_effective_user_id;
  IF NOT FOUND OR v_user.is_active IS NOT TRUE OR NOT (
    v_user.role IN ('driver', 'boarding_officer')
    OR (v_user.role = 'admin' AND v_user.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied.');
  END IF;

  IF p_delay_minutes IS NULL OR p_delay_minutes < 1 OR p_delay_minutes > 360 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_DELAY', 'error', 'Delay duration must be between 1 and 360 minutes.');
  END IF;

  IF length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_REASON', 'error', 'A delay reason is required.');
  END IF;

  SELECT j.*, r.name AS route_name, r.transport_group_id
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_journey.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'error', 'Cannot report delay on a completed or cancelled journey.');
  END IF;

  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: Not authorised for this hostel operation.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id IS DISTINCT FROM v_effective_user_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'You are not the driver assigned to this journey.');
  END IF;

  BEGIN
    PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
    UPDATE public.journeys
    SET delay_minutes = p_delay_minutes,
        delay_reason = v_reason,
        updated_at = now()
    WHERE id = p_journey_id;
    PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ASSIGNMENT_CONFLICT',
      'error', SQLERRM
    );
  END;

  FOR v_passenger IN
    SELECT b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('confirmed', 'checked_in')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, related_journey_id)
    VALUES (
      v_passenger.student_id,
      'Trip Delay: ' || p_delay_minutes || ' Mins',
      'Departure on ' || v_journey.route_name || ' delayed by ' || p_delay_minutes || ' mins. Reason: ' || v_reason,
      'delay_alert',
      p_journey_id
    );
    v_notified_count := v_notified_count + 1;
  END LOOP;

  INSERT INTO public.journey_operational_logs (
    journey_id, driver_id, recorded_by_user_id, action_type, operation_mode, details
  )
  VALUES (
    p_journey_id, v_journey.driver_record_id, v_effective_user_id, 'DELAY_REPORTED',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('delay_minutes', p_delay_minutes, 'reason', v_reason, 'passengers_notified', v_notified_count)
  );

  RETURN jsonb_build_object('success', true, 'notified_count', v_notified_count, 'message', 'Delay logged. ' || v_notified_count || ' confirmed passengers notified.');
END;
$$;

-- Safe departure now enforces Stage 6 ('ready_to_depart') and readiness_status <> 'failed_unsafe'
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

  SELECT * INTO v_user FROM public.profiles WHERE id = v_effective_actor_id;
  IF NOT FOUND OR v_user.is_active IS NOT TRUE OR NOT (
    v_user.role IN ('driver', 'boarding_officer')
    OR (v_user.role = 'admin' AND v_user.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Caller cannot record departure.');
  END IF;

  SELECT j.*, r.transport_group_id, r.name AS route_name, v.registration_number AS bus_reg
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: Not authorised for this hostel operation.');
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

CREATE OR REPLACE FUNCTION public.record_journey_arrival_safe(
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

  SELECT * INTO v_user FROM public.profiles WHERE id = v_effective_actor_id;
  IF NOT FOUND OR v_user.is_active IS NOT TRUE OR NOT (
    v_user.role IN ('driver', 'boarding_officer')
    OR (v_user.role = 'admin' AND v_user.admin_role IN ('super_admin', 'bus_manager', 'hostel_manager'))
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Caller cannot record arrival.');
  END IF;

  SELECT j.*, r.transport_group_id, v.registration_number AS bus_reg
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  JOIN public.vehicles v ON v.id = j.vehicle_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey not found.');
  END IF;

  IF v_user.role = 'boarding_officer' THEN
    IF v_user.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_user.assigned_transport_group_id THEN
      RETURN jsonb_build_object('success', false, 'code', 'CROSS_GROUP_DENIED', 'error', 'Cross-Group Restriction: Not authorised for this hostel operation.');
    END IF;
  END IF;

  IF v_user.role = 'driver' AND v_journey.driver_id IS DISTINCT FROM v_effective_actor_id AND NOT EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_journey.driver_record_id AND d.profile_id = v_effective_actor_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNASSIGNED_DRIVER', 'error', 'You are not the driver assigned to this journey.');
  END IF;

  IF v_journey.status <> 'in_transit' THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', 'Cannot record arrival: Trip must be in transit (Current status: ' || v_journey.status || ').');
  END IF;

  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'on', true);
  UPDATE public.journeys
  SET status = 'completed',
      actual_arrival = v_now,
      is_assisted_operation = (is_assisted_operation OR p_is_assisted),
      updated_at = v_now
  WHERE id = p_journey_id;
  PERFORM pg_catalog.set_config('cosmoride.internal_journey_workflow', 'off', true);

  INSERT INTO public.journey_operational_logs (
    journey_id, driver_id, recorded_by_user_id, action_type, operation_mode, details
  )
  VALUES (
    p_journey_id, v_journey.driver_record_id, v_effective_actor_id, 'ARRIVAL',
    CASE WHEN p_is_assisted THEN 'assisted' ELSE 'direct' END,
    jsonb_build_object('actual_arrival', v_now, 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Bus ' || v_journey.bus_reg || ' arrived at destination. Journey completed.',
    'actual_arrival', v_now
  );
END;
$$;

-- Hardened system settings & incident RPCs (scoped admin_role)
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
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only Super Administrators can modify system settings.');
  END IF;

  IF p_key = 'booking_cutoff_minutes' THEN
    BEGIN
      v_val_int := (p_value #>> '{}')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'booking_cutoff_minutes must be an integer between 0 and 120.');
    END;
    IF v_val_int IS NULL OR v_val_int < 0 OR v_val_int > 120 THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'booking_cutoff_minutes must be between 0 and 120.');
    END IF;
    p_value := to_jsonb(v_val_int);
  ELSIF p_key = 'booking_window_hours_ahead' THEN
    BEGIN
      v_val_int := (p_value #>> '{}')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'booking_window_hours_ahead must be an integer between 1 and 168.');
    END;
    IF v_val_int IS NULL OR v_val_int < 1 OR v_val_int > 168 THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'booking_window_hours_ahead must be between 1 and 168.');
    END IF;
    p_value := to_jsonb(v_val_int);
  ELSIF p_key = 'boarding_window_minutes' THEN
    BEGIN
      v_val_int := (p_value #>> '{}')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'boarding_window_minutes must be an integer between 1 and 60.');
    END;
    IF v_val_int IS NULL OR v_val_int < 1 OR v_val_int > 60 THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'boarding_window_minutes must be between 1 and 60.');
    END IF;
    p_value := to_jsonb(v_val_int);
  ELSIF p_key = 'cancellation_cutoff_minutes' THEN
    BEGIN
      v_val_int := (p_value #>> '{}')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'cancellation_cutoff_minutes must be an integer between 0 and 1440.');
    END;
    IF v_val_int IS NULL OR v_val_int < 0 OR v_val_int > 1440 THEN
      RETURN jsonb_build_object('success', false, 'code', 'INVALID_SETTING_VALUE', 'error', 'cancellation_cutoff_minutes must be between 0 and 1440.');
    END IF;
    p_value := to_jsonb(v_val_int);
  END IF;

  SELECT value INTO v_old_value FROM public.system_settings WHERE key = p_key;

  INSERT INTO public.system_settings (key, value, description, updated_by, updated_at)
  VALUES (p_key, p_value, p_description, v_effective_admin_id, now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, public.system_settings.description),
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_admin_id,
    'SYSTEM_SETTING_UPDATED',
    'system_setting',
    NULL,
    jsonb_build_object('key', p_key, 'old_value', v_old_value, 'new_value', p_value)
  );

  RETURN jsonb_build_object('success', true, 'key', p_key, 'value', p_value, 'message', 'System setting updated.');
END;
$$;

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
  v_effective_admin_id UUID;
  v_jwt_role TEXT;
  v_admin RECORD;
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
  IF NOT FOUND OR v_admin.is_active IS NOT TRUE OR v_admin.role <> 'admin' OR v_admin.admin_role NOT IN ('super_admin', 'bus_manager', 'hostel_manager') THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Permission denied: Only authorised administrators can update incidents.');
  END IF;

  UPDATE public.incident_reports
  SET status = p_status,
      resolution_notes = p_resolution_notes,
      resolved_by = v_effective_admin_id,
      resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_incident_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Incident report not found.');
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (v_effective_admin_id, 'INCIDENT_STATUS_UPDATED', 'incident_report', p_incident_id, jsonb_build_object('status', p_status, 'resolution_notes', p_resolution_notes));

  RETURN jsonb_build_object('success', true, 'message', 'Incident updated to ' || p_status || '.');
END;
$$;

-- ============================================================================
-- 8. STRICT LEAST-PRIVILEGE GRANTS & REVOKES
-- ============================================================================

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Internal triggers must NEVER be callable by client roles
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.prevent_audit_log_modification() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.enforce_journey_vehicle_availability() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.protect_journey_lifecycle() FROM PUBLIC, anon, authenticated, service_role;

-- RLS / availability helpers: authenticated & service_role
GRANT EXECUTE ON FUNCTION public.rls_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_user_is_active() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_admin_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_assigned_transport_group() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_driver_assigned_to_journey(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_staff_can_view_profile(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_route_duration_minutes(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_driver_assignment_conflict(UUID, UUID, DATE, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_driver_assignment_conflict(UUID, UUID, DATE, TIMESTAMPTZ, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_vehicle_assignment_conflict(UUID, DATE, TIMESTAMPTZ, UUID, UUID) TO authenticated, service_role;

-- Student RPCs (strictly authenticated only; never service_role except profile registration)
REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.cancel_waitlist_entry(UUID, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_waitlist_entry(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.select_student_hostel(UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.select_student_hostel(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.complete_student_profile(TEXT, TEXT, UUID) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_student_profile(TEXT, TEXT, UUID) TO authenticated;

-- Operational / workflow RPCs
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

-- Admin / scheduling RPCs
GRANT EXECUTE ON FUNCTION public.admin_create_journey(UUID, UUID, UUID, UUID, UUID, DATE, TIMESTAMPTZ, INTEGER, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_incident_status(UUID, UUID, public.incident_status, TEXT) TO authenticated, service_role;

