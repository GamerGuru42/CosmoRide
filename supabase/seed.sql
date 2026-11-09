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

-- ============================================================
-- 6. APPROVED FLEET VEHICLES
-- Operating Rule: 3 buses operating simultaneously for Girls' operations,
-- each with safe passenger capacity (approved 30 seats).
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

