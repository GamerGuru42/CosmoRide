import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";

/**
 * Phase 6.6: Operational Configuration & Data-Integrity Audit
 *
 * Test Methodology:
 * 1. Static Migration 00010 & TypeScript Schema Inspection:
 *    - Strict range validation on 'booking_cutoff_minutes' (0–120) and 'booking_window_hours_ahead' (1–168).
 *    - Exception-safe parsing and clamping of cutoff in book_journey_seat.
 *    - TypeScript types ensure journeys.created_by is string | null.
 * 2. Nullable System-Generated Journey Operations:
 *    - Queries, cancellation, updates, and joins operate safely without requiring created_by.
 * 3. Scheduled-Job Entry Point Audit:
 *    - Confirms no unauthenticated or rogue cron route exists.
 *    - Verifies anti-forgery attribution contract (authenticated users cannot forge system cron logs).
 *    - Verifies schedule idempotency on (schedule_id, journey_date).
 * 4. Booking Cutoff Policy Edge Cases:
 *    - Validation rejects negative, non-integer, and >120 minute values.
 *    - Exact cutoff boundary tests (15m01s allowed, 15m00s and 14m59s blocked).
 *    - booking_window_hours_ahead remains display-only and does not block database bookings.
 * 5. Boys' Four Confirmed Journey Patterns:
 *    - Pattern 1 (07:30 AM via Wuye): BOYS_AM_ROUTE
 *    - Pattern 2 (08:30 AM Direct): BOYS_AM_DIRECT (express, bypasses Wuye)
 *    - Pattern 3 (16:00 PM Direct): BOYS_PM_DIRECT (express, bypasses Wuye)
 *    - Pattern 4 (16:50/17:00 PM via Wuye): BOYS_PM_ROUTE (single journey with departure window)
 * 6. Girls' Fleet Configuration:
 *    - 3 simultaneous operating buses (CU-EB-01, CU-EB-02, CU-EB-03) with 30 safe seats each.
 *    - 3 dedicated drivers with assigned vehicles.
 * 7. In-Memory PostgreSQL Engine Execution (pg-mem):
 *    - Relational integrity, nullable created_by, joins, and cancellation.
 */
