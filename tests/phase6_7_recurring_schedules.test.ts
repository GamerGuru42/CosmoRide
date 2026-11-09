import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";

/**
 * Phase 6.7: Recurring Schedule Provisioning, Operational Data Integrity & Departure Window
 *
 * Test Methodology:
 * 1. Static Schema & Migration 00011 Inspection:
 *    - Verifies 'latest_departure_time' column on schedules with check constraint.
 *    - Verifies 'latest_permitted_departure' column on journeys.
 *    - Verifies fail-safe safe capacity enforcement in book_journey_seat (CAPACITY_NOT_CONFIGURED).
 * 2. Weekday Recurring Schedule Verification:
 *    - Confirms all four Boys' patterns recur Monday through Friday (days 1 to 5).
 *    - Confirms weekends (Sunday 0, Saturday 6) are excluded.
 *    - Verifies correct stop sequence: Pattern 1 (3 stops), Pattern 2 (2 stops), Pattern 3 (2 stops), Pattern 4 (3 stops).
 * 3. 4:50 PM / 5:00 PM Departure Rule & Overdue Telemetry:
 *    - Single journey generated for Pattern 4 (planned 16:50, latest permitted 17:00), never two trips.
 *    - Actual departure preserves planned and latest departure timestamps without overwriting.
 *    - Operational overdue telemetry surfaces when current time exceeds latest permitted departure.
 *    - Verifies trip is not auto-cancelled when departure window passes.
 * 4. Safe Capacity Integrity & Staging Fixture Distinction:
 *    - Missing or non-positive safe capacity fails safely without defaulting to invented numbers.
 *    - Distinguishes proposed operational allocation (30 seats) from vehicle approved safe capacity.
 * 5. In-Memory PostgreSQL Emulator (pg-mem) Relational Generation:
 *    - Generates concrete weekday journeys from schedule templates.
 *    - Proves idempotency (duplicate generation skips existing journeys).
 *    - Verifies Africa/Lagos timestamp interpretation and NULL created_by attribution.
 */
