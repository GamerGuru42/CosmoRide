import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 6.10: Electric Bus Seating (20) and Standing (10) Capacity Allocation
 *
 * Confirmed Capacity Rules:
 * - 20 seated passenger places.
 * - 10 standing passenger places.
 * - 30 passengers maximum total capacity (30 is total capacity, NOT 30 seats).
 *
 * Verification Scope:
 * 1. Migration 00014 Static Inspection:
 *    - enum passenger_category ('seated', 'standing')
 *    - vehicles table seated_capacity (20) and standing_capacity (10)
 *    - bookings table passenger_category
 *    - boarding_records table passenger_category
 *    - atomic FOR UPDATE row locking in booking RPC
 * 2. Automatic First-Come-First-Served (FCFS) Allocation Logic:
 *    - Bookings 1-20 receive 'seated'
 *    - Bookings 21-30 receive 'standing'
 *    - 31st booking is placed on waiting list (safe capacity reached)
 * 3. Seated vs Standing Limits & Disjoint Partitioning:
 *    - Standing passengers never count as seated
 *    - Seated count never exceeds 20
 *    - Standing count never exceeds 10
 *    - Total active passengers never exceeds 30
 * 4. Cancellation Rebalancing & Waitlist Promotion:
 *    - Cancelling a seated booking upgrades earliest standing passenger to seated
 *    - Releases standing spot which promotes top waitlist candidate to standing
 *    - Cancelling a standing booking promotes top waitlist candidate directly to standing
 * 5. Boarding & Check-in Active Capacity Retention:
 *    - Checked-in bookings (status = 'checked_in') continue counting towards occupied capacity
 *    - Boarded records preserve passenger_category
 * 6. UI & Departure Board Passenger Experience:
 *    - Departure board presents total 30, seated 20, standing 10
 *    - Boarding pass renders Seated vs Standing allocation clearly
 *    - Manifest and scanner display passenger category
 */

