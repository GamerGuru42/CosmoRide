-- CosmoRide Migration 00012: Production Reference Data Provisioning
-- Cosmopolitan University, Abuja, Nigeria
--
-- This migration provisions verified institutional reference data:
-- 1. Official Campuses: Main Campus and Kado Campus.
-- 2. Institutional Boys' Transport Group: BOYS_FLEET.
-- 3. Verified Hostels: Main Boys' Hostel (Kado Campus) and Wuye Boys' Hostel.
-- 4. Verified Transport Stops: Main Boys' Hostel, Wuye Boys' Hostel, Main Campus Central Bus Park, Kado Campus Bus Terminal.
-- 5. Four Confirmed Boys' Route Patterns:
--    - BOYS_AM_ROUTE: 07:30 AM via Wuye (3 stops)
--    - BOYS_AM_DIRECT: 08:30 AM direct express (2 stops)
--    - BOYS_PM_DIRECT: 16:00 PM direct express (2 stops)
--    - BOYS_PM_ROUTE: 16:50 PM planned / 17:00 PM latest departure window via Wuye (3 stops)
-- 6. Recurring Weekday Timetable Templates:
--    - Exactly 20 Monday-Friday schedule templates (4 routes x 5 weekdays).
--
-- STRICT RESTRICTIONS:
-- - Zero fake students, drivers, vehicles, bookings, or journey instances.
-- - Girls' operations left completely unconfigured pending verified operational timetable.
-- - Fully idempotent upserts ensuring zero duplicates upon re-execution.

-- ============================================================
-- 1. CAMPUSES
-- ============================================================

INSERT INTO public.campuses (name, code, address, is_active)
VALUES
  ('Main Campus', 'MAIN', 'Cosmopolitan University Main Campus, Abuja, Nigeria', TRUE),
  ('Kado Campus', 'KADO', 'Cosmopolitan University Kado Campus, Abuja, Nigeria', TRUE)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    address = EXCLUDED.address,
    is_active = TRUE;

-- ============================================================
-- 2. TRANSPORT GROUPS
-- ============================================================

INSERT INTO public.transport_groups (name, code, description, gender_group, is_active)
VALUES
  (
    'Boys Transport Fleet',
    'BOYS_FLEET',
    'Dedicated transport operations for Main & Wuye boys hostels',
    'male',
    TRUE
  )
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    gender_group = EXCLUDED.gender_group,
    is_active = TRUE;

-- ============================================================
-- 3. HOSTELS
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_hostels_name ON public.hostels(name);

DO $$
DECLARE
  v_main_campus_id UUID;
  v_kado_campus_id UUID;
  v_boys_group_id UUID;
BEGIN
  SELECT id INTO v_main_campus_id FROM public.campuses WHERE code = 'MAIN';
  SELECT id INTO v_kado_campus_id FROM public.campuses WHERE code = 'KADO';
  SELECT id INTO v_boys_group_id FROM public.transport_groups WHERE code = 'BOYS_FLEET';

  INSERT INTO public.hostels (name, campus_id, gender, transport_group_id, is_active)
  VALUES
    (
      'Main Boys'' Hostel, Kado Campus',
      v_kado_campus_id,
      'male',
      v_boys_group_id,
      TRUE
    ),
    (
      'Wuye Boys'' Hostel',
      v_main_campus_id,
      'male',
      v_boys_group_id,
      TRUE
    )
  ON CONFLICT (name) DO UPDATE
  SET campus_id = EXCLUDED.campus_id,
      gender = EXCLUDED.gender,
      transport_group_id = EXCLUDED.transport_group_id,
      is_active = TRUE;
END $$;

-- ============================================================
-- 4. TRANSPORT STOPS
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_name ON public.stops(name);

DO $$
DECLARE
  v_main_campus_id UUID;
  v_kado_campus_id UUID;
BEGIN
  SELECT id INTO v_main_campus_id FROM public.campuses WHERE code = 'MAIN';
  SELECT id INTO v_kado_campus_id FROM public.campuses WHERE code = 'KADO';

  INSERT INTO public.stops (name, campus_id, address)
  VALUES
    (
      'Main Boys'' Hostel Stop',
      v_kado_campus_id,
      'Main Boys Hostel Entrance, Kado Campus, Abuja'
    ),
    (
      'Wuye Boys'' Hostel Stop',
      NULL,
      'Wuye Boys Hostel, Wuye District, Abuja'
    ),
    (
      'Main Campus Central Bus Park',
      v_main_campus_id,
      'Administrative Plaza & Central Bus Park, Main Campus, Abuja'
    ),
    (
      'Kado Campus Bus Terminal',
      v_kado_campus_id,
      'Academic Wing A & Bus Terminal, Kado Campus, Abuja'
    )
  ON CONFLICT (name) DO UPDATE
  SET campus_id = EXCLUDED.campus_id,
      address = EXCLUDED.address;