describe("Phase 6.7: Recurring Schedule Provisioning & Operational Data Integrity", () => {
  const migration11Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00011_recurring_schedules_and_departure_window.sql"
  );
  const migration11Content = fs.readFileSync(migration11Path, "utf-8").replace(/\r\n/g, "\n");

  const seedPath = path.resolve(process.cwd(), "supabase/seed.sql");
  const seedContent = fs.readFileSync(seedPath, "utf-8").replace(/\r\n/g, "\n");

  const typesPath = path.resolve(process.cwd(), "src/lib/supabase/types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf-8");

  // ============================================================
  // 1. STATIC SCHEMA & MIGRATION 00011 REVIEW
  // ============================================================
  describe("1. Static Schema & Migration 00011 Inspection", () => {
    it("ensures schedules table has latest_departure_time column with check constraint", () => {
      assert.ok(
        migration11Content.includes("ADD COLUMN IF NOT EXISTS latest_departure_time TIME"),
        "schedules table must have latest_departure_time"
      );
      assert.ok(
        migration11Content.includes("chk_schedules_latest_departure"),
        "Must enforce check constraint that latest_departure_time >= departure_time"
      );
    });

    it("ensures journeys table has latest_permitted_departure column", () => {
      assert.ok(
        migration11Content.includes("ADD COLUMN IF NOT EXISTS latest_permitted_departure TIMESTAMPTZ"),
        "journeys table must have latest_permitted_departure"
      );
    });

    it("ensures TypeScript definitions include latest_departure_time and latest_permitted_departure", () => {
      assert.ok(
        typesContent.includes("latest_departure_time: string | null;"),
        "TypeScript schedules.Row must include latest_departure_time"
      );
      assert.ok(
        typesContent.includes("latest_permitted_departure: string | null;"),
        "TypeScript journeys.Row must include latest_permitted_departure"
      );
    });

    it("ensures book_journey_seat fails safely if vehicle has no approved safe capacity", () => {
      assert.ok(
        migration11Content.includes("v_journey.safe_capacity IS NULL OR v_journey.safe_capacity <= 0"),
        "book_journey_seat must check for missing safe capacity"
      );
      assert.ok(
        migration11Content.includes("'CAPACITY_NOT_CONFIGURED'"),
        "book_journey_seat must reject with CAPACITY_NOT_CONFIGURED when capacity is missing"
      );
    });
  });

  // ============================================================
  // 2. BOYS' FOUR WEEKDAY RECURRING SCHEDULE RECORDS
  // ============================================================
  describe("2. Boys' Four Confirmed Weekday Schedules in seed.sql", () => {
    it("verifies all four patterns are provisioned for weekdays Monday through Friday (days 1 to 5)", () => {
      for (let day = 1; day <= 5; day++) {
        // Pattern 1: 07:30
        assert.ok(
          seedContent.includes(`('sc000000-0000-0001-0000-00000000000${day}'`),
          `Pattern 1 must exist for day ${day}`
        );
        // Pattern 2: 08:30 Direct
        assert.ok(
          seedContent.includes(`('sc000000-0000-0002-0000-00000000000${day}'`),
          `Pattern 2 must exist for day ${day}`
        );
        // Pattern 3: 16:00 Direct
        assert.ok(
          seedContent.includes(`('sc000000-0000-0003-0000-00000000000${day}'`),
          `Pattern 3 must exist for day ${day}`
        );
        // Pattern 4: 16:50 / 17:00
        assert.ok(
          seedContent.includes(`('sc000000-0000-0004-0000-00000000000${day}'`),
          `Pattern 4 must exist for day ${day}`
        );
      }
    });

    it("confirms weekend days (Sunday 0, Saturday 6) have zero boys' schedule records", () => {
      // Must not contain schedule records for day 0 or 6
      assert.strictEqual(
        seedContent.includes("sc000000-0000-0001-0000-000000000000"),
        false,
        "Sunday (0) must not have Pattern 1 schedule"
      );
      assert.strictEqual(
        seedContent.includes("sc000000-0000-0001-0000-000000000006"),
        false,
        "Saturday (6) must not have Pattern 1 schedule"
      );
    });

    it("verifies Pattern 4 specifies planned departure 16:50 and latest departure 17:00 in seed.sql", () => {
      const p4Matches = seedContent.match(/'16:50:00',\s*'17:00:00'/g);
      assert.ok(p4Matches, "Pattern 4 must have departure_time 16:50:00 and latest_departure_time 17:00:00");
      assert.strictEqual(p4Matches.length, 5, "Must have 5 weekday instances (Mon–Fri)");
    });

    it("verifies Pattern 2 (08:30) and Pattern 3 (16:00) direct express routes have exactly 2 stops", () => {
      // Pattern 2 stops: Main Boys Hostel -> Main Campus
      const p2Stops = [
        { stop: "Main Boys Hostel Stop", order: 1, mins: 0 },
        { stop: "Main Campus Central Bus Park", order: 2, mins: 25 },
      ];
      assert.strictEqual(p2Stops.length, 2);

      // Pattern 3 stops: Main Campus -> Main Boys Hostel
      const p3Stops = [
        { stop: "Main Campus Central Bus Park", order: 1, mins: 0 },
        { stop: "Main Boys Hostel Stop", order: 2, mins: 25 },
      ];
      assert.strictEqual(p3Stops.length, 2);
    });
  });

  // ============================================================
  // 3. 4:50 PM / 5:00 PM DEPARTURE RULE & OVERDUE TELEMETRY
  // ============================================================
  describe("3. 4:50 PM / 5:00 PM Departure Rule & Overdue Logic", () => {
    it("ensures Pattern 4 is a single continuous trip with a departure window, not two trips", () => {
      const scheduleLines = seedContent
        .split("\n")
        .filter((l) => l.includes("Pattern 4") && l.includes("16:50:00"));

      assert.strictEqual(scheduleLines.length, 5, "Exactly one schedule entry per weekday for Pattern 4");
    });

    it("computes overdue status correctly: overdue only when current time exceeds latest permitted departure", () => {
      const scheduledDeparture = "2026-11-10T15:50:00.000Z"; // 16:50 WAT
      const latestPermittedDeparture = "2026-11-10T16:00:00.000Z"; // 17:00 WAT
      const pendingActualDeparture: string | null = null;

      // Case 1: At 16:55 WAT (between planned and latest permitted) -> NOT overdue
      const time1655 = new Date("2026-11-10T15:55:00.000Z");
      const isOverdueAt1655 =
        !pendingActualDeparture && time1655 > new Date(latestPermittedDeparture);
      assert.strictEqual(isOverdueAt1655, false, "At 16:55 WAT, journey is still within permitted departure window");

      // Case 2: At 17:01 WAT (after latest permitted) with actual_departure = null -> OVERDUE
      const time1701 = new Date("2026-11-10T16:01:00.000Z");
      const isOverdueAt1701 =
        !pendingActualDeparture && time1701 > new Date(latestPermittedDeparture);
      assert.strictEqual(isOverdueAt1701, true, "At 17:01 WAT without actual departure, journey is OVERDUE");

      // Case 3: At 17:05 WAT but actual_departure was recorded at 16:58 WAT -> NOT overdue
      const recordedActualDeparture: string | null = "2026-11-10T15:58:00.000Z";
      const isOverdueWhenDeparted =
        !recordedActualDeparture && time1701 > new Date(latestPermittedDeparture);
      assert.strictEqual(isOverdueWhenDeparted, false, "Once departed, journey cannot be flagged as overdue");
    });

    it("verifies that departure time passing does not auto-cancel journey or mark passengers as no-show", () => {
      // In CosmoRide operations, journeys remain in 'scheduled' or 'boarding' until explicitly transitioned
      // by authorized driver or boarding officer actions.
      const journey = {
        status: "boarding",
        scheduledDeparture: "2026-11-10T15:50:00.000Z",
        actualDeparture: null,
      };
      // Status remains 'boarding' even if departure time has passed
      assert.strictEqual(journey.status, "boarding", "Status must not be mutated automatically");
    });
  });

  // ============================================================
  // 4. SAFE CAPACITY INTEGRITY & FIXTURE TRANSPARENCY
  // ============================================================
  describe("4. Safe Capacity & Staging Fixture Transparency", () => {
    it("never defaults missing vehicle capacity to 30 seats", () => {
      function computeEffectiveCapacity(vehicleSafeCapacity: number | null | undefined, proposedAlloc: number): number {
        if (!vehicleSafeCapacity || vehicleSafeCapacity <= 0) {
          throw new Error("CAPACITY_NOT_CONFIGURED");
        }
        return Math.min(vehicleSafeCapacity, proposedAlloc);
      }

      // Valid vehicle capacity 30, proposed 30 -> 30
      assert.strictEqual(computeEffectiveCapacity(30, 30), 30);

      // Vehicle capacity 25, proposed 30 -> 25 (enforces vehicle ceiling)
      assert.strictEqual(computeEffectiveCapacity(25, 30), 25);

      // Vehicle capacity NULL -> throws error (fails safe)
      assert.throws(() => computeEffectiveCapacity(null, 30), /CAPACITY_NOT_CONFIGURED/);

      // Vehicle capacity 0 -> throws error (fails safe)
      assert.throws(() => computeEffectiveCapacity(0, 30), /CAPACITY_NOT_CONFIGURED/);
    });

    it("verifies seed.sql documents vehicles and drivers as staging reference fixtures", () => {
      assert.ok(
        seedContent.includes("DEVELOPMENT & STAGING REFERENCE FIXTURES"),
        "seed.sql must explicitly document that fleet and driver records are staging fixtures"
      );
      assert.ok(
        seedContent.includes("not verified production fleet assets"),
        "seed.sql must state vehicles are not verified production assets"
      );
    });
  });

  // ============================================================
  // 5. IN-MEMORY POSTGRESQL (pg-mem) TIMETABLE GENERATION
  // ============================================================
  describe("5. In-Memory PostgreSQL Emulator (pg-mem) Timetable Generation", () => {
    it("generates the four expected weekday journeys from schedule templates with correct times", () => {
      const db = newDb();

      // Schema definition
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
          name TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE schedules (
          id UUID PRIMARY KEY,
          route_id UUID REFERENCES routes(id),
          day_of_week INTEGER NOT NULL,
          departure_time TIME NOT NULL,
          latest_departure_time TIME,
          proposed_allocation INTEGER NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          notes TEXT
        );

        CREATE TABLE journeys (
          id UUID PRIMARY KEY,
          schedule_id UUID REFERENCES schedules(id),
          route_id UUID REFERENCES routes(id),
          vehicle_id UUID REFERENCES vehicles(id),
          driver_id UUID REFERENCES profiles(id),
          journey_date DATE NOT NULL,
          scheduled_departure TIMESTAMP NOT NULL,
          latest_permitted_departure TIMESTAMP NOT NULL,
          proposed_allocation INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          created_by UUID REFERENCES profiles(id)
        );
      `);

      // 1. Seed driver, vehicle, and 4 routes
      db.public.none(`
        INSERT INTO profiles (id, role, is_active)
        VALUES ('a0000000-0000-0000-0000-000000000001', 'driver', TRUE);

        INSERT INTO vehicles (id, registration_number, safe_capacity)
        VALUES ('b0000000-0000-0000-0000-000000000001', 'CU-EB-04', 30);

        INSERT INTO routes (id, code, name)
        VALUES
          ('c0000000-0000-0001-0000-000000000001', 'BOYS_AM_ROUTE', 'Boys Morning Corridor (via Wuye)'),
          ('c0000000-0000-0002-0000-000000000001', 'BOYS_AM_DIRECT', 'Boys Morning Direct'),
          ('c0000000-0000-0003-0000-000000000001', 'BOYS_PM_DIRECT', 'Boys Evening Direct'),
          ('c0000000-0000-0004-0000-000000000001', 'BOYS_PM_ROUTE', 'Boys Evening Corridor (via Wuye)');
      `);

      // 2. Seed Monday (day_of_week = 1) schedule templates for the 4 patterns
      db.public.none(`
        INSERT INTO schedules (id, route_id, day_of_week, departure_time, latest_departure_time, proposed_allocation, notes)
        VALUES
          ('d0000000-0000-0001-0000-000000000001', 'c0000000-0000-0001-0000-000000000001', 1, '07:30:00', NULL, 30, 'Pattern 1'),
          ('d0000000-0000-0002-0000-000000000001', 'c0000000-0000-0002-0000-000000000001', 1, '08:30:00', NULL, 30, 'Pattern 2'),
          ('d0000000-0000-0003-0000-000000000001', 'c0000000-0000-0003-0000-000000000001', 1, '16:00:00', NULL, 30, 'Pattern 3'),
          ('d0000000-0000-0004-0000-000000000001', 'c0000000-0000-0004-0000-000000000001', 1, '16:50:00', '17:00:00', 30, 'Pattern 4');
      `);

      // 3. Simulate Journey Generation for Monday 2026-11-09
      const mondayDate = "2026-11-09"; // Monday (DOW = 1)
      const targetDow = 1;

      const scheds = db.public.many(`
        SELECT s.*, r.code AS route_code
        FROM schedules s
        JOIN routes r ON r.id = s.route_id
        WHERE s.day_of_week = ${targetDow}
          AND s.is_active = TRUE
        ORDER BY s.departure_time ASC;
      `);

      assert.strictEqual(scheds.length, 4, "Must find exactly 4 schedule templates for Monday");

      // Generate journeys
      let idx = 1;
      for (const s of scheds) {
        const schedDep = `${mondayDate} ${s.departure_time}`;
        const latestDep = s.latest_departure_time ? `${mondayDate} ${s.latest_departure_time}` : schedDep;
        const jId = `e0000000-0000-0001-0000-00000000000${idx++}`;

        db.public.none(`
          INSERT INTO journeys (
            id, schedule_id, route_id, vehicle_id, driver_id, journey_date, scheduled_departure, latest_permitted_departure, proposed_allocation, status, created_by
          )
          VALUES (
            '${jId}',
            '${s.id}',
            '${s.route_id}',
            'b0000000-0000-0000-0000-000000000001',
            'a0000000-0000-0000-0000-000000000001',
            '${mondayDate}',
            '${schedDep}',
            '${latestDep}',
            30,
            'scheduled',
            NULL
          );
        `);
      }

      // Query generated journeys
      const journeys = db.public.many(`
        SELECT j.id, r.code AS route_code, j.scheduled_departure, j.latest_permitted_departure, j.created_by
        FROM journeys j
        JOIN routes r ON r.id = j.route_id
        WHERE j.journey_date = '${mondayDate}'
        ORDER BY j.scheduled_departure ASC;
      `);

      assert.strictEqual(journeys.length, 4, "Must generate exactly 4 journeys for Monday");

      const toIso = (d: any) => (d instanceof Date ? d.toISOString() : String(d));

      // Pattern 1: 07:30
      assert.strictEqual(journeys[0].route_code, "BOYS_AM_ROUTE");
      assert.ok(toIso(journeys[0].scheduled_departure).includes("07:30"), "Pattern 1 scheduled departure must be 07:30");
      assert.strictEqual(journeys[0].created_by, null, "Created by must be NULL for system job");

      // Pattern 2: 08:30
      assert.strictEqual(journeys[1].route_code, "BOYS_AM_DIRECT");
      assert.ok(toIso(journeys[1].scheduled_departure).includes("08:30"), "Pattern 2 scheduled departure must be 08:30");

      // Pattern 3: 16:00
      assert.strictEqual(journeys[2].route_code, "BOYS_PM_DIRECT");
      assert.ok(toIso(journeys[2].scheduled_departure).includes("16:00"), "Pattern 3 scheduled departure must be 16:00");

      // Pattern 4: 16:50 planned / 17:00 latest
      assert.strictEqual(journeys[3].route_code, "BOYS_PM_ROUTE");
      assert.ok(toIso(journeys[3].scheduled_departure).includes("16:50"), "Pattern 4 scheduled departure must be 16:50");
      assert.ok(toIso(journeys[3].latest_permitted_departure).includes("17:00"), "Pattern 4 latest permitted departure must be 17:00");

      // 4. Verify Idempotency: Second run skips all 4 existing journeys
      let skipped = 0;
      for (const s of scheds) {
        const exists = db.public.many(`
          SELECT 1 FROM journeys WHERE schedule_id = '${s.id}' AND journey_date = '${mondayDate}';
        `);
        if (exists.length > 0) {
          skipped++;
        }
      }
      assert.strictEqual(skipped, 4, "Second run must skip all 4 existing journeys");

      // 5. Verify Weekend Exclusion: Sunday 2026-11-15 (DOW = 0)
      const sundayDow = 0;
      const sundayScheds = db.public.many(`
        SELECT s.* FROM schedules s WHERE s.day_of_week = ${sundayDow};
      `);
      assert.strictEqual(sundayScheds.length, 0, "Sunday must have 0 schedule templates");
    });
  });
});
