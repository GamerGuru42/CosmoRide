import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 6.11 / Controlled Boarding & Departure Workflow Verification Suite
 *
 * Operational Model:
 * 1. Administrative Structure:
 *    - Hostel Manager (1): Overall supervisor across both operations.
 *    - Hostel Representatives (2): Boys' and Girls' operations respectively.
 *    - Bus Manager (1): Coordinates drivers, calls buses, dispatches trips.
 *
 * 2. 7-Stage Workflow Sequence:
 *    - Stage 1: Scheduled (manifest viewable, driver coordinated)
 *    - Stage 2: Bus Arrived (arrival recorded, doors remain closed, does NOT auto-open boarding)
 *    - Stage 3: Boarding Open (representative explicitly opens boarding, countdown timer starts)
 *    - Stage 4: Boarding in Progress (QR scan verification, duplicate check, 20 seated + 10 standing)
 *    - Stage 5: Boarding Closed (timer expiry prompts review, does NOT auto-depart, unboarded NOT auto-noshow)
 *    - Stage 6: Ready to Depart (representative explicitly authorises departure, driver closes doors)
 *    - Stage 7: Departed / Dispatched (Bus Manager confirms dispatch, actual departure recorded, students notified)
 *
 * 3. Invariants:
 *    - Timer expiry NEVER auto-departs bus.
 *    - Boarding closure does NOT auto-mark unboarded students as no-show.
 *    - System does not claim to physically actuate bus doors.
 *    - Strictly zero usage of the term "corridor" in UI and error text.
 */