END $$;

-- ============================================================
-- 5. FOUR CONFIRMED BOYS' ROUTE CORRIDORS
-- ============================================================

DO $$
DECLARE
  v_boys_group_id UUID;
BEGIN
  SELECT id INTO v_boys_group_id FROM public.transport_groups WHERE code = 'BOYS_FLEET';

  INSERT INTO public.routes (name, code, description, gender_group, transport_group_id, is_active)
  VALUES
    (
      'Boys'' Morning Corridor (Main Boys to Main Campus via Wuye)',
      'BOYS_AM_ROUTE',
      'Pattern 1: 07:30 AM departure from Main Boys'' Hostel via Wuye Boys'' Hostel to Main Campus',
      'male',
      v_boys_group_id,
      TRUE
    ),
    (
      'Boys'' Morning Direct (Main Boys to Main Campus Express)',
      'BOYS_AM_DIRECT',
      'Pattern 2: 08:30 AM departure directly from Main Boys'' Hostel to Main Campus (no Wuye stop)',
      'male',
      v_boys_group_id,
      TRUE
    ),
    (
      'Boys'' Evening Direct (Main Campus to Main Boys Express)',
      'BOYS_PM_DIRECT',
      'Pattern 3: 04:00 PM departure directly from Main Campus to Main Boys'' Hostel (no Wuye stop)',
      'male',
      v_boys_group_id,
      TRUE
    ),
    (
      'Boys'' Evening Corridor (Main Campus to Main Boys via Wuye)',
      'BOYS_PM_ROUTE',
      'Pattern 4: 04:50 PM planned departure (05:00 PM latest) from Main Campus via Wuye Boys'' Hostel to Main Boys'' Hostel',
      'male',
      v_boys_group_id,
      TRUE
    )
  ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      gender_group = EXCLUDED.gender_group,
      transport_group_id = EXCLUDED.transport_group_id,
      is_active = TRUE;
END $$;

-- ============================================================
-- 6. ORDERED ROUTE STOPS
-- ============================================================

DO $$
DECLARE
  v_route_am_via UUID;
  v_route_am_dir UUID;
  v_route_pm_dir UUID;
  v_route_pm_via UUID;

  v_stop_main_boys UUID;
  v_stop_wuye_boys UUID;
  v_stop_main_campus UUID;
BEGIN
  SELECT id INTO v_route_am_via FROM public.routes WHERE code = 'BOYS_AM_ROUTE';
  SELECT id INTO v_route_am_dir FROM public.routes WHERE code = 'BOYS_AM_DIRECT';
  SELECT id INTO v_route_pm_dir FROM public.routes WHERE code = 'BOYS_PM_DIRECT';
  SELECT id INTO v_route_pm_via FROM public.routes WHERE code = 'BOYS_PM_ROUTE';

  SELECT id INTO v_stop_main_boys FROM public.stops WHERE name = 'Main Boys'' Hostel Stop';
  SELECT id INTO v_stop_wuye_boys FROM public.stops WHERE name = 'Wuye Boys'' Hostel Stop';
  SELECT id INTO v_stop_main_campus FROM public.stops WHERE name = 'Main Campus Central Bus Park';

  -- Pattern 1 (BOYS_AM_ROUTE): Main Boys -> Wuye -> Main Campus
  INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
  VALUES
    (v_route_am_via, v_stop_main_boys, 1, 0),
    (v_route_am_via, v_stop_wuye_boys, 2, 15),
    (v_route_am_via, v_stop_main_campus, 3, 35)
  ON CONFLICT (route_id, stop_order) DO UPDATE
  SET stop_id = EXCLUDED.stop_id,
      estimated_minutes_from_start = EXCLUDED.estimated_minutes_from_start;

  -- Pattern 2 (BOYS_AM_DIRECT): Main Boys -> Main Campus (No Wuye stop)
  INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
  VALUES
    (v_route_am_dir, v_stop_main_boys, 1, 0),
    (v_route_am_dir, v_stop_main_campus, 2, 25)
  ON CONFLICT (route_id, stop_order) DO UPDATE
  SET stop_id = EXCLUDED.stop_id,
      estimated_minutes_from_start = EXCLUDED.estimated_minutes_from_start;

  -- Pattern 3 (BOYS_PM_DIRECT): Main Campus -> Main Boys (No Wuye stop)
  INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
  VALUES
    (v_route_pm_dir, v_stop_main_campus, 1, 0),
    (v_route_pm_dir, v_stop_main_boys, 2, 25)
  ON CONFLICT (route_id, stop_order) DO UPDATE
  SET stop_id = EXCLUDED.stop_id,
      estimated_minutes_from_start = EXCLUDED.estimated_minutes_from_start;

  -- Pattern 4 (BOYS_PM_ROUTE): Main Campus -> Wuye -> Main Boys
  INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
  VALUES
    (v_route_pm_via, v_stop_main_campus, 1, 0),
    (v_route_pm_via, v_stop_wuye_boys, 2, 20),
    (v_route_pm_via, v_stop_main_boys, 3, 35)
  ON CONFLICT (route_id, stop_order) DO UPDATE
  SET stop_id = EXCLUDED.stop_id,
      estimated_minutes_from_start = EXCLUDED.estimated_minutes_from_start;