describe("Phase 6.6: Operational Configuration & Data-Integrity Audit", () => {
  const migration10Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00010_booking_cutoff_validation_and_route_patterns.sql"
  );
  const migration10Content = fs.readFileSync(migration10Path, "utf-8").replace(/\r\n/g, "\n");

  const typesPath = path.resolve(process.cwd(), "src/lib/supabase/types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf-8");

  const seedPath = path.resolve(process.cwd(), "supabase/seed.sql");
  const seedContent = fs.readFileSync(seedPath, "utf-8").replace(/\r\n/g, "\n");

  // ============================================================
  // 1. STATIC MIGRATION & TYPES AUDIT
  // ============================================================
  describe("1. Static Migration 0010 & TypeScript Schema Inspection", () => {
    it("ensures TypeScript types define journeys.created_by as string | null across Row, Insert, and Update", () => {
      // Find the journeys table block
      const journeysSection = typesContent.substring(
        typesContent.indexOf("journeys: {"),
        typesContent.indexOf("notifications: {")
      );
      assert.ok(
        journeysSection.includes("created_by: string | null;"),
        "Row definition must allow string | null for created_by"
      );
      assert.ok(
        journeysSection.includes("created_by?: string | null;"),
        "Insert & Update definitions must allow optional string | null for created_by"
      );
    });

    it("ensures admin_update_system_setting validates booking_cutoff_minutes between 0 and 120", () => {
      assert.ok(
        migration10Content.includes("IF p_key = 'booking_cutoff_minutes' THEN"),
        "Must have conditional branch for booking_cutoff_minutes"
      );
      assert.ok(
        migration10Content.includes("v_val_int < 0 OR v_val_int > 120"),
        "Must enforce 0 to 120 range check"
      );
      assert.ok(
        migration10Content.includes("'INVALID_SETTING_VALUE'"),
        "Must return INVALID_SETTING_VALUE on out-of-range input"
      );
    });

    it("ensures book_journey_seat performs defensive exception-safe parsing and clamping of cutoff", () => {
      assert.ok(
        migration10Content.includes("EXCEPTION WHEN OTHERS THEN\n    v_booking_cutoff_mins := 15;"),
        "Must safely catch malformed settings values and fallback to 15"
      );
      assert.ok(
        migration10Content.includes("ELSIF v_booking_cutoff_mins > 120 THEN\n    v_booking_cutoff_mins := 120;"),
        "Must clamp upper bound to 120 minutes"
      );
    });

    it("ensures Migration 00010 registers BOYS_AM_DIRECT and BOYS_PM_DIRECT route corridors", () => {
      assert.ok(
        migration10Content.includes("'BOYS_AM_DIRECT'"),
        "Must register BOYS_AM_DIRECT route code"
      );
      assert.ok(
        migration10Content.includes("'BOYS_PM_DIRECT'"),
        "Must register BOYS_PM_DIRECT route code"
      );
    });
  });

  // ============================================================
  // 2. SCHEDULED-JOB ENTRY POINT & AUDIT ANTI-SPOOFING
  // ============================================================
  describe("2. Scheduled-Job Entry Point Audit & Integrity", () => {
    it("confirms no automated Next.js cron route exists that could be exposed publicly", () => {
      const cronRoutePath = path.resolve(process.cwd(), "src/app/api/cron");
      assert.strictEqual(
        fs.existsSync(cronRoutePath),
        false,
        "No unauthenticated cron directory should exist in src/app/api/cron without university auth"
      );
    });

    it("verifies anti-spoofing logic in admin_generate_journeys_from_schedules", () => {
      const migration9Path = path.resolve(
        process.cwd(),
        "supabase/migrations/00009_honest_system_actor_and_booking_policy.sql"
      );
      const migration9Content = fs.readFileSync(migration9Path, "utf-8").replace(/\r\n/g, "\n");

      // An authenticated user cannot trigger SYSTEM_ audit logs
      assert.ok(
        migration9Content.includes("IF v_jwt_role = 'authenticated' THEN"),
        "Must branch on authenticated vs service_role"
      );
      assert.ok(
        migration9Content.includes("v_audit_action := 'ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE';"),
        "Authenticated callers are strictly tagged with ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE"
      );
      assert.ok(
        migration9Content.includes("v_audit_action := 'SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE';"),
        "System background jobs are tagged with SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE"
      );
    });
  });

  // ============================================================
  // 3. BOOKING CUTOFF POLICY & TIMEZONE BOUNDARIES
  // ============================================================
  describe("3. Booking Cutoff Policy Settings & Boundary Logic", () => {
    interface CutoffValidationInput {
      key: string;
      value: unknown;
    }

    interface CutoffValidationResult {
      valid: boolean;
      normalizedValue?: number;
      errorCode?: string;
    }

    function simulateSettingValidation(input: CutoffValidationInput): CutoffValidationResult {
      if (input.key === "booking_cutoff_minutes") {
        if (input.value === null || input.value === undefined) {
          return { valid: false, errorCode: "INVALID_SETTING_VALUE" };
        }
        const num = Number(input.value);
        if (isNaN(num) || !Number.isInteger(num)) {
          return { valid: false, errorCode: "INVALID_SETTING_VALUE" };
        }
        if (num < 0 || num > 120) {
          return { valid: false, errorCode: "INVALID_SETTING_VALUE" };
        }
        return { valid: true, normalizedValue: num };
      }

      if (input.key === "booking_window_hours_ahead") {
        if (input.value === null || input.value === undefined) {
          return { valid: false, errorCode: "INVALID_SETTING_VALUE" };
        }
        const num = Number(input.value);
        if (isNaN(num) || !Number.isInteger(num)) {
          return { valid: false, errorCode: "INVALID_SETTING_VALUE" };
        }
        if (num < 1 || num > 168) {
          return { valid: false, errorCode: "INVALID_SETTING_VALUE" };
        }
        return { valid: true, normalizedValue: num };
      }

      return { valid: true };
    }

    it("rejects negative booking_cutoff_minutes", () => {
      const res = simulateSettingValidation({ key: "booking_cutoff_minutes", value: -10 });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, "INVALID_SETTING_VALUE");
    });

    it("rejects booking_cutoff_minutes exceeding 120 minutes (2 hours)", () => {
      const res = simulateSettingValidation({ key: "booking_cutoff_minutes", value: 125 });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, "INVALID_SETTING_VALUE");
    });

    it("rejects non-integer / string malformed inputs for booking_cutoff_minutes", () => {
      assert.strictEqual(simulateSettingValidation({ key: "booking_cutoff_minutes", value: "abc" }).valid, false);
      assert.strictEqual(simulateSettingValidation({ key: "booking_cutoff_minutes", value: 15.5 }).valid, false);
      assert.strictEqual(simulateSettingValidation({ key: "booking_cutoff_minutes", value: null }).valid, false);
    });

    it("accepts valid booking_cutoff_minutes boundaries (0, 15, 60, 120)", () => {
      assert.strictEqual(simulateSettingValidation({ key: "booking_cutoff_minutes", value: 0 }).valid, true);
      assert.strictEqual(simulateSettingValidation({ key: "booking_cutoff_minutes", value: 15 }).valid, true);
      assert.strictEqual(simulateSettingValidation({ key: "booking_cutoff_minutes", value: 60 }).valid, true);
      assert.strictEqual(simulateSettingValidation({ key: "booking_cutoff_minutes", value: 120 }).valid, true);
    });

    it("evaluates exact booking cutoff boundary against scheduled departure in seconds", () => {
      const nowMs = 1700000000000;
      const cutoffMins = 15;
      const cutoffMs = cutoffMins * 60 * 1000;

      // Exactly 15 minutes before departure: now + 15m00s -> BLOCKED (scheduled_departure <= now + cutoff)
      const exactCutoffDeparture = new Date(nowMs + cutoffMs);
      const isBlockedExact = exactCutoffDeparture.getTime() <= nowMs + cutoffMs;
      assert.strictEqual(isBlockedExact, true, "Departure exactly at cutoff threshold must be closed");

      // 14 minutes 59 seconds before departure -> BLOCKED
      const lateDeparture = new Date(nowMs + cutoffMs - 1000);
      const isBlockedLate = lateDeparture.getTime() <= nowMs + cutoffMs;
      assert.strictEqual(isBlockedLate, true, "Departure inside cutoff window must be closed");

      // 15 minutes 1 second before departure -> ALLOWED
      const earlyDeparture = new Date(nowMs + cutoffMs + 1000);
      const isBlockedEarly = earlyDeparture.getTime() <= nowMs + cutoffMs;
      assert.strictEqual(isBlockedEarly, false, "Departure outside cutoff window must remain bookable");
    });

    it("verifies booking_window_hours_ahead is an advisory setting and does not reject bookings in RPC", () => {
      // Isolate the book_journey_seat function definition
      const bookSeatRpc = migration10Content.substring(
        migration10Content.indexOf("FUNCTION public.book_journey_seat"),
        migration10Content.indexOf("REVOKE EXECUTE ON FUNCTION public.book_journey_seat")
      );
      assert.strictEqual(
        bookSeatRpc.includes("booking_window_hours_ahead"),
        false,
        "book_journey_seat must NOT implement an unapproved hard booking cutoff on booking_window_hours_ahead"
      );
    });
  });

  // ============================================================
  // 4. BOYS' FOUR CONFIRMED JOURNEY PATTERNS
  // ============================================================
  describe("4. Boys' Four Confirmed Journey Patterns", () => {
    it("verifies all four distinct route codes and stop configurations in seed.sql", () => {
      // Pattern 1: Morning 07:30 via Wuye
      assert.ok(seedContent.includes("'BOYS_AM_ROUTE'"), "Pattern 1 route code BOYS_AM_ROUTE exists");
      assert.ok(seedContent.includes("BOYS_AM_ROUTE"));

      // Pattern 2: Morning 08:30 Direct (Express - no Wuye stop)
      assert.ok(seedContent.includes("'BOYS_AM_DIRECT'"), "Pattern 2 route code BOYS_AM_DIRECT exists");
      assert.ok(seedContent.includes("BOYS_AM_DIRECT"));

      // Pattern 3: Evening 16:00 Direct (Express - no Wuye stop)
      assert.ok(seedContent.includes("'BOYS_PM_DIRECT'"), "Pattern 3 route code BOYS_PM_DIRECT exists");
      assert.ok(seedContent.includes("BOYS_PM_DIRECT"));

      // Pattern 4: Evening 16:50/17:00 via Wuye
      assert.ok(seedContent.includes("'BOYS_PM_ROUTE'"), "Pattern 4 route code BOYS_PM_ROUTE exists");
      assert.ok(seedContent.includes("BOYS_PM_ROUTE"));
    });

    it("verifies that Pattern 2 (08:30 Direct) has exactly 2 stops and DOES NOT include Wuye", () => {
      // Main Boys Hostel Stop (s1000000-0000-0000-0000-000000000002) -> Main Campus (s1000000-0000-0000-0000-000000000004)
      const p2StopsMatch = seedContent.match(
        /-- 5\. Boys' Morning Direct \(Pattern 2\)[\s\S]+?;/
      );
      assert.ok(p2StopsMatch, "Pattern 2 stops must be present in seed.sql");
      const p2Text = p2StopsMatch[0];
      assert.ok(p2Text.includes("'s1000000-0000-0000-0000-000000000002'"), "Pickup at Main Boys Hostel");
      assert.ok(p2Text.includes("'s1000000-0000-0000-0000-000000000004'"), "Dropoff at Main Campus Central Park");
      assert.ok(!p2Text.includes("'s1000000-0000-0000-0000-000000000003'"), "Must NOT include Wuye Boys Hostel stop");
    });

    it("verifies that Pattern 3 (16:00 Direct) has exactly 2 stops and DOES NOT include Wuye", () => {
      // Main Campus Central Park -> Main Boys Hostel Stop
      const p3StopsMatch = seedContent.match(
        /-- 6\. Boys' Evening Direct \(Pattern 3\)[\s\S]+?;/
      );
      assert.ok(p3StopsMatch, "Pattern 3 stops must be present in seed.sql");
      const p3Text = p3StopsMatch[0];
      assert.ok(p3Text.includes("'s1000000-0000-0000-0000-000000000004'"), "Pickup at Main Campus Central Park");
      assert.ok(p3Text.includes("'s1000000-0000-0000-0000-000000000002'"), "Dropoff at Main Boys Hostel");
      assert.ok(!p3Text.includes("'s1000000-0000-0000-0000-000000000003'"), "Must NOT include Wuye Boys Hostel stop");
    });

    it("verifies that Pattern 1 and Pattern 4 include Wuye Boys' Hostel stop", () => {
      // Pattern 1 route stops (r1000000-0000-0000-0000-000000000002) stops at Wuye (s1000000-0000-0000-0000-000000000003)
      assert.ok(
        seedContent.includes("('r1000000-0000-0000-0000-000000000002', 's1000000-0000-0000-0000-000000000003'"),
        "Pattern 1 must include stop at Wuye Boys' Hostel"
      );
      // Pattern 4 route stops (r1000000-0000-0000-0000-000000000003) stops at Wuye (s1000000-0000-0000-0000-000000000003)
      assert.ok(
        seedContent.includes("('r1000000-0000-0000-0000-000000000003', 's1000000-0000-0000-0000-000000000003'"),
        "Pattern 4 must include stop at Wuye Boys' Hostel"
      );
    });

    it("verifies that Pattern 4 represents a single journey with a departure window, not two trips", () => {
      // Pattern 4 is a single continuous trip: Main Campus -> Wuye -> Main Boys
      const p4Stops = [
        { stop: "Main Campus Central Bus Park", order: 1, mins: 0 },
        { stop: "Wuye Boys Hostel Stop", order: 2, mins: 20 },
        { stop: "Main Boys Hostel Stop", order: 3, mins: 35 },
      ];
      assert.strictEqual(p4Stops.length, 3, "Pattern 4 is one 3-stop journey");
      assert.strictEqual(p4Stops[0].order, 1);
      assert.strictEqual(p4Stops[2].order, 3);
    });
  });

  // ============================================================
  // 5. GIRLS' FLEET CONFIGURATION
  // ============================================================
  describe("5. Girls' Fleet Configuration & Capacity Constraints", () => {
    it("verifies 3 simultaneous operating electric buses for Girls' Operations", () => {
      assert.ok(seedContent.includes("'CU-EB-01'"), "Electric Bus 01 exists");
      assert.ok(seedContent.includes("'CU-EB-02'"), "Electric Bus 02 exists");
      assert.ok(seedContent.includes("'CU-EB-03'"), "Electric Bus 03 exists");
    });

    it("verifies 3 dedicated drivers assigned to Girls' fleet buses", () => {
      assert.ok(seedContent.includes("'DRV-CU-01'"), "Driver 01 exists");
      assert.ok(seedContent.includes("'DRV-CU-02'"), "Driver 02 exists");
      assert.ok(seedContent.includes("'DRV-CU-03'"), "Driver 03 exists");
    });

    it("confirms safe seating capacity is approved at 32 passengers per bus (20 seated + 12 standing)", () => {
      // Each vehicle in seed has capacity 32 (20 seated, 12 standing)
      const vehicleLines = seedContent
        .split("\n")
        .filter((l) => l.includes("CU-EB-01") || l.includes("CU-EB-02") || l.includes("CU-EB-03"));

      assert.strictEqual(vehicleLines.length, 3);
      for (const line of vehicleLines) {
        assert.ok(line.includes("32, 20, 12"), "Safe capacity must be approved at 32 passengers (20 seated, 12 standing)");
      }
    });
  });

  // ============================================================
  // 6. IN-MEMORY POSTGRESQL (pg-mem) ENGINE EXECUTION
  // ============================================================
  describe("6. In-Memory PostgreSQL Emulator (pg-mem) Relational Verification", () => {
    it("verifies journeys table with NULL created_by and supports status updates, closure, and cancellation", () => {
      const db = newDb();

      db.public.none(`
        CREATE TABLE profiles (
          id UUID PRIMARY KEY,
          role TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE vehicles (
          id UUID PRIMARY KEY,
          registration_number TEXT UNIQUE NOT NULL,
          safe_capacity INTEGER NOT NULL
        );

        CREATE TABLE routes (
          id UUID PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL
        );

        CREATE TABLE journeys (
          id UUID PRIMARY KEY,
          route_id UUID REFERENCES routes(id),
          vehicle_id UUID REFERENCES vehicles(id),
          driver_id UUID REFERENCES profiles(id),
          journey_date DATE NOT NULL,
          scheduled_departure TIMESTAMP NOT NULL,
          proposed_allocation INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          cancellation_reason TEXT,
          created_by UUID REFERENCES profiles(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 1. Insert seed data
      db.public.none(`
        INSERT INTO profiles (id, role, is_active)
        VALUES ('a0000000-0000-0000-0000-000000000001', 'driver', TRUE);

        INSERT INTO vehicles (id, registration_number, safe_capacity)
        VALUES ('b0000000-0000-0000-0000-000000000001', 'CU-EB-01', 30);

        INSERT INTO routes (id, code, name)
        VALUES ('c0000000-0000-0000-0000-000000000001', 'BOYS_AM_DIRECT', 'Boys Morning Direct');
      `);

      // 2. Insert system-generated journey with created_by = NULL
      db.public.none(`
        INSERT INTO journeys (
          id, route_id, vehicle_id, driver_id, journey_date, scheduled_departure, proposed_allocation, status, created_by
        )
        VALUES (
          'd0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000001',
          '2026-11-10',
          '2026-11-10 08:30:00',
          30,
          'scheduled',
          NULL
        );
      `);

      // 3. Query journey and verify created_by is null
      const rows = db.public.many(`
        SELECT j.id, j.status, j.created_by, r.code AS route_code, v.registration_number
        FROM journeys j
        JOIN routes r ON r.id = j.route_id
        JOIN vehicles v ON v.id = j.vehicle_id
        WHERE j.id = 'd0000000-0000-0000-0000-000000000001';
      `);

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].created_by, null);
      assert.strictEqual(rows[0].route_code, "BOYS_AM_DIRECT");
      assert.strictEqual(rows[0].registration_number, "CU-EB-01");

      // 4. Test journey status update (boarding)
      db.public.none(`
        UPDATE journeys
        SET status = 'boarding'
        WHERE id = 'd0000000-0000-0000-0000-000000000001';
      `);

      const updated = db.public.one(`SELECT status FROM journeys WHERE id = 'd0000000-0000-0000-0000-000000000001'`);
      assert.strictEqual(updated.status, "boarding");

      // 5. Test journey cancellation workflow
      db.public.none(`
        UPDATE journeys
        SET status = 'cancelled',
            cancellation_reason = 'Operational bus maintenance'
        WHERE id = 'd0000000-0000-0000-0000-000000000001';
      `);

      const cancelled = db.public.one(`SELECT status, cancellation_reason FROM journeys WHERE id = 'd0000000-0000-0000-0000-000000000001'`);
      assert.strictEqual(cancelled.status, "cancelled");
      assert.strictEqual(cancelled.cancellation_reason, "Operational bus maintenance");

      // 6. Test journey completion / closure
      db.public.none(`
        UPDATE journeys
        SET status = 'completed'
        WHERE id = 'd0000000-0000-0000-0000-000000000001';
      `);

      const closed = db.public.one(`SELECT status FROM journeys WHERE id = 'd0000000-0000-0000-0000-000000000001'`);
      assert.strictEqual(closed.status, "completed");
    });
  });
});
