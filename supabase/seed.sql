-- CosmoRide Institutional Baseline Configuration (Development & Staging)
-- Cosmopolitan University, Nigeria
--
-- NON-NEGOTIABLE RULE: No fake students, no fake bookings, no fake trips, no fake passenger counts.
-- This file populates only the approved structural reference data:
-- 1. Campuses (Main Campus, Kado Campus)
-- 2. Transport Groups (Girls' Fleet, Boys' Operations, Inter-Campus)
-- 3. Hostels (Girls' Hostel, Main Boys' Hostel, Wuye Boys' Hostel)
-- 4. Bus Stops & Terminals
-- 5. Standard Route Corridors & Ordered Stops
-- 6. Initial Approved Fleet Vehicles with Safe Passenger Capacities

-- ============================================================
-- 1. CAMPUSES
-- ============================================================

INSERT INTO public.campuses (id, name, code, address, is_active)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Main Campus', 'MAIN', 'Cosmopolitan University Main Campus, Abuja, Nigeria', TRUE),
  ('c1000000-0000-0000-0000-000000000002', 'Kado Campus', 'KADO', 'Cosmopolitan University Kado Campus, Abuja, Nigeria', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. TRANSPORT GROUPS
-- ============================================================

INSERT INTO public.transport_groups (id, name, code, description, gender_group, is_active)
VALUES
  ('g1000000-0000-0000-0000-000000000001', 'Girls Transport Fleet', 'GIRLS_FLEET', 'Dedicated transport operations for female students and residents', 'female', TRUE),
  ('g1000000-0000-0000-0000-000000000002', 'Boys Transport Fleet', 'BOYS_FLEET', 'Dedicated transport operations for Main & Wuye boys hostels', 'male', TRUE),
  ('g1000000-0000-0000-0000-000000000003', 'Inter-Campus Shuttle', 'INTER_CAMPUS', 'Scheduled transfers between Main Campus and Kado Campus', 'mixed', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. HOSTELS
-- ============================================================

INSERT INTO public.hostels (id, name, campus_id, transport_group_id, gender, is_active)
VALUES
  (
    'h1000000-0000-0000-0000-000000000001',
    'Girls'' Hostel',
    'c1000000-0000-0000-0000-000000000001',
    'g1000000-0000-0000-0000-000000000001',
    'female',
    TRUE
  ),
  (
    'h1000000-0000-0000-0000-000000000002',
    'Main Boys'' Hostel',
    'c1000000-0000-0000-0000-000000000001',
    'g1000000-0000-0000-0000-000000000002',
    'male',
    TRUE
  ),
  (
    'h1000000-0000-0000-0000-000000000003',
    'Wuye Boys'' Hostel',
    'c1000000-0000-0000-0000-000000000001',
    'g1000000-0000-0000-0000-000000000002',
    'male',
    TRUE
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. BUS STOPS & TERMINALS
-- ============================================================

INSERT INTO public.stops (id, name, campus_id, address)
VALUES
  ('s1000000-0000-0000-0000-000000000001', 'Girls'' Hostel Terminal', 'c1000000-0000-0000-0000-000000000001', 'Girls Hostel Quadrangle, Main Campus'),
  ('s1000000-0000-0000-0000-000000000002', 'Main Boys'' Hostel Stop', 'c1000000-0000-0000-0000-000000000001', 'Main Boys Hostel Entrance'),
  ('s1000000-0000-0000-0000-000000000003', 'Wuye Boys'' Hostel Stop', NULL, 'Wuye Boys Hostel, Wuye District, Abuja'),
  ('s1000000-0000-0000-0000-000000000004', 'Main Campus Central Bus Park', 'c1000000-0000-0000-0000-000000000001', 'Administrative Plaza, Main Campus'),
  ('s1000000-0000-0000-0000-000000000005', 'Kado Campus Bus Terminal', 'c1000000-0000-0000-0000-000000000002', 'Academic Wing A, Kado Campus')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. ROUTES & STOPS
-- ============================================================

INSERT INTO public.routes (id, name, code, description, gender_group, transport_group_id, is_active)
VALUES
  (
    'r1000000-0000-0000-0000-000000000001',
    'Girls'' Campus Shuttle',
    'GIRLS_ROUTE',
    'Direct transit connecting Girls Hostel to Main Campus Central Park',
    'female',
    'g1000000-0000-0000-0000-000000000001',
    TRUE
  ),
  (
    'r1000000-0000-0000-0000-000000000002',
    'Boys'' Morning Corridor (Main & Wuye to Main Campus)',
    'BOYS_AM_ROUTE',
    'Morning run: Main Boys Hostel pickup -> Wuye Boys Hostel pickup -> Main Campus drop-off',
    'male',
    'g1000000-0000-0000-0000-000000000002',
    TRUE
  ),
  (
    'r1000000-0000-0000-0000-000000000003',
    'Boys'' Evening Return (Main Campus to Wuye & Main)',
    'BOYS_PM_ROUTE',
    'Evening return: Main Campus pickup -> Wuye Boys Hostel -> Main Boys Hostel',
    'male',
    'g1000000-0000-0000-0000-000000000002',
    TRUE
  ),
  (
    'r1000000-0000-0000-0000-000000000004',
    'Main - Kado Inter-Campus Shuttle',
    'MAIN_KADO_ROUTE',
    'Inter-campus express service between Main Campus Central Park and Kado Campus Terminal',
    'mixed',
    'g1000000-0000-0000-0000-000000000003',
    TRUE
  ),
  (
    'r1000000-0000-0000-0000-000000000005',
    'Boys'' Morning Direct (Main Boys'' Hostel to Main Campus)',
    'BOYS_AM_DIRECT',
    'Pattern 2: Morning express 08:30 directly from Main Boys'' Hostel to Main Campus (no Wuye stop)',
    'male',
    'g1000000-0000-0000-0000-000000000002',
    TRUE
  ),
  (
    'r1000000-0000-0000-0000-000000000006',
    'Boys'' Evening Direct (Main Campus to Main Boys'' Hostel)',
    'BOYS_PM_DIRECT',
    'Pattern 3: Evening express 16:00 directly from Main Campus to Main Boys'' Hostel (no Wuye stop)',
    'male',
    'g1000000-0000-0000-0000-000000000002',
    TRUE
  )
ON CONFLICT (code) DO NOTHING;

-- Ordered Route Stops

-- 1. Girls' Shuttle: Girls Hostel -> Main Campus Central Park
INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
VALUES
  ('r1000000-0000-0000-0000-000000000001', 's1000000-0000-0000-0000-000000000001', 1, 0),
  ('r1000000-0000-0000-0000-000000000001', 's1000000-0000-0000-0000-000000000004', 2, 12)
ON CONFLICT (route_id, stop_order) DO NOTHING;

-- 2. Boys' Morning: Main Boys Hostel -> Wuye Boys Hostel -> Main Campus Central Park
INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
VALUES
  ('r1000000-0000-0000-0000-000000000002', 's1000000-0000-0000-0000-000000000002', 1, 0),
  ('r1000000-0000-0000-0000-000000000002', 's1000000-0000-0000-0000-000000000003', 2, 15),
  ('r1000000-0000-0000-0000-000000000002', 's1000000-0000-0000-0000-000000000004', 3, 35)
ON CONFLICT (route_id, stop_order) DO NOTHING;

-- 3. Boys' Evening: Main Campus Central Park -> Wuye Boys Hostel -> Main Boys Hostel
INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
VALUES
  ('r1000000-0000-0000-0000-000000000003', 's1000000-0000-0000-0000-000000000004', 1, 0),
  ('r1000000-0000-0000-0000-000000000003', 's1000000-0000-0000-0000-000000000003', 2, 20),
  ('r1000000-0000-0000-0000-000000000003', 's1000000-0000-0000-0000-000000000002', 3, 35)
ON CONFLICT (route_id, stop_order) DO NOTHING;

-- 4. Inter-Campus: Main Campus -> Kado Campus
INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
VALUES
  ('r1000000-0000-0000-0000-000000000004', 's1000000-0000-0000-0000-000000000004', 1, 0),
  ('r1000000-0000-0000-0000-000000000004', 's1000000-0000-0000-0000-000000000005', 2, 25)
ON CONFLICT (route_id, stop_order) DO NOTHING;

-- 5. Boys' Morning Direct (Pattern 2): Main Boys' Hostel -> Main Campus Central Park (bypasses Wuye)
INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
VALUES
  ('r1000000-0000-0000-0000-000000000005', 's1000000-0000-0000-0000-000000000002', 1, 0),
  ('r1000000-0000-0000-0000-000000000005', 's1000000-0000-0000-0000-000000000004', 2, 25)
ON CONFLICT (route_id, stop_order) DO NOTHING;

-- 6. Boys' Evening Direct (Pattern 3): Main Campus Central Park -> Main Boys' Hostel (bypasses Wuye)
INSERT INTO public.route_stops (route_id, stop_id, stop_order, estimated_minutes_from_start)
VALUES
  ('r1000000-0000-0000-0000-000000000006', 's1000000-0000-0000-0000-000000000004', 1, 0),
  ('r1000000-0000-0000-0000-000000000006', 's1000000-0000-0000-0000-000000000002', 2, 25)
ON CONFLICT (route_id, stop_order) DO NOTHING;

-- ============================================================
-- 6. FLEET VEHICLES (DEVELOPMENT & STAGING REFERENCE FIXTURES)
-- Institutional Model: 3 buses operating simultaneously for Girls' operations,
-- each with configured safe seating capacity ceiling (proposed 30 seats).
-- IMPORTANT: These are development/staging fixtures, not verified production fleet assets.
-- In production, vehicles must be registered with genuine registration documents
-- and verified physical capacity audits by transport administration.
-- ============================================================

INSERT INTO public.vehicles (id, registration_number, name, safe_capacity, vehicle_type, is_active)
VALUES
  -- Girls' Operation Buses (3 Simultaneous Operating Units)
  ('v1000000-0000-0000-0000-000000000001', 'CU-EB-01', 'Electric Bus 01 (Girls Fleet)', 30, 'electric_bus', TRUE),
  ('v1000000-0000-0000-0000-000000000002', 'CU-EB-02', 'Electric Bus 02 (Girls Fleet)', 30, 'electric_bus', TRUE),
  ('v1000000-0000-0000-0000-000000000003', 'CU-EB-03', 'Electric Bus 03 (Girls Fleet)', 30, 'electric_bus', TRUE),

  -- Boys' Operation Buses
  ('v1000000-0000-0000-0000-000000000004', 'CU-EB-04', 'Electric Bus 04 (Boys Fleet)', 30, 'electric_bus', TRUE),

  -- Inter-Campus Shuttle
  ('v1000000-0000-0000-0000-000000000005', 'CU-EB-05', 'Electric Bus 05 (Inter-Campus)', 30, 'electric_bus', TRUE)
ON CONFLICT (registration_number) DO NOTHING;

-- ============================================================
-- 7. INSTITUTIONAL DRIVERS (MODE A & MODE B - STAGING REFERENCE FIXTURES)
-- Demonstrating both direct smartphone access and assisted operations.
-- IMPORTANT: These driver records are development/staging fixtures, not verified production personnel.
-- Real operational drivers must be onboarded through university HR directory onboarding.
-- ============================================================

INSERT INTO public.drivers (id, full_name, phone, driver_reference, assigned_vehicle_id, status, has_app_access, notes)
VALUES
  -- Girls' Fleet Drivers
  ('d1000000-0000-0000-0000-000000000001', 'Malam Ibrahim Musa', '+234 803 555 0101', 'DRV-CU-01', 'v1000000-0000-0000-0000-000000000001', 'active', TRUE, 'Direct smartphone app user'),
  ('d1000000-0000-0000-0000-000000000002', 'Mr. Sunday Okafor', '+234 802 555 0102', 'DRV-CU-02', 'v1000000-0000-0000-0000-000000000002', 'active', TRUE, 'Direct smartphone app user'),
  ('d1000000-0000-0000-0000-000000000003', 'Malam Usman Garba', '+234 814 555 0103', 'DRV-CU-03', 'v1000000-0000-0000-0000-000000000003', 'active', FALSE, 'Assisted Mode: Non-smartphone driver, assisted by Hostel Representative'),

  -- Boys' Fleet Drivers
  ('d1000000-0000-0000-0000-000000000004', 'Mr. Emeka Eze', '+234 805 555 0104', 'DRV-CU-04', 'v1000000-0000-0000-0000-000000000004', 'active', TRUE, 'Direct smartphone app user'),
  ('d1000000-0000-0000-0000-000000000005', 'Malam Haruna Bello', '+234 809 555 0105', 'DRV-CU-05', 'v1000000-0000-0000-0000-000000000004', 'active', FALSE, 'Assisted Mode: Non-smartphone driver, assisted by Hostel Representative'),

  -- Inter-Campus Shuttle Driver
  ('d1000000-0000-0000-0000-000000000006', 'Mr. Babatunde Adeleke', '+234 807 555 0106', 'DRV-CU-06', 'v1000000-0000-0000-0000-000000000005', 'active', TRUE, 'Direct smartphone app user')
ON CONFLICT (driver_reference) DO NOTHING;

-- ============================================================
-- 8. RECURRING WEEKDAY TIMETABLE TEMPLATES (MONDAY–FRIDAY)
-- Confirmed 4 Boys' Journey Patterns across weekdays (day_of_week 1 to 5):
-- Pattern 1: 07:30 AM (Main Boys -> Wuye Boys -> Main Campus)
-- Pattern 2: 08:30 AM Direct (Main Boys -> Main Campus, express)
-- Pattern 3: 16:00 PM Direct (Main Campus -> Main Boys, express)
-- Pattern 4: 16:50 PM planned / 17:00 PM latest (Main Campus -> Wuye Boys -> Main Boys, single trip)
-- Note: Weekends (Sunday 0, Saturday 6) are strictly excluded.
-- ============================================================

INSERT INTO public.schedules (
  id, route_id, day_of_week, departure_time, latest_departure_time, direction, proposed_allocation, is_active, notes
)
VALUES
  -- Monday (day_of_week = 1)
  ('sc000000-0000-0001-0000-000000000001', 'r1000000-0000-0000-0000-000000000002', 1, '07:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 1: Main Boys -> Wuye Boys -> Main Campus'),
  ('sc000000-0000-0002-0000-000000000001', 'r1000000-0000-0000-0000-000000000005', 1, '08:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 2: Main Boys -> Main Campus Express (no Wuye stop)'),
  ('sc000000-0000-0003-0000-000000000001', 'r1000000-0000-0000-0000-000000000006', 1, '16:00:00', NULL, 'outbound', 30, TRUE, 'Pattern 3: Main Campus -> Main Boys Express (no Wuye stop)'),
  ('sc000000-0000-0004-0000-000000000001', 'r1000000-0000-0000-0000-000000000003', 1, '16:50:00', '17:00:00', 'outbound', 30, TRUE, 'Pattern 4: Main Campus -> Wuye Boys -> Main Boys (16:50-17:00 departure window)'),

  -- Tuesday (day_of_week = 2)
  ('sc000000-0000-0001-0000-000000000002', 'r1000000-0000-0000-0000-000000000002', 2, '07:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 1: Main Boys -> Wuye Boys -> Main Campus'),
  ('sc000000-0000-0002-0000-000000000002', 'r1000000-0000-0000-0000-000000000005', 2, '08:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 2: Main Boys -> Main Campus Express (no Wuye stop)'),
  ('sc000000-0000-0003-0000-000000000002', 'r1000000-0000-0000-0000-000000000006', 2, '16:00:00', NULL, 'outbound', 30, TRUE, 'Pattern 3: Main Campus -> Main Boys Express (no Wuye stop)'),
  ('sc000000-0000-0004-0000-000000000002', 'r1000000-0000-0000-0000-000000000003', 2, '16:50:00', '17:00:00', 'outbound', 30, TRUE, 'Pattern 4: Main Campus -> Wuye Boys -> Main Boys (16:50-17:00 departure window)'),

  -- Wednesday (day_of_week = 3)
  ('sc000000-0000-0001-0000-000000000003', 'r1000000-0000-0000-0000-000000000002', 3, '07:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 1: Main Boys -> Wuye Boys -> Main Campus'),
  ('sc000000-0000-0002-0000-000000000003', 'r1000000-0000-0000-0000-000000000005', 3, '08:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 2: Main Boys -> Main Campus Express (no Wuye stop)'),
  ('sc000000-0000-0003-0000-000000000003', 'r1000000-0000-0000-0000-000000000006', 3, '16:00:00', NULL, 'outbound', 30, TRUE, 'Pattern 3: Main Campus -> Main Boys Express (no Wuye stop)'),
  ('sc000000-0000-0004-0000-000000000003', 'r1000000-0000-0000-0000-000000000003', 3, '16:50:00', '17:00:00', 'outbound', 30, TRUE, 'Pattern 4: Main Campus -> Wuye Boys -> Main Boys (16:50-17:00 departure window)'),

  -- Thursday (day_of_week = 4)
  ('sc000000-0000-0001-0000-000000000004', 'r1000000-0000-0000-0000-000000000002', 4, '07:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 1: Main Boys -> Wuye Boys -> Main Campus'),
  ('sc000000-0000-0002-0000-000000000004', 'r1000000-0000-0000-0000-000000000005', 4, '08:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 2: Main Boys -> Main Campus Express (no Wuye stop)'),
  ('sc000000-0000-0003-0000-000000000004', 'r1000000-0000-0000-0000-000000000006', 4, '16:00:00', NULL, 'outbound', 30, TRUE, 'Pattern 3: Main Campus -> Main Boys Express (no Wuye stop)'),
  ('sc000000-0000-0004-0000-000000000004', 'r1000000-0000-0000-0000-000000000003', 4, '16:50:00', '17:00:00', 'outbound', 30, TRUE, 'Pattern 4: Main Campus -> Wuye Boys -> Main Boys (16:50-17:00 departure window)'),

  -- Friday (day_of_week = 5)
  ('sc000000-0000-0001-0000-000000000005', 'r1000000-0000-0000-0000-000000000002', 5, '07:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 1: Main Boys -> Wuye Boys -> Main Campus'),
  ('sc000000-0000-0002-0000-000000000005', 'r1000000-0000-0000-0000-000000000005', 5, '08:30:00', NULL, 'inbound', 30, TRUE, 'Pattern 2: Main Boys -> Main Campus Express (no Wuye stop)'),
  ('sc000000-0000-0003-0000-000000000005', 'r1000000-0000-0000-0000-000000000006', 5, '16:00:00', NULL, 'outbound', 30, TRUE, 'Pattern 3: Main Campus -> Main Boys Express (no Wuye stop)'),
  ('sc000000-0000-0004-0000-000000000005', 'r1000000-0000-0000-0000-000000000003', 5, '16:50:00', '17:00:00', 'outbound', 30, TRUE, 'Pattern 4: Main Campus -> Wuye Boys -> Main Boys (16:50-17:00 departure window)')
ON CONFLICT (id) DO NOTHING;