END $$;

-- ============================================================
-- 7. RECURRING WEEKDAY SCHEDULE TEMPLATES (MONDAY - FRIDAY)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_route_dow_departure 
ON public.schedules (route_id, day_of_week, departure_time);

DO $$
DECLARE
  v_route_am_via UUID;
  v_route_am_dir UUID;
  v_route_pm_dir UUID;
  v_route_pm_via UUID;
  v_dow INTEGER;
BEGIN
  SELECT id INTO v_route_am_via FROM public.routes WHERE code = 'BOYS_AM_ROUTE';
  SELECT id INTO v_route_am_dir FROM public.routes WHERE code = 'BOYS_AM_DIRECT';
  SELECT id INTO v_route_pm_dir FROM public.routes WHERE code = 'BOYS_PM_DIRECT';
  SELECT id INTO v_route_pm_via FROM public.routes WHERE code = 'BOYS_PM_ROUTE';

  -- Loop through weekdays Monday (1) to Friday (5)
  FOR v_dow IN 1..5 LOOP
    -- Pattern 1: 07:30 AM via Wuye
    INSERT INTO public.schedules (
      route_id, day_of_week, departure_time, latest_departure_time,
      direction, proposed_allocation, is_active, notes
    )
    VALUES (
      v_route_am_via, v_dow, '07:30:00'::TIME, NULL,
      'inbound', 30, TRUE, 'Pattern 1: 07:30 AM Main Boys -> Wuye Boys -> Main Campus'
    )
    ON CONFLICT (route_id, day_of_week, departure_time) DO UPDATE
    SET latest_departure_time = EXCLUDED.latest_departure_time,
        direction = EXCLUDED.direction,
        proposed_allocation = EXCLUDED.proposed_allocation,
        notes = EXCLUDED.notes,
        is_active = TRUE;

    -- Pattern 2: 08:30 AM Direct Express
    INSERT INTO public.schedules (
      route_id, day_of_week, departure_time, latest_departure_time,
      direction, proposed_allocation, is_active, notes
    )
    VALUES (
      v_route_am_dir, v_dow, '08:30:00'::TIME, NULL,
      'inbound', 30, TRUE, 'Pattern 2: 08:30 AM Main Boys -> Main Campus Express (no Wuye stop)'
    )
    ON CONFLICT (route_id, day_of_week, departure_time) DO UPDATE
    SET latest_departure_time = EXCLUDED.latest_departure_time,
        direction = EXCLUDED.direction,
        proposed_allocation = EXCLUDED.proposed_allocation,
        notes = EXCLUDED.notes,
        is_active = TRUE;

    -- Pattern 3: 04:00 PM Direct Express
    INSERT INTO public.schedules (
      route_id, day_of_week, departure_time, latest_departure_time,
      direction, proposed_allocation, is_active, notes
    )
    VALUES (
      v_route_pm_dir, v_dow, '16:00:00'::TIME, NULL,
      'outbound', 30, TRUE, 'Pattern 3: 04:00 PM Main Campus -> Main Boys Express (no Wuye stop)'
    )
    ON CONFLICT (route_id, day_of_week, departure_time) DO UPDATE
    SET latest_departure_time = EXCLUDED.latest_departure_time,
        direction = EXCLUDED.direction,
        proposed_allocation = EXCLUDED.proposed_allocation,
        notes = EXCLUDED.notes,
        is_active = TRUE;

    -- Pattern 4: 04:50 PM planned / 05:00 PM latest departure window via Wuye
    INSERT INTO public.schedules (
      route_id, day_of_week, departure_time, latest_departure_time,
      direction, proposed_allocation, is_active, notes
    )
    VALUES (
      v_route_pm_via, v_dow, '16:50:00'::TIME, '17:00:00'::TIME,
      'outbound', 30, TRUE, 'Pattern 4: 04:50 PM Main Campus -> Wuye Boys -> Main Boys (05:00 PM latest departure window)'
    )
    ON CONFLICT (route_id, day_of_week, departure_time) DO UPDATE
    SET latest_departure_time = EXCLUDED.latest_departure_time,
        direction = EXCLUDED.direction,
        proposed_allocation = EXCLUDED.proposed_allocation,
        notes = EXCLUDED.notes,
        is_active = TRUE;
  END LOOP;
END $$;
