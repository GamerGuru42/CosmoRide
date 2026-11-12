-- CosmoRide Migration 00024: Fix Inactive-Account RLS Policy Bypass
-- Cosmopolitan University, Nigeria
--
-- Remediates two confirmed PERMISSIVE OR-combination RLS bypasses from migration 00022:
--   1. public.boarding_records ("Scoped staff boarding records access")
--   2. public.waitlists ("Staff can view group waitlists")
--
-- Both policies previously contained an unguarded `student_id = (SELECT auth.uid())`
-- branch alongside authorised staff paths, allowing inactive students to read their
-- own records despite the `public.rls_user_is_active()` guard added in migration 00023
-- on "Students can view own boarding records" and "Students can view own waitlist status".
--
-- Only these two staff SELECT policies are dropped and recreated:
--   - Removes the redundant `student_id = (SELECT auth.uid())` branch completely.
--   - Explicitly wraps all authorised staff paths with `public.rls_user_is_active() AND (...)`.
--   - Preserves existing admin, transport-group-scoped boarding officer, and assigned-driver access.
--
-- Intentionally preserved unchanged:
--   - "Students can view own boarding records" (00023)
--   - "Students can view own waitlist status" (00023)
--   - "Scoped profile read access" on public.profiles (00022), which must remain readable
--     for an inactive user's own row so middleware, auth callback, and layouts can inspect
--     `is_active = false`, sign the user out, and redirect to account_inactive.

DROP POLICY IF EXISTS "Scoped staff boarding records access" ON public.boarding_records;

CREATE POLICY "Scoped staff boarding records access"
  ON public.boarding_records FOR SELECT
  TO authenticated
  USING (
    public.rls_user_is_active()
    AND (
      public.rls_is_admin()
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
    )
  );

DROP POLICY IF EXISTS "Staff can view group waitlists" ON public.waitlists;

CREATE POLICY "Staff can view group waitlists"
  ON public.waitlists FOR SELECT
  TO authenticated
  USING (
    public.rls_user_is_active()
    AND (
      public.rls_is_admin()
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
    )
  );
