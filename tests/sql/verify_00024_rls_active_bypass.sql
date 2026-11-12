-- =============================================================================
-- CosmoRide Optional Live PostgreSQL Verification Script for Migration 00024
-- =============================================================================
-- PURPOSE:
--   Manually verifies in a Staging SQL Editor session (INSIDE A ROLLED-BACK
--   TRANSACTION) that after migration 00024 is applied:
--     1. Inactive students receive 0 rows from public.boarding_records and
--        public.waitlists, while retaining own-row READ access on public.profiles
--        so SSR middleware/guards can detect is_active = FALSE.
--     2. Active students retain own-row READ access on both tables.
--     3. Active Super Admins, Bus Managers, Hostel Managers, group-scoped
--        Boarding Officers, and journey-assigned Drivers retain scoped access.
--     4. Inactive staff users receive 0 rows on both tables.
--
-- IMPORTANT PREREQUISITES (DO NOT ASSUME PRE-SEEDED STAGING DATA):
--   Staging may have empty tables or non-existent sample rows. Before running:
--     1. Apply migration 00024 cleanly to the isolated Staging database.
--     2. Ensure real test fixture rows exist in Staging (or create temporary
--        fixture rows inside the BEGIN ... ROLLBACK block with service_role):
--          - At least 1 inactive student profile with >= 1 row in
--            public.boarding_records and >= 1 row in public.waitlists.
--          - At least 1 active student profile with >= 1 row in
--            public.boarding_records and >= 1 row in public.waitlists.
--          - An active boarding officer assigned to <ASSIGNED_GROUP_UUID>
--            and a journey in <OTHER_GROUP_UUID>.
--          - An active driver assigned to <ASSIGNED_JOURNEY_UUID>
--            and an unassigned <OTHER_JOURNEY_UUID>.
--          - An active admin (super_admin / bus_manager / hostel_manager)
--            and an inactive staff account.
--     3. Zero rows from an empty table DO NOT prove RLS enforcement; verify
--        the unauthenticated/service_role baseline count is > 0 first.
--
-- DO NOT EXECUTE IN PRODUCTION.
-- =============================================================================

BEGIN;

-- Replace every <...> placeholder below with verified Staging fixture UUIDs.
SET LOCAL ROLE authenticated;

-- 1. Inactive student MUST get 0 rows on boarding_records & waitlists,
--    and still read own profiles.is_active = false.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<INACTIVE_STUDENT_UUID>', 'role', 'authenticated')::text,
  true
);
SELECT count(*) AS inactive_student_boarding_rows
FROM public.boarding_records
WHERE student_id = '<INACTIVE_STUDENT_UUID>'; -- Expected: 0

SELECT count(*) AS inactive_student_waitlist_rows
FROM public.waitlists
WHERE student_id = '<INACTIVE_STUDENT_UUID>'; -- Expected: 0

SELECT id, is_active
FROM public.profiles
WHERE id = '<INACTIVE_STUDENT_UUID>'; -- Expected: 1 row with is_active = false

-- 2. Active student MUST still see own rows (baseline fixture count >= 1).
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<ACTIVE_STUDENT_UUID>', 'role', 'authenticated')::text,
  true
);
SELECT count(*) AS active_student_boarding_rows
FROM public.boarding_records
WHERE student_id = '<ACTIVE_STUDENT_UUID>'; -- Expected: >= 1

SELECT count(*) AS active_student_waitlist_rows
FROM public.waitlists
WHERE student_id = '<ACTIVE_STUDENT_UUID>'; -- Expected: >= 1

-- 3. Active boarding officer MUST see assigned transport-group rows only.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<ACTIVE_BOARDING_OFFICER_UUID>', 'role', 'authenticated')::text,
  true
);
SELECT count(*) AS officer_assigned_group_boarding_rows
FROM public.boarding_records
WHERE journey_id = '<ASSIGNED_GROUP_JOURNEY_UUID>'; -- Expected: >= 1

SELECT count(*) AS officer_other_group_boarding_rows
FROM public.boarding_records
WHERE journey_id = '<OTHER_GROUP_JOURNEY_UUID>'; -- Expected: 0

-- 4. Active driver MUST see assigned journey rows only.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<ACTIVE_DRIVER_UUID>', 'role', 'authenticated')::text,
  true
);
SELECT count(*) AS driver_assigned_journey_waitlist_rows
FROM public.waitlists
WHERE journey_id = '<ASSIGNED_JOURNEY_UUID>'; -- Expected: >= 1

SELECT count(*) AS driver_other_journey_waitlist_rows
FROM public.waitlists
WHERE journey_id = '<OTHER_JOURNEY_UUID>'; -- Expected: 0

-- 5. Active admin (super_admin / bus_manager / hostel_manager) MUST see all rows.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<ACTIVE_ADMIN_UUID>', 'role', 'authenticated')::text,
  true
);
SELECT count(*) AS admin_boarding_rows FROM public.boarding_records; -- Expected: > 0
SELECT count(*) AS admin_waitlist_rows FROM public.waitlists;        -- Expected: > 0

-- 6. Inactive staff account MUST get 0 rows on both tables.
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '<INACTIVE_STAFF_UUID>', 'role', 'authenticated')::text,
  true
);
SELECT count(*) AS inactive_staff_boarding_rows FROM public.boarding_records; -- Expected: 0
SELECT count(*) AS inactive_staff_waitlist_rows FROM public.waitlists;        -- Expected: 0

ROLLBACK;
