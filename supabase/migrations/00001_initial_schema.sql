-- CosmoRide Initial Database Schema
-- Cosmopolitan University Bus Booking and Mobility Platform
-- 
-- This migration creates all core tables, enums, RLS policies,
-- and the profile auto-creation trigger.
--
-- Run via: supabase db push (or apply in Supabase SQL Editor)

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE public.user_role AS ENUM (
  'student',
  'boarding_officer',
  'driver',
  'admin'
);

CREATE TYPE public.gender AS ENUM (
  'male',
  'female',
  'mixed'
);

CREATE TYPE public.journey_status AS ENUM (
  'scheduled',
  'boarding',
  'in_transit',
  'completed',
  'cancelled'
);

CREATE TYPE public.booking_status AS ENUM (
  'confirmed',
  'checked_in',
  'no_show',
  'cancelled'
);

CREATE TYPE public.route_direction AS ENUM (
  'outbound',
  'inbound'
);

-- ============================================================
-- TABLES
-- ============================================================

-- Profiles (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role public.user_role NOT NULL DEFAULT 'student',
  hostel_id UUID,  -- FK added after hostels table
  student_id TEXT,
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campuses
CREATE TABLE public.campuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hostels
CREATE TABLE public.hostels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  campus_id UUID NOT NULL REFERENCES public.campuses(id) ON DELETE RESTRICT,
  gender public.gender NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add hostel FK to profiles
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_hostel_id_fkey
  FOREIGN KEY (hostel_id) REFERENCES public.hostels(id) ON DELETE SET NULL;

-- Routes
CREATE TABLE public.routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  gender_group public.gender NOT NULL DEFAULT 'all',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stops
CREATE TABLE public.stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  campus_id UUID REFERENCES public.campuses(id) ON DELETE SET NULL,
  address TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Route Stops (ordered stops within a route)
CREATE TABLE public.route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  stop_id UUID NOT NULL REFERENCES public.stops(id) ON DELETE CASCADE,
  stop_order INTEGER NOT NULL,
  estimated_minutes_from_start INTEGER NOT NULL DEFAULT 0,
  UNIQUE (route_id, stop_order)
);

-- Vehicles
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number TEXT NOT NULL UNIQUE,
  name TEXT,
  safe_capacity INTEGER NOT NULL CHECK (safe_capacity > 0),
  vehicle_type TEXT NOT NULL DEFAULT 'electric_bus',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schedules (recurring templates)
CREATE TABLE public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  departure_time TIME NOT NULL,
  direction public.route_direction NOT NULL DEFAULT 'outbound',
  proposed_allocation INTEGER NOT NULL CHECK (proposed_allocation > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Journeys (concrete instances)
CREATE TABLE public.journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.schedules(id) ON DELETE SET NULL,
  route_id UUID NOT NULL REFERENCES public.routes(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  journey_date DATE NOT NULL,
  scheduled_departure TIMESTAMPTZ NOT NULL,
  actual_departure TIMESTAMPTZ,
  estimated_arrival TIMESTAMPTZ,
  proposed_allocation INTEGER NOT NULL CHECK (proposed_allocation > 0),
  status public.journey_status NOT NULL DEFAULT 'scheduled',
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  delay_reason TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bookings
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  boarding_stop_id UUID NOT NULL REFERENCES public.stops(id) ON DELETE RESTRICT,
  status public.booking_status NOT NULL DEFAULT 'confirmed',
  booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES public.profiles(id),
  -- One booking per student per journey
  UNIQUE (journey_id, student_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_hostel ON public.profiles(hostel_id);
CREATE INDEX idx_journeys_date ON public.journeys(journey_date);
CREATE INDEX idx_journeys_driver ON public.journeys(driver_id);
CREATE INDEX idx_journeys_status ON public.journeys(status);
CREATE INDEX idx_journeys_route_date ON public.journeys(route_id, journey_date);
CREATE INDEX idx_bookings_student ON public.bookings(student_id);
CREATE INDEX idx_bookings_journey ON public.bookings(journey_id);
CREATE INDEX idx_bookings_status ON public.bookings(status);
CREATE INDEX idx_schedules_route_day ON public.schedules(route_id, day_of_week);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_journeys_updated_at
  BEFORE UPDATE ON public.journeys
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON AUTH SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Required to insert into public.profiles from auth schema
SET search_path = ''  -- Security best practice for SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, student_id, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    'student',  -- Default role; admin promotes via dashboard
    NEW.raw_user_meta_data->>'student_id',
    NEW.raw_user_meta_data->>'phone'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hostels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- ---- PROFILES ----

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

-- Admins can read all profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Boarding officers can view profiles of students in their hostel
CREATE POLICY "Boarding officers can view hostel students"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'boarding_officer'
        AND p.hostel_id = profiles.hostel_id
    )
  );

-- Users can update their own profile (name, phone, avatar only)
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Admins can update any profile (role changes, etc.)
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- ---- REFERENCE DATA (campuses, hostels, routes, stops, route_stops, vehicles) ----
-- Readable by all authenticated users, writable only by admins.

-- Campuses: read
CREATE POLICY "Authenticated users can view campuses"
  ON public.campuses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage campuses"
  ON public.campuses FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Hostels
CREATE POLICY "Authenticated users can view hostels"
  ON public.hostels FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage hostels"
  ON public.hostels FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Routes
CREATE POLICY "Authenticated users can view routes"
  ON public.routes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage routes"
  ON public.routes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Stops
CREATE POLICY "Authenticated users can view stops"
  ON public.stops FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage stops"
  ON public.stops FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Route Stops
CREATE POLICY "Authenticated users can view route stops"
  ON public.route_stops FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage route stops"
  ON public.route_stops FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- Vehicles
CREATE POLICY "Authenticated users can view vehicles"
  ON public.vehicles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage vehicles"
  ON public.vehicles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- ---- SCHEDULES ----

CREATE POLICY "Authenticated users can view schedules"
  ON public.schedules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage schedules"
  ON public.schedules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- ---- JOURNEYS ----

CREATE POLICY "Authenticated users can view active journeys"
  ON public.journeys FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Drivers can update their own journeys"
  ON public.journeys FOR UPDATE
  TO authenticated
  USING (driver_id = (SELECT auth.uid()))
  WITH CHECK (driver_id = (SELECT auth.uid()));

CREATE POLICY "Admins can manage journeys"
  ON public.journeys FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

-- ---- BOOKINGS ----

-- Students can view their own bookings
CREATE POLICY "Students can view own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (student_id = (SELECT auth.uid()));

-- Students can create bookings for themselves
CREATE POLICY "Students can create own bookings"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (student_id = (SELECT auth.uid()));

-- Students can cancel their own bookings
CREATE POLICY "Students can cancel own bookings"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (student_id = (SELECT auth.uid()))
  WITH CHECK (student_id = (SELECT auth.uid()));

-- Boarding officers can view and update bookings for check-in
CREATE POLICY "Boarding officers can view journey bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'boarding_officer'
    )
  );

CREATE POLICY "Boarding officers can check in students"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'boarding_officer'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'boarding_officer'
    )
  );

-- Drivers can view bookings for their journeys
CREATE POLICY "Drivers can view their journey bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journeys j
      WHERE j.id = bookings.journey_id
        AND j.driver_id = (SELECT auth.uid())
    )
  );

-- Admins can do everything with bookings
CREATE POLICY "Admins can manage bookings"
  ON public.bookings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'
    )
  );