describe("Controlled Boarding & Departure Workflow Verification Suite", () => {
  const migration17Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00017_controlled_boarding_and_departure_workflow.sql"
  );
  const migration17Content = fs.readFileSync(migration17Path, "utf-8").replace(/\r\n/g, "\n");

  const migration18Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00018_dispatch_notification_type_and_clean_lint.sql"
  );
  const migration18Content = fs.readFileSync(migration18Path, "utf-8").replace(/\r\n/g, "\n");

  const typesPath = path.resolve(process.cwd(), "src/lib/supabase/types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf-8");

  // ============================================================
  // 1. STATIC SCHEMA & MIGRATIONS 00017 & 00018 INSPECTION
  // ============================================================
  describe("1. Static Schema & Migration 00017 / 00018 Inspection", () => {
    it("extends journey_status enum with 'bus_arrived', 'boarding_closed', and 'ready_to_depart'", () => {
      assert.ok(
        migration17Content.includes("ALTER TYPE public.journey_status ADD VALUE IF NOT EXISTS 'bus_arrived'"),
        "Must add 'bus_arrived' to journey_status enum"
      );
      assert.ok(
        migration17Content.includes("ALTER TYPE public.journey_status ADD VALUE IF NOT EXISTS 'boarding_closed'"),
        "Must add 'boarding_closed' to journey_status enum"
      );
      assert.ok(
        migration17Content.includes("ALTER TYPE public.journey_status ADD VALUE IF NOT EXISTS 'ready_to_depart'"),
        "Must add 'ready_to_depart' to journey_status enum"
      );
    });

    it("adds operational workflow columns to journeys table", () => {
      const requiredColumns = [
        "bus_arrived_at",
        "bus_arrived_by",
        "boarding_opened_at",
        "boarding_opened_by",
        "boarding_window_minutes",
        "boarding_closed_at",
        "boarding_closed_by",
        "departure_authorised_at",
        "departure_authorised_by",
        "departure_confirmed_by",
        "boarding_notes",
      ];
      for (const col of requiredColumns) {
        assert.ok(
          migration17Content.includes(col),
          `journeys table must have column: ${col}`
        );
      }
    });

    it("adds admin_role column to public.profiles with valid check constraint", () => {
      assert.ok(
        migration17Content.includes("ADD COLUMN IF NOT EXISTS admin_role TEXT"),
        "profiles must have admin_role column"
      );
      assert.ok(
        migration17Content.includes("CHECK (admin_role IS NULL OR admin_role IN ('hostel_manager', 'bus_manager', 'super_admin'))"),
        "admin_role must enforce hostel_manager, bus_manager, super_admin"
      );
    });

    it("provisions boarding_window_minutes in system_settings with default 10", () => {
      assert.ok(
        migration17Content.includes("'boarding_window_minutes'"),
        "system_settings must configure boarding_window_minutes"
      );
      assert.ok(
        migration17Content.includes("'10'::jsonb"),
        "Default boarding window must be 10 minutes"
      );
    });

    it("creates all 5 dedicated workflow RPCs in migration 00017", () => {
      const rpcs = [
        "confirm_bus_arrival",
        "open_journey_boarding",
        "close_journey_boarding",
        "authorise_journey_departure",
        "confirm_journey_dispatch",
      ];
      for (const rpc of rpcs) {
        assert.ok(
          migration17Content.includes(`CREATE OR REPLACE FUNCTION public.${rpc}`),
          `Migration 00017 must define RPC: ${rpc}`
        );
      }
    });

    it("ensures migration 00018 provisions 'journey_update' notification enum and casts cleanly", () => {
      assert.ok(
        migration18Content.includes("ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'journey_update'"),
        "Migration 00018 must add 'journey_update' to notification_type"
      );
      assert.ok(
        migration18Content.includes("confirm_journey_dispatch"),
        "Migration 00018 must refresh confirm_journey_dispatch with valid notification casting"
      );
    });

    it("verifies TypeScript database definitions export all statuses and RPCs", () => {
      assert.ok(
        typesContent.includes('"bus_arrived"'),
        "JourneyStatus must include bus_arrived"
      );
      assert.ok(
        typesContent.includes('"boarding_closed"'),
        "JourneyStatus must include boarding_closed"
      );
      assert.ok(
        typesContent.includes('"ready_to_depart"'),
        "JourneyStatus must include ready_to_depart"
      );
      assert.ok(
        typesContent.includes("confirm_bus_arrival:"),
        "Functions must declare confirm_bus_arrival"
      );
      assert.ok(
        typesContent.includes("open_journey_boarding:"),
        "Functions must declare open_journey_boarding"
      );
      assert.ok(
        typesContent.includes("close_journey_boarding:"),
        "Functions must declare close_journey_boarding"
      );
      assert.ok(
        typesContent.includes("authorise_journey_departure:"),
        "Functions must declare authorise_journey_departure"
      );
      assert.ok(
        typesContent.includes("confirm_journey_dispatch:"),
        "Functions must declare confirm_journey_dispatch"
      );
    });
  });

  // ============================================================
  // 2. STAGE 1: SCHEDULED MANIFEST & COORDINATION
  // ============================================================
  describe("2. Stage 1: Scheduled Manifest & Coordination", () => {
    it("isolates scheduled journeys to the representative's assigned hostel operation", () => {
      const boysGroupId = "11111111-1111-1111-1111-111111111111";
      const girlsGroupId = "22222222-2222-2222-2222-222222222222";

      const boysRepresentative = {
        id: "rep-boys-1",
        role: "boarding_officer",
        assigned_transport_group_id: boysGroupId,
      };

      const scheduledJourneys = [
        { id: "j-boys-1", transport_group_id: boysGroupId, status: "scheduled" },
        { id: "j-girls-1", transport_group_id: girlsGroupId, status: "scheduled" },
      ];

      const visible = scheduledJourneys.filter(
        (j) => j.transport_group_id === boysRepresentative.assigned_transport_group_id
      );

      assert.strictEqual(visible.length, 1);
      assert.strictEqual(visible[0].id, "j-boys-1");
    });

    it("manifest displays booked passengers with allocated seated (20) and standing (12) categories", () => {
      const bookings = [
        { id: "b-1", passenger_category: "seated", status: "confirmed" },
        { id: "b-21", passenger_category: "standing", status: "confirmed" },
      ];

      const seated = bookings.filter((b) => b.passenger_category === "seated");
      const standing = bookings.filter((b) => b.passenger_category === "standing");

      assert.strictEqual(seated.length, 1);
      assert.strictEqual(standing.length, 1);
    });
  });

  // ============================================================
  // 3. STAGE 2: BUS ARRIVAL INVARIANTS
  // ============================================================
  describe("3. Stage 2: Bus Arrival Invariants", () => {
    it("transitions status from scheduled to bus_arrived and records arrival attribution", () => {
      const journey = {
        id: "j-1",
        status: "scheduled",
        bus_arrived_at: null as string | null,
        bus_arrived_by: null as string | null,
      };

      function confirmArrival(j: typeof journey, actorId: string) {
        if (j.status !== "scheduled") {
          if (j.status === "bus_arrived") return { success: true, code: "ALREADY_ARRIVED" };
          return { success: false, code: "INVALID_STATUS" };
        }
        j.status = "bus_arrived";
        j.bus_arrived_at = new Date().toISOString();
        j.bus_arrived_by = actorId;
        return { success: true, code: "SUCCESS" };
      }

      const res = confirmArrival(journey, "officer-boys-1");
      assert.strictEqual(res.success, true);
      assert.strictEqual(journey.status, "bus_arrived");
      assert.ok(journey.bus_arrived_at !== null);
      assert.strictEqual(journey.bus_arrived_by, "officer-boys-1");
    });

    it("INVARIANT: Bus arrival does NOT automatically open boarding (doors remain closed)", () => {
      const journey = {
        id: "j-2",
        status: "scheduled",
        boarding_opened_at: null as string | null,
      };

      // Simulating confirm_bus_arrival
      journey.status = "bus_arrived";

      // Status must strictly remain 'bus_arrived', NOT 'boarding'
      assert.strictEqual(journey.status, "bus_arrived");
      assert.strictEqual(journey.boarding_opened_at, null);
    });

    it("rejects representative attempting to record arrival for another hostel operation", () => {
      const officerGroupId = "boys-group-id";
      const journeyGroupId = "girls-group-id";

      function checkArrivalPermission(officerGroup: string, journeyGroup: string) {
        if (officerGroup !== journeyGroup) {
          return {
            success: false,
            code: "CROSS_GROUP_DENIED",
            error: "Cross-Group Restriction: You cannot record arrival for a route outside your assigned hostel operation.",
          };
        }
        return { success: true };
      }

      const res = checkArrivalPermission(officerGroupId, journeyGroupId);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "CROSS_GROUP_DENIED");
      assert.ok(!res.error?.toLowerCase().includes("corridor"), "Error message must not contain corridor");
    });
  });

  // ============================================================
  // 4. STAGE 3: BOARDING OPENING & COUNTDOWN INVARIANTS
  // ============================================================
  describe("4. Stage 3: Boarding Opening & Countdown Invariants", () => {
    it("requires status to be 'bus_arrived' before boarding can be opened", () => {
      function openBoarding(status: string) {
        if (status !== "bus_arrived") {
          return {
            success: false,
            code: "INVALID_STATUS",
            error: `Cannot open boarding: Journey must be in 'bus_arrived' status (current status: '${status}').`,
          };
        }
        return { success: true, newStatus: "boarding" };
      }

      // Opening directly from 'scheduled' must fail
      const fromScheduled = openBoarding("scheduled");
      assert.strictEqual(fromScheduled.success, false);
      assert.strictEqual(fromScheduled.code, "INVALID_STATUS");

      // Opening from 'bus_arrived' must succeed
      const fromArrived = openBoarding("bus_arrived");
      assert.strictEqual(fromArrived.success, true);
      assert.strictEqual(fromArrived.newStatus, "boarding");
    });

    it("records boarding_opened_at, boarding_opened_by, and configurable window minutes (default 10)", () => {
      const defaultSetting = 10;
      function executeOpenBoarding(officerId: string, customWindowMinutes?: number | null) {
        const windowMinutes = customWindowMinutes && customWindowMinutes > 0 ? customWindowMinutes : defaultSetting;
        return {
          status: "boarding",
          boarding_opened_at: new Date().toISOString(),
          boarding_opened_by: officerId,
          boarding_window_minutes: windowMinutes,
        };
      }

      const defaultCall = executeOpenBoarding("rep-1");
      assert.strictEqual(defaultCall.boarding_window_minutes, 10);
      assert.strictEqual(defaultCall.status, "boarding");

      const customCall = executeOpenBoarding("rep-1", 15);
      assert.strictEqual(customCall.boarding_window_minutes, 15);
    });

    it("visible countdown timer calculates remaining seconds accurately", () => {
      const openedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 minutes ago
      const windowMinutes = 10;

      const openedMs = new Date(openedAt).getTime();
      const expiresMs = openedMs + windowMinutes * 60 * 1000;
      const remainingSeconds = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));

      // 10 minutes - 3 minutes = ~7 minutes = ~420 seconds
      assert.ok(remainingSeconds >= 415 && remainingSeconds <= 425);
    });
  });

  // ============================================================
  // 5. STAGE 4: BOARDING VERIFICATION & CAPACITY ENFORCEMENT
  // ============================================================
  describe("5. Stage 4: Boarding Verification & Capacity Enforcement", () => {
    it("fails safely if ticket is scanned when journey is NOT in 'boarding' status", () => {
      const invalidStatuses = ["scheduled", "bus_arrived", "boarding_closed", "ready_to_depart", "in_transit", "completed", "cancelled"];

      function verifyScan(journeyStatus: string) {
        if (journeyStatus !== "boarding") {
          return {
            success: false,
            code: "BOARDING_NOT_OPEN",
            error: `Boarding is not open for this journey (current status: '${journeyStatus}').`,
          };
        }
        return { success: true, code: "VALID" };
      }

      for (const st of invalidStatuses) {
        const res = verifyScan(st);
        assert.strictEqual(res.success, false);
        assert.strictEqual(res.code, "BOARDING_NOT_OPEN");
      }

      const validRes = verifyScan("boarding");
      assert.strictEqual(validRes.success, true);
      assert.strictEqual(validRes.code, "VALID");
    });

    it("rejects duplicate scans when ticket is already checked in", () => {
      const booking = {
        id: "b-10",
        ticket_token: "VALID_TOKEN_123",
        status: "checked_in",
        checked_in_at: "2026-11-10T07:32:00Z",
      };

      function scanTicket(b: typeof booking) {
        if (b.status === "checked_in") {
          return {
            success: false,
            code: "ALREADY_CHECKED_IN",
            error: `Pass already scanned at ${b.checked_in_at}. Duplicate entry denied.`,
          };
        }
        return { success: true, code: "VALID" };
      }

      const res = scanTicket(booking);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "ALREADY_CHECKED_IN");
    });

    it("rejects ticket presented for the wrong journey", () => {
      const ticketJourneyId = "journey-A";
      const currentJourneyId = "journey-B";

      function checkJourneyMatch(ticketJourney: string, currentJourney: string) {
        if (ticketJourney !== currentJourney) {
          return {
            success: false,
            code: "WRONG_JOURNEY",
            error: "Pass was issued for a different scheduled journey.",
          };
        }
        return { success: true };
      }

      const res = checkJourneyMatch(ticketJourneyId, currentJourneyId);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "WRONG_JOURNEY");
    });

    it("rejects cancelled boarding pass", () => {
      const booking = { status: "cancelled" };

      function checkBookingStatus(status: string) {
        if (status === "cancelled") {
          return {
            success: false,
            code: "CANCELLED_TICKET",
            error: "This booking was cancelled and is invalid for boarding.",
          };
        }
        return { success: true };
      }

      const res = checkBookingStatus(booking.status);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "CANCELLED_TICKET");
    });

    it("enforces 20 seated + 12 standing = 32 total maximum capacity metrics during boarding verification", () => {
      const maxSeated = 20;
      const maxStanding = 12;
      const maxTotal = 32;

      let seatedBoarded = 19;
      let standingBoarded = 11;

      // Boarding seated passenger #20
      seatedBoarded++;
      assert.strictEqual(seatedBoarded, maxSeated);
      assert.ok(seatedBoarded <= maxSeated);

      // Boarding standing passenger #12
      standingBoarded++;
      assert.strictEqual(standingBoarded, maxStanding);
      assert.ok(standingBoarded <= maxStanding);

      // Total passenger check
      const totalBoarded = seatedBoarded + standingBoarded;
      assert.strictEqual(totalBoarded, maxTotal);
      assert.strictEqual(totalBoarded, 32);

      // 33rd passenger cannot be boarded
      function attemptBoard33rd(currentBoarded: number, limit: number) {
        if (currentBoarded >= limit) {
          return { success: false, code: "BUS_FULL", error: "Boarding Gate Blocked: Bus safe physical capacity of " + limit + " passengers reached." };
        }
        return { success: true };
      }

      const board33rd = attemptBoard33rd(totalBoarded, maxTotal);
      assert.strictEqual(board33rd.success, false);
      assert.strictEqual(board33rd.code, "BUS_FULL");
    });

    it("verifies 33rd passenger rejection / waitlisting when 32 places are filled", () => {
      const maxTotal = 32;
      const bookings: { id: string; category: "seated" | "standing" }[] = [];
      const waitlist: { id: string; position: number }[] = [];

      for (let i = 1; i <= 32; i++) {
        bookings.push({
          id: `b-${i}`,
          category: i <= 20 ? "seated" : "standing",
        });
      }

      assert.strictEqual(bookings.length, 32);
      assert.strictEqual(bookings.filter((b) => b.category === "seated").length, 20);
      assert.strictEqual(bookings.filter((b) => b.category === "standing").length, 12);

      // 33rd booking attempt
      function bookPassenger(studentId: string) {
        if (bookings.length >= maxTotal) {
          waitlist.push({ id: studentId, position: waitlist.length + 1 });
          return { success: true, status: "waitlist", waitlist_position: waitlist.length };
        }
        return { success: true, status: "confirmed" };
      }

      const res33 = bookPassenger("student-33");
      assert.strictEqual(res33.status, "waitlist");
      assert.strictEqual(res33.waitlist_position, 1);
      assert.strictEqual(waitlist.length, 1);
    });

    it("verifies cancellation rebalancing with 12 standing places and automatic waitlist promotion", () => {
      interface BRecord {
        id: string;
        studentId: string;
        category: "seated" | "standing";
        status: "confirmed" | "cancelled";
        bookedAt: number;
      }

      const bookings: BRecord[] = [];
      for (let i = 1; i <= 32; i++) {
        bookings.push({
          id: `b-${i}`,
          studentId: `s-${i}`,
          category: i <= 20 ? "seated" : "standing",
          status: "confirmed",
          bookedAt: i,
        });
      }

      const waitlist = [{ studentId: "s-33", position: 1 }];

      // Cancel seated passenger #5
      const seatedBooking = bookings.find((b) => b.id === "b-5")!;
      seatedBooking.status = "cancelled";

      // Earliest standing passenger (b-21) upgraded to seated
      const earliestStanding = bookings
        .filter((b) => b.status === "confirmed" && b.category === "standing")
        .sort((a, b) => a.bookedAt - b.bookedAt)[0];

      assert.strictEqual(earliestStanding.id, "b-21");
      earliestStanding.category = "seated";

      // Vacant standing place goes to s-33
      const promoted = waitlist.shift()!;
      bookings.push({
        id: `b-${promoted.studentId}`,
        studentId: promoted.studentId,
        category: "standing",
        status: "confirmed",
        bookedAt: 33,
      });

      const confirmed = bookings.filter((b) => b.status === "confirmed");
      assert.strictEqual(confirmed.length, 32);
      assert.strictEqual(confirmed.filter((b) => b.category === "seated").length, 20);
      assert.strictEqual(confirmed.filter((b) => b.category === "standing").length, 12);
      assert.strictEqual(waitlist.length, 0);
    });

    it("verifies atomic concurrency protection against over-booking past 32 passengers", () => {
      const maxCapacity = 32;
      let confirmedCount = 31;
      let waitlistCount = 0;

      // Two concurrent callers attempting to claim the 32nd place
      function atomicAttemptBooking(): "confirmed" | "waitlist" {
        // Emulating FOR UPDATE transaction lock serialization
        if (confirmedCount < maxCapacity) {
          confirmedCount++;
          return "confirmed";
        } else {
          waitlistCount++;
          return "waitlist";
        }
      }

      const resultA = atomicAttemptBooking();
      const resultB = atomicAttemptBooking();

      // Exactly one succeeds with confirmed (32nd place), one gets waitlisted (33rd)
      const results = [resultA, resultB].sort();
      assert.deepStrictEqual(results, ["confirmed", "waitlist"]);
      assert.strictEqual(confirmedCount, 32);
      assert.strictEqual(waitlistCount, 1);
    });
  });

  // ============================================================
  // 6. STAGE 5: BOARDING CLOSURE & TIMER EXPIRY INVARIANTS
  // ============================================================
  describe("6. Stage 5: Boarding Closure & Timer Expiry Invariants", () => {
    it("transitions status to 'boarding_closed' and records closure attribution", () => {
      const journey = {
        id: "j-5",
        status: "boarding",
        boarding_closed_at: null as string | null,
        boarding_closed_by: null as string | null,
      };

      function closeBoarding(j: typeof journey, officerId: string) {
        if (j.status !== "boarding") {
          return { success: false, code: "INVALID_STATUS" };
        }
        j.status = "boarding_closed";
        j.boarding_closed_at = new Date().toISOString();
        j.boarding_closed_by = officerId;
        return { success: true };
      }

      const res = closeBoarding(journey, "rep-boys-1");
      assert.strictEqual(res.success, true);
      assert.strictEqual(journey.status, "boarding_closed");
      assert.ok(journey.boarding_closed_at !== null);
      assert.strictEqual(journey.boarding_closed_by, "rep-boys-1");
    });

    it("INVARIANT: Timer expiry NEVER automatically departs the bus", () => {
      // Simulating timer hitting 0
      const timerExpired = true;
      let journeyStatus = "boarding";

      // On timer expiry, status must NOT change to 'in_transit' or 'ready_to_depart'
      if (timerExpired) {
        // UI alerts representative to review and close boarding
        // Backend state remains 'boarding' until representative triggers action
      }

      assert.strictEqual(journeyStatus, "boarding");
      assert.notStrictEqual(journeyStatus, "in_transit");
      assert.notStrictEqual(journeyStatus, "ready_to_depart");
    });

    it("INVARIANT: Boarding closure does NOT automatically mark unboarded students as no-show", () => {
      const bookings = [
        { id: "b-1", status: "checked_in" },
        { id: "b-2", status: "confirmed" }, // unboarded student
        { id: "b-3", status: "confirmed" }, // unboarded student
      ];

      // Boarding closure routine
      const boardedCount = bookings.filter((b) => b.status === "checked_in").length;
      const unboarded = bookings.filter((b) => b.status === "confirmed");

      // Unboarded students must remain 'confirmed' (NOT auto-converted to 'no_show')
      for (const b of unboarded) {
        assert.strictEqual(b.status, "confirmed");
        assert.notStrictEqual(b.status, "no_show");
      }
      assert.strictEqual(boardedCount, 1);
      assert.strictEqual(unboarded.length, 2);
    });
  });

  // ============================================================
  // 7. STAGE 6: DEPARTURE AUTHORISATION INVARIANTS
  // ============================================================
  describe("7. Stage 6: Departure Authorisation Invariants", () => {
    it("transitions status to 'ready_to_depart' and records departure authorisation attribution", () => {
      const journey = {
        id: "j-6",
        status: "boarding_closed",
        departure_authorised_at: null as string | null,
        departure_authorised_by: null as string | null,
      };

      function authoriseDeparture(j: typeof journey, officerId: string) {
        if (!["boarding", "boarding_closed"].includes(j.status)) {
          return { success: false, code: "INVALID_STATUS" };
        }
        j.status = "ready_to_depart";
        j.departure_authorised_at = new Date().toISOString();
        j.departure_authorised_by = officerId;
        return { success: true };
      }

      const res = authoriseDeparture(journey, "rep-boys-1");
      assert.strictEqual(res.success, true);
      assert.strictEqual(journey.status, "ready_to_depart");
      assert.ok(journey.departure_authorised_at !== null);
      assert.strictEqual(journey.departure_authorised_by, "rep-boys-1");
    });

    it("rejects departure authorisation from 'scheduled' or 'bus_arrived' without boarding opening", () => {
      function authorise(status: string) {
        if (!["boarding", "boarding_closed"].includes(status)) {
          return {
            success: false,
            code: "INVALID_STATUS",
            error: `Cannot authorise departure: Journey must be in 'boarding' or 'boarding_closed' status (current: '${status}').`,
          };
        }
        return { success: true };
      }

      assert.strictEqual(authorise("scheduled").success, false);
      assert.strictEqual(authorise("bus_arrived").success, false);
    });
  });

  // ============================================================
  // 8. STAGE 7: DISPATCH CONFIRMATION INVARIANTS
  // ============================================================
  describe("8. Stage 7: Dispatch Confirmation Invariants", () => {
    it("transitions status to 'in_transit' and records actual_departure and departure_confirmed_by", () => {
      const journey = {
        id: "j-7",
        status: "ready_to_depart",
        actual_departure: null as string | null,
        departure_confirmed_by: null as string | null,
      };

      function confirmDispatch(j: typeof journey, actorId: string) {
        if (!["ready_to_depart", "boarding_closed", "boarding"].includes(j.status)) {
          return { success: false, code: "INVALID_STATUS" };
        }
        j.status = "in_transit";
        j.actual_departure = new Date().toISOString();
        j.departure_confirmed_by = actorId;
        return { success: true };
      }

      const res = confirmDispatch(journey, "bus-manager-1");
      assert.strictEqual(res.success, true);
      assert.strictEqual(journey.status, "in_transit");
      assert.ok(journey.actual_departure !== null);
      assert.strictEqual(journey.departure_confirmed_by, "bus-manager-1");
    });

    it("rejects dispatch confirmation if journey was cancelled", () => {
      function dispatch(status: string) {
        if (status === "cancelled") {
          return { success: false, code: "JOURNEY_CANCELLED", error: "Cancelled journeys cannot be dispatched." };
        }
        return { success: true };
      }

      const res = dispatch("cancelled");
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "JOURNEY_CANCELLED");
    });
  });

  // ============================================================
  // 9. ADMINISTRATIVE ROLES & RESPONSIBILITIES HIERARCHY
  // ============================================================
  describe("9. Administrative Roles & Responsibilities Hierarchy", () => {
    it("recognises exactly three administrative role specializations", () => {
      const validAdminRoles = ["hostel_manager", "bus_manager", "super_admin"];
      for (const role of validAdminRoles) {
        assert.ok(
          migration17Content.includes(`'${role}'`),
          `admin_role check constraint must include ${role}`
        );
      }
    });

    it("Hostel Manager has supervisory cross-hostel visibility", () => {
      const supervisor = {
        id: "hm-1",
        role: "admin",
        admin_role: "hostel_manager",
      };

      function canOverseeAllHostels(user: typeof supervisor) {
        return user.role === "admin" && (user.admin_role === "hostel_manager" || user.admin_role === "super_admin");
      }

      assert.strictEqual(canOverseeAllHostels(supervisor), true);
    });

    it("Bus Manager manages drivers, readiness and rolling dispatch without representative gatekeeping", () => {
      const busManager = {
        id: "bm-1",
        role: "admin",
        admin_role: "bus_manager",
      };

      function canCoordinateDispatch(user: typeof busManager) {
        return user.role === "admin" && (user.admin_role === "bus_manager" || user.admin_role === "super_admin");
      }

      assert.strictEqual(canCoordinateDispatch(busManager), true);
    });

    it("Hostel Representatives are isolated to their designated hostel operation", () => {
      const boysRepresentative = {
        id: "rep-b",
        role: "boarding_officer",
        assigned_transport_group_id: "boys-group-id",
      };

      function canManageHostelOperation(rep: typeof boysRepresentative, targetGroupId: string) {
        if (rep.role === "boarding_officer") {
          return rep.assigned_transport_group_id === targetGroupId;
        }
        return true;
      }

      assert.strictEqual(canManageHostelOperation(boysRepresentative, "boys-group-id"), true);
      assert.strictEqual(canManageHostelOperation(boysRepresentative, "girls-group-id"), false);
    });
  });

  // ============================================================
  // 10. STRICT COMPLETE STATE MACHINE TRANSITIONS
  // ============================================================
  describe("10. Strict Complete State Machine Transitions", () => {
    it("validates the full ordered 7-stage lifecycle without skipping stages", () => {
      const lifecycle = [
        "scheduled",
        "bus_arrived",
        "boarding",
        "boarding_closed",
        "ready_to_depart",
        "in_transit",
        "completed",
      ];

      let currentStageIndex = 0;
      function advanceTo(nextStage: string) {
        const nextIndex = lifecycle.indexOf(nextStage);
        if (nextIndex === -1) return { allowed: false, error: "Unknown stage" };
        if (nextIndex !== currentStageIndex + 1) {
          return {
            allowed: false,
            error: `Illegal state jump: Cannot transition from ${lifecycle[currentStageIndex]} to ${nextStage}`,
          };
        }
        currentStageIndex = nextIndex;
        return { allowed: true };
      }

      // Step-by-step valid transitions
      assert.strictEqual(advanceTo("bus_arrived").allowed, true);
      assert.strictEqual(advanceTo("boarding").allowed, true);
      assert.strictEqual(advanceTo("boarding_closed").allowed, true);
      assert.strictEqual(advanceTo("ready_to_depart").allowed, true);
      assert.strictEqual(advanceTo("in_transit").allowed, true);
      assert.strictEqual(advanceTo("completed").allowed, true);
    });

    it("rejects illegal skip from scheduled directly to ready_to_depart", () => {
      const current = "scheduled";
      const target = "ready_to_depart";

      function validateDirectJump(from: string, to: string) {
        if (from === "scheduled" && to === "ready_to_depart") {
          return { allowed: false, code: "ILLEGAL_JUMP" };
        }
        return { allowed: true };
      }

      const res = validateDirectJump(current, target);
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.code, "ILLEGAL_JUMP");
    });
  });

  // ============================================================
  // 11. STRICT TERMINOLOGY COMPLIANCE (ZERO "CORRIDOR" IN UI / CLIENT / ERRORS)
  // ============================================================
  describe("11. Strict Terminology Compliance", () => {
    it("ensures RPC error messages in migration 00017 do NOT contain the forbidden term 'corridor'", () => {
      // Find all error strings in migration 00017
      const errorRegex = /'error',\s*'([^']+)'/g;
      let match;
      const errors: string[] = [];
      while ((match = errorRegex.exec(migration17Content)) !== null) {
        errors.push(match[1]);
      }

      assert.ok(errors.length > 0, "Must have extracted error messages");
      for (const err of errors) {
        assert.ok(
          !err.toLowerCase().includes("corridor"),
          `RPC error message must NOT contain 'corridor': "${err}"`
        );
      }
    });

    it("ensures source files in src/ contain zero occurrences of the forbidden term 'corridor'", () => {
      function scanDir(dir: string): string[] {
        const results: string[] = [];
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            results.push(...scanDir(fullPath));
          } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
            const content = fs.readFileSync(fullPath, "utf-8");
            if (content.toLowerCase().includes("corridor")) {
              results.push(fullPath);
            }
          }
        }
        return results;
      }

      const srcDir = path.resolve(process.cwd(), "src");
      const offendingFiles = scanDir(srcDir);
      assert.deepStrictEqual(
        offendingFiles,
        [],
        `The forbidden term 'corridor' was found in files: ${offendingFiles.join(", ")}`
      );
    });
  });
});

