-- ============================================================
-- COSMORIDE DATABASE MIGRATION 00013
-- REFERENCE DATA ACCURACY CORRECTION:
-- 1. Correct Wuye Boys' Hostel location classification (off-campus / standalone)
-- 2. Correct unverified route stop arrival-time offsets
-- ============================================================

-- ------------------------------------------------------------
-- 1. HOSTELS: ALLOW NULL CAMPUS_ID & CLASSIFY WUYE AS OFF-CAMPUS
-- ------------------------------------------------------------
-- Migration 00001 created public.hostels with campus_id NOT NULL REFERENCES campuses(id).
-- Wuye Boys' Hostel is an off-campus hostel located in Wuye District, Abuja,
-- not physically located on Main Campus. Linking it to Main Campus was an artifact
-- of the NOT NULL foreign key constraint.
-- We drop the NOT NULL constraint to semantically accommodate off-campus hostels
-- and disassociate Wuye Boys' Hostel from Main Campus (setting campus_id to NULL).

ALTER TABLE public.hostels
  ALTER COLUMN campus_id DROP NOT NULL;

UPDATE public.hostels
SET campus_id = NULL
WHERE name = 'Wuye Boys'' Hostel';

-- ------------------------------------------------------------
-- 2. ROUTE STOPS: DROP NOT NULL & CLEAR UNVERIFIED ARRIVAL OFFSETS
-- ------------------------------------------------------------
-- Migration 00001 created route_stops with estimated_minutes_from_start INTEGER NOT NULL DEFAULT 0.
-- Migration 00012 inserted speculative offsets (+15, +20, +25, +35 min).
-- Actual travel times across Abuja corridors have not been operationally benchmarked.
-- Presenting these as confirmed ETAs to students is misleading.
-- We drop NOT NULL and set unverified offsets to NULL, representing that
-- corridor travel durations are unconfirmed until operational data is collected.

ALTER TABLE public.route_stops
  ALTER COLUMN estimated_minutes_from_start DROP NOT NULL,
  ALTER COLUMN estimated_minutes_from_start SET DEFAULT NULL;

UPDATE public.route_stops
SET estimated_minutes_from_start = NULL;