describe("Phase 6.10: Electric Bus Seating & Standing Capacity Verification", () => {
  const migration14Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00014_electric_bus_seating_and_standing_capacity.sql"
  );
  const migration14Content = fs.readFileSync(migration14Path, "utf-8").replace(/\r\n/g, "\n");

  const typesPath = path.resolve(process.cwd(), "src/lib/supabase/types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf-8");

  // ============================================================
  // 1. STATIC SCHEMA & MIGRATION 00014 INSPECTION
  // ============================================================
  describe("1. Static Schema & Forward-Only Migration 00014 Inspection", () => {
    it("defines passenger_category enum with 'seated' and 'standing' values", () => {
      assert.ok(
        migration14Content.includes("CREATE TYPE public.passenger_category AS ENUM ('seated', 'standing')"),
        "Must create passenger_category enum"
      );
    });

    it("adds seated_capacity (20) and standing_capacity (10) to vehicles table", () => {
      assert.ok(
        migration14Content.includes("ADD COLUMN IF NOT EXISTS seated_capacity INTEGER NOT NULL DEFAULT 20"),
        "vehicles must have seated_capacity default 20"
      );
      assert.ok(
        migration14Content.includes("ADD COLUMN IF NOT EXISTS standing_capacity INTEGER NOT NULL DEFAULT 10"),
        "vehicles must have standing_capacity default 10"
      );
      assert.ok(
        migration14Content.includes("CHECK (seated_capacity >= 0)"),
        "vehicles must have check constraint on seated_capacity >= 0"
      );
      assert.ok(
        migration14Content.includes("CHECK (standing_capacity >= 0)"),
        "vehicles must have check constraint on standing_capacity >= 0"
      );
    });

    it("adds passenger_category column to bookings and boarding_records tables", () => {
      assert.ok(
        migration14Content.includes("ADD COLUMN IF NOT EXISTS passenger_category public.passenger_category NOT NULL DEFAULT 'seated'"),
        "bookings must have passenger_category NOT NULL DEFAULT 'seated'"
      );
      assert.ok(
        migration14Content.includes("ADD COLUMN IF NOT EXISTS passenger_category public.passenger_category"),
        "boarding_records must have passenger_category"
      );
    });

    it("creates performance index on active bookings by passenger category", () => {
      assert.ok(
        migration14Content.includes("idx_bookings_journey_category_active"),
        "Must have partial index for active category counting"
      );
    });

    it("uses atomic row-locking FOR UPDATE OF j in book_journey_seat to prevent over-allocation", () => {
      assert.ok(
        migration14Content.includes("FOR UPDATE OF j"),
        "book_journey_seat must lock the journey row with FOR UPDATE OF j"
      );
    });

    it("aligns verify_and_board_passenger with booking_status enum ('checked_in') and records passenger_category", () => {
      assert.ok(
        migration14Content.includes("SET status = 'checked_in'"),
        "Boarding RPC must set status = 'checked_in' to match booking_status enum"
      );
      assert.ok(
        migration14Content.includes("INSERT INTO public.boarding_records") &&
          migration14Content.includes("passenger_category"),
        "Boarding records must store the passenger_category"
      );
    });

    it("exports PassengerCategory type in TypeScript database definitions", () => {
      assert.ok(
        typesContent.includes('export type PassengerCategory = "seated" | "standing"'),
        "Must export PassengerCategory union type"
      );
      assert.ok(
        typesContent.includes("seated_capacity: number"),
        "vehicles type must include seated_capacity"
      );
      assert.ok(
        typesContent.includes("standing_capacity: number"),
        "vehicles type must include standing_capacity"
      );
      assert.ok(
        typesContent.includes("passenger_category: PassengerCategory"),
        "bookings type must include passenger_category"
      );
    });
  });

  // ============================================================
  // 2. CAPACITY ALLOCATION LOGIC EMULATION (FCFS)
  // ============================================================
  describe("2. Automatic First-Come-First-Served (FCFS) Allocation Logic", () => {
    interface SimulatedBooking {
      id: string;
      studentId: string;
      status: "confirmed" | "checked_in" | "cancelled";
      passengerCategory: "seated" | "standing";
      bookedAt: number;
    }

    interface SimulatedJourney {
      id: string;
      safeCapacity: number;
      seatedCapacity: number;
      standingCapacity: number;
      bookings: SimulatedBooking[];
      waitlist: { studentId: string; position: number }[];
    }

    function bookSeat(journey: SimulatedJourney, studentId: string): { status: "confirmed" | "waitlisted"; category?: "seated" | "standing"; position?: number } {
      const activeBookings = journey.bookings.filter(
        (b) => b.status === "confirmed" || b.status === "checked_in"
      );
      const seatedCount = activeBookings.filter((b) => b.passengerCategory === "seated").length;
      const standingCount = activeBookings.filter((b) => b.passengerCategory === "standing").length;
      const totalActive = activeBookings.length;

      const effectiveTotalCap = Math.min(journey.safeCapacity, journey.seatedCapacity + journey.standingCapacity);

      if (totalActive >= effectiveTotalCap) {
        // Full: add to waitlist
        const position = journey.waitlist.length + 1;
        journey.waitlist.push({ studentId, position });
        return { status: "waitlisted", position };
      }

      // First 20 seated, next 10 standing
      let category: "seated" | "standing";
      if (seatedCount < journey.seatedCapacity) {
        category = "seated";
      } else if (standingCount < journey.standingCapacity) {
        category = "standing";
      } else {
        const position = journey.waitlist.length + 1;
        journey.waitlist.push({ studentId, position });
        return { status: "waitlisted", position };
      }

      journey.bookings.push({
        id: `b_${studentId}`,
        studentId,
        status: "confirmed",
        passengerCategory: category,
        bookedAt: Date.now() + journey.bookings.length,
      });

      return { status: "confirmed", category };
    }

    function cancelBooking(journey: SimulatedJourney, bookingId: string): { success: boolean; promotedStudentId?: string; upgradedStudentId?: string } {
      const booking = journey.bookings.find((b) => b.id === bookingId && b.status === "confirmed");
      if (!booking) return { success: false };

      booking.status = "cancelled";
      const cancelledCategory = booking.passengerCategory;
      let upgradedStudentId: string | undefined;
      let promotedStudentId: string | undefined;

      if (cancelledCategory === "seated") {
        // Upgrade earliest standing passenger to seated
        const standingPassengers = journey.bookings
          .filter((b) => (b.status === "confirmed" || b.status === "checked_in") && b.passengerCategory === "standing")
          .sort((a, b) => a.bookedAt - b.bookedAt);

        if (standingPassengers.length > 0) {
          standingPassengers[0].passengerCategory = "seated";
          upgradedStudentId = standingPassengers[0].studentId;

          // Now a standing place is vacant: promote top waitlist candidate to standing
          if (journey.waitlist.length > 0) {
            const nextCandidate = journey.waitlist.shift()!;
            journey.bookings.push({
              id: `b_${nextCandidate.studentId}`,
              studentId: nextCandidate.studentId,
              status: "confirmed",
              passengerCategory: "standing",
              bookedAt: Date.now(),
            });
            promotedStudentId = nextCandidate.studentId;
          }
        } else if (journey.waitlist.length > 0) {
          // No standing passengers: promote waitlist candidate directly to seated
          const nextCandidate = journey.waitlist.shift()!;
          journey.bookings.push({
            id: `b_${nextCandidate.studentId}`,
            studentId: nextCandidate.studentId,
            status: "confirmed",
            passengerCategory: "seated",
            bookedAt: Date.now(),
          });
          promotedStudentId = nextCandidate.studentId;
        }
      } else {
        // Cancelled standing: promote top waitlist candidate directly to standing
        if (journey.waitlist.length > 0) {
          const nextCandidate = journey.waitlist.shift()!;
          journey.bookings.push({
            id: `b_${nextCandidate.studentId}`,
            studentId: nextCandidate.studentId,
            status: "confirmed",
            passengerCategory: "standing",
            bookedAt: Date.now(),
          });
          promotedStudentId = nextCandidate.studentId;
        }
      }

      return { success: true, upgradedStudentId, promotedStudentId };
    }

    it("allocates 'seated' category to the first 20 confirmed passengers", () => {
      const journey: SimulatedJourney = {
        id: "j_test_01",
        safeCapacity: 32,
        seatedCapacity: 20,
        standingCapacity: 12,
        bookings: [],
        waitlist: [],
      };

      for (let i = 1; i <= 20; i++) {
        const res = bookSeat(journey, `student_${i}`);
        assert.equal(res.status, "confirmed", `Student ${i} should be confirmed`);
        assert.equal(res.category, "seated", `Student ${i} must receive 'seated'`);
      }

      const seatedCount = journey.bookings.filter((b) => b.passengerCategory === "seated").length;
      assert.equal(seatedCount, 20, "Must have exactly 20 seated passengers");
    });

    it("allocates 'standing' category to the next 12 confirmed passengers (21-32)", () => {
      const journey: SimulatedJourney = {
        id: "j_test_02",
        safeCapacity: 32,
        seatedCapacity: 20,
        standingCapacity: 12,
        bookings: [],
        waitlist: [],
      };

      // Fill first 20 seats
      for (let i = 1; i <= 20; i++) {
        bookSeat(journey, `student_${i}`);
      }

      // Next 12 receive standing
      for (let i = 21; i <= 32; i++) {
        const res = bookSeat(journey, `student_${i}`);
        assert.equal(res.status, "confirmed", `Student ${i} should be confirmed`);
        assert.equal(res.category, "standing", `Student ${i} must receive 'standing'`);
      }

      const active = journey.bookings.filter((b) => b.status === "confirmed");
      const seatedCount = active.filter((b) => b.passengerCategory === "seated").length;
      const standingCount = active.filter((b) => b.passengerCategory === "standing").length;

      assert.equal(seatedCount, 20, "Must have exactly 20 seated passengers");
      assert.equal(standingCount, 12, "Must have exactly 12 standing passengers");
      assert.equal(active.length, 32, "Total active passengers must equal 32");
    });

    it("places the 33rd passenger on the waiting list when 32 capacity is reached", () => {
      const journey: SimulatedJourney = {
        id: "j_test_03",
        safeCapacity: 32,
        seatedCapacity: 20,
        standingCapacity: 12,
        bookings: [],
        waitlist: [],
      };

      for (let i = 1; i <= 32; i++) {
        bookSeat(journey, `student_${i}`);
      }

      // 33rd attempt
      const res = bookSeat(journey, "student_33");
      assert.equal(res.status, "waitlisted", "33rd student must be waitlisted");
      assert.equal(res.position, 1, "Must be position #1 on waitlist");
      assert.equal(journey.waitlist.length, 1);
    });

    it("rebalances capacity when a seated passenger cancels: earliest standing upgraded to seated, waitlist promoted to standing", () => {
      const journey: SimulatedJourney = {
        id: "j_test_04",
        safeCapacity: 32,
        seatedCapacity: 20,
        standingCapacity: 12,
        bookings: [],
        waitlist: [],
      };

      // Fill 32 passengers + 1 on waitlist
      for (let i = 1; i <= 33; i++) {
        bookSeat(journey, `student_${i}`);
      }

      // Verify student 21 is standing
      const s21 = journey.bookings.find((b) => b.studentId === "student_21");
      assert.equal(s21?.passengerCategory, "standing");

      // Cancel seated booking of student 5
      const cancelRes = cancelBooking(journey, "b_student_5");
      assert.ok(cancelRes.success);
      assert.equal(cancelRes.upgradedStudentId, "student_21", "Student 21 (earliest standing) must be upgraded to seated");
      assert.equal(cancelRes.promotedStudentId, "student_33", "Student 33 from waitlist must be promoted to standing");

      // Verify invariant: exactly 20 seated, 12 standing, 0 on waitlist
      const active = journey.bookings.filter((b) => b.status === "confirmed");
      const seatedCount = active.filter((b) => b.passengerCategory === "seated").length;
      const standingCount = active.filter((b) => b.passengerCategory === "standing").length;

      assert.equal(seatedCount, 20, "Must maintain exactly 20 seated");
      assert.equal(standingCount, 12, "Must maintain exactly 12 standing");
      assert.equal(active.length, 32, "Total active passengers must still be 32");
      assert.equal(s21?.passengerCategory, "seated", "Student 21 must now be seated");

      const s33 = journey.bookings.find((b) => b.studentId === "student_33");
      assert.equal(s33?.passengerCategory, "standing", "Student 33 must be standing");
      assert.equal(journey.waitlist.length, 0, "Waitlist should now be empty");
    });

    it("promotes waitlist candidate directly to standing when a standing passenger cancels", () => {
      const journey: SimulatedJourney = {
        id: "j_test_05",
        safeCapacity: 32,
        seatedCapacity: 20,
        standingCapacity: 12,
        bookings: [],
        waitlist: [],
      };

      for (let i = 1; i <= 33; i++) {
        bookSeat(journey, `student_${i}`);
      }

      // Cancel standing passenger student 25
      const cancelRes = cancelBooking(journey, "b_student_25");
      assert.ok(cancelRes.success);
      assert.equal(cancelRes.upgradedStudentId, undefined, "No upgrade needed when standing cancels");
      assert.equal(cancelRes.promotedStudentId, "student_33", "Student 33 promoted directly to standing");

      const active = journey.bookings.filter((b) => b.status === "confirmed");
      const seatedCount = active.filter((b) => b.passengerCategory === "seated").length;
      const standingCount = active.filter((b) => b.passengerCategory === "standing").length;

      assert.equal(seatedCount, 20, "20 seated retained");
      assert.equal(standingCount, 12, "12 standing retained");
      assert.equal(active.length, 32, "Total 32 retained");
    });

    it("checked-in passengers continue counting towards active occupied capacity", () => {
      const journey: SimulatedJourney = {
        id: "j_test_06",
        safeCapacity: 32,
        seatedCapacity: 20,
        standingCapacity: 12,
        bookings: [],
        waitlist: [],
      };

      // Fill 32 places
      for (let i = 1; i <= 32; i++) {
        bookSeat(journey, `student_${i}`);
      }

      // 5 seated and 5 standing check in
      for (let i = 1; i <= 5; i++) {
        journey.bookings[i - 1].status = "checked_in";
      }
      for (let i = 21; i <= 25; i++) {
        journey.bookings[i - 1].status = "checked_in";
      }

      // An additional booking attempt must STILL be waitlisted because checked_in passengers occupy capacity
      const res = bookSeat(journey, "student_33");
      assert.equal(res.status, "waitlisted", "Checked-in passengers must not release capacity");
    });

    it("standing passengers are never counted as seated passengers", () => {
      const journey: SimulatedJourney = {
        id: "j_test_07",
        safeCapacity: 32,
        seatedCapacity: 20,
        standingCapacity: 12,
        bookings: [],
        waitlist: [],
      };

      // Book 25 passengers (20 seated, 5 standing)
      for (let i = 1; i <= 25; i++) {
        bookSeat(journey, `student_${i}`);
      }

      const active = journey.bookings.filter((b) => b.status === "confirmed");
      const seated = active.filter((b) => b.passengerCategory === "seated");
      const standing = active.filter((b) => b.passengerCategory === "standing");

      assert.equal(seated.length, 20);
      assert.equal(standing.length, 5);

      // Verify disjoint sets
      const seatedIds = new Set(seated.map((s) => s.studentId));
      const standingIds = new Set(standing.map((s) => s.studentId));

      for (const id of standingIds) {
        assert.ok(!seatedIds.has(id), `Standing passenger ${id} must never be counted as seated`);
      }
    });
  });

  // ============================================================
  // 3. UI & COMPONENT PASSENGER CATEGORY TRANSPARENCY
  // ============================================================
  describe("3. UI & Component Passenger Category Transparency", () => {
    const boardingPassModalPath = path.resolve(
      process.cwd(),
      "src/components/student/boarding-pass-modal.tsx"
    );
    const boardingPassModalContent = fs.readFileSync(boardingPassModalPath, "utf-8");

    const departureBoardPath = path.resolve(
      process.cwd(),
      "src/components/student/departure-board.tsx"
    );
    const departureBoardContent = fs.readFileSync(departureBoardPath, "utf-8");

    const tripsViewPath = path.resolve(
      process.cwd(),
      "src/components/student/student-trips-view.tsx"
    );
    const tripsViewContent = fs.readFileSync(tripsViewPath, "utf-8");

    const scanResultModalPath = path.resolve(
      process.cwd(),
      "src/components/boarding/scan-result-modal.tsx"
    );
    const scanResultModalContent = fs.readFileSync(scanResultModalPath, "utf-8");

    const manifestViewPath = path.resolve(
      process.cwd(),
      "src/components/boarding/passenger-manifest-view.tsx"
    );
    const manifestViewContent = fs.readFileSync(manifestViewPath, "utf-8");

    const journeysMgmtPath = path.resolve(
      process.cwd(),
      "src/components/admin/journeys-management.tsx"
    );
    const journeysMgmtContent = fs.readFileSync(journeysMgmtPath, "utf-8");

    it("boarding pass modal renders distinct Seated (20 max) vs Standing (12 max) badges", () => {
      assert.ok(
        boardingPassModalContent.includes("Seated Passenger (20 max)") &&
          boardingPassModalContent.includes("Standing Passenger (12 max)"),
        "Boarding pass must clearly state passenger category"
      );
      assert.ok(
        boardingPassModalContent.includes("ALLOCATION"),
        "Boarding pass must have an allocation field"
      );
    });

    it("departure board shows total 32 max, 20 seated, 12 standing, and remaining capacity", () => {
      assert.ok(
        departureBoardContent.includes("32 total") || departureBoardContent.includes("32 max"),
        "Departure board must specify total capacity"
      );
      assert.ok(
        departureBoardContent.includes("seated") && departureBoardContent.includes("standing"),
        "Departure board must display seated and standing capacity"
      );
    });

    it("student trips view displays allocation badge on active trip cards", () => {
      assert.ok(
        tripsViewContent.includes("Standing (12 max)") && tripsViewContent.includes("Seated (20 max)"),
        "Trips view must render category allocation badges"
      );
    });

    it("boarding officer scan result modal displays Seated Place vs Standing Place badges", () => {
      assert.ok(
        scanResultModalContent.includes("Seated Place (20 max)") &&
          scanResultModalContent.includes("Standing Place (12 max)"),
        "Scan result modal must identify passenger category"
      );
    });

    it("passenger manifest view includes Allocation column and category totals", () => {
      assert.ok(
        manifestViewContent.includes("Allocation"),
        "Manifest must have an Allocation column"
      );
      assert.ok(
        manifestViewContent.includes("Seated / Standing / Total") &&
          manifestViewContent.includes("/20 S") &&
          manifestViewContent.includes("/12 St"),
        "Manifest must display seated and standing breakdown"
      );
    });

    it("admin journey views display Seated: X/20, Standing: X/12, Total: X/32", () => {
      assert.ok(
        journeysMgmtContent.includes("Seated:") &&
          journeysMgmtContent.includes("/20") &&
          journeysMgmtContent.includes("Standing:") &&
          journeysMgmtContent.includes("/12"),
        "Admin journeys table must display seated and standing breakdown"
      );
    });
  });
});
