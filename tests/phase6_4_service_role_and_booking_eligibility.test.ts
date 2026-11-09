import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";

/**
 * Phase 6.4: Service-Role Trust Boundary, Least-Privilege Grants & Student Booking Eligibility Hardening
 *
 * Test Methodology:
 * 1. Static Migration Review: Inspects 00008 SQL definitions, revokes, grants, and parameter alignments.
 * 2. Actor Anti-Spoofing & Service-Role Attribution Unit Tests: Rigorous logic checks simulating RPC security gates.
 * 3. Representative-Assisted Driver Operations (Mode B): Verifies officer attribution and corridor checks.
 * 4. Comprehensive Student Booking Eligibility Matrix: Evaluates gender corridors, transport groups, account status, stops, and capacities.
 * 5. In-Memory PostgreSQL Engine Execution (pg-mem): Validates relational tables, partial unique index semantics, and constraints.
 */
describe("Phase 6.4: Service-Role Trust Boundary & Booking Eligibility Audit", () => {
  const migration8Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00008_service_role_boundaries_and_booking_eligibility.sql"
  );
  const migration8Content = fs.readFileSync(migration8Path, "utf-8");

  describe("1. Static Inspection of Migration 00008 Permissions & Grants", () => {
    it("ensures service_role is revoked from all user-initiated RPCs", () => {
      const revokedFromServiceRole = [
        "REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.cancel_booking_and_promote(UUID, UUID, TEXT) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.verify_and_board_passenger(TEXT, UUID, UUID, public.boarding_method, TEXT) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.close_and_depart_journey(UUID, UUID, TEXT) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.record_vehicle_readiness(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, INTEGER, BOOLEAN, TEXT, BOOLEAN) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.record_journey_delay_with_notifications(UUID, UUID, INTEGER, TEXT, BOOLEAN) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.record_journey_departure_safe(UUID, UUID, BOOLEAN, TEXT) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.record_journey_arrival_safe(UUID, UUID, BOOLEAN, TEXT) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.admin_cancel_journey(UUID, UUID, TEXT) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.admin_update_system_setting(UUID, TEXT, JSONB, TEXT) FROM service_role;",
        "REVOKE EXECUTE ON FUNCTION public.admin_update_incident_status(UUID, UUID, public.incident_status, TEXT) FROM service_role;",
        "REVOKE ALL ON FUNCTION public.record_journey_stop_update FROM service_role;",
      ];

      for (const statement of revokedFromServiceRole) {
        assert.ok(
          migration8Content.includes(statement),
          `Missing expected service_role revoke: ${statement}`
        );
      }
    });

    it("ensures service_role is retained ONLY for legitimate background journey generation", () => {
      assert.ok(
        migration8Content.includes(
          "GRANT EXECUTE ON FUNCTION public.admin_generate_journeys_from_schedules(UUID, DATE, UUID) TO service_role;"
        ),
        "admin_generate_journeys_from_schedules must be granted to service_role"
      );
    });

    it("ensures parameter types alignment on record_journey_stop_update for authenticated", () => {
      assert.ok(
        migration8Content.includes(
          "GRANT EXECUTE ON FUNCTION public.record_journey_stop_update(UUID, UUID, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;"
        ),
        "record_journey_stop_update must match exact signature (UUID, UUID, UUID, TEXT, TEXT, BOOLEAN)"
      );
    });

    it("ensures stateful partial unique index is established on active bookings", () => {
      assert.ok(
        migration8Content.includes("DROP CONSTRAINT IF EXISTS bookings_journey_id_student_id_key;"),
        "Must drop table-wide unique constraint to allow historical records"
      );
      assert.ok(
        migration8Content.includes("CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_unique_idx"),
        "Must create active unique index"
      );
      assert.ok(
        migration8Content.includes("WHERE status IN ('confirmed', 'checked_in')"),
        "Must restrict unique index to active confirmed and checked_in statuses"
      );
    });

    it("ensures book_journey_seat independently validates student role, active account, and route stops", () => {
      assert.ok(
        migration8Content.includes("v_student.role <> 'student'"),
        "Must independently check student role"
      );
      assert.ok(
        migration8Content.includes("NOT v_student.is_active"),
        "Must independently check student account active status"
      );
      assert.ok(
        migration8Content.includes("FROM public.route_stops"),
        "Must independently verify boarding stop belongs to route_stops"
      );
      assert.ok(
        migration8Content.includes("v_journey.route_gender IN ('male', 'female')"),
        "Must independently check gender corridor separation"
      );
      assert.ok(
        migration8Content.includes("v_journey.route_transport_group_id IS NOT NULL"),
        "Must independently check transport group corridor assignment"
      );
    });
  });

  describe("2. Browser-Submitted Actor Spoofing & Identity Verification", () => {
    function verifyCallerIdentity(params: {
      jwtRole: string | null;
      authUid: string | null;
      passedActorId: string | null;
    }): { success: boolean; code?: string; actorId?: string; error?: string } {
      const v_jwt_role = params.jwtRole && params.jwtRole.trim().length > 0 ? params.jwtRole.trim() : null;

      if (!v_jwt_role || (v_jwt_role !== "authenticated" && v_jwt_role !== "service_role")) {
        return { success: false, code: "UNAUTHORIZED", error: "Permission denied: Invalid or untrusted execution context." };
      }

      if (v_jwt_role === "authenticated") {
        if (!params.authUid) {
          return { success: false, code: "UNAUTHORIZED", error: "Permission denied: Unauthenticated session." };
        }
        if (params.passedActorId && params.passedActorId !== params.authUid) {
          return { success: false, code: "IDENTITY_MISMATCH", error: "Identity mismatch: Authenticated user cannot act on behalf of another user." };
        }
        return { success: true, actorId: params.authUid };
      } else {
        if (!params.passedActorId) {
          return { success: false, code: "MISSING_ACTOR", error: "Service role execution requires explicit actor attribution." };
        }
        return { success: true, actorId: params.passedActorId };
      }
    }

    it("rejects browser submitting someone else's UUID in student booking", () => {
      const res = verifyCallerIdentity({
        jwtRole: "authenticated",
        authUid: "real-student-uuid-1111",
        passedActorId: "spoofed-student-uuid-9999",
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "IDENTITY_MISMATCH");
    });

    it("rejects browser submitting someone else's UUID in boarding officer scan", () => {
      const res = verifyCallerIdentity({
        jwtRole: "authenticated",
        authUid: "real-officer-uuid-2222",
        passedActorId: "spoofed-officer-uuid-8888",
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "IDENTITY_MISMATCH");
    });

    it("accepts valid authenticated call where actor matches auth.uid", () => {
      const res = verifyCallerIdentity({
        jwtRole: "authenticated",
        authUid: "valid-student-uuid-1111",
        passedActorId: "valid-student-uuid-1111",
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.actorId, "valid-student-uuid-1111");
    });

    it("accepts call when passedActorId is null by safely deriving from auth.uid", () => {
      const res = verifyCallerIdentity({
        jwtRole: "authenticated",
        authUid: "valid-student-uuid-1111",
        passedActorId: null,
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.actorId, "valid-student-uuid-1111");
    });
  });

  describe("3. Service-Role Actor Attribution & Legitimate Background Operations", () => {
    interface ProfileRecord {
      id: string;
      role: "student" | "boarding_officer" | "driver" | "admin";
      isActive: boolean;
    }

    function simulateServiceRoleCronExecution(params: {
      jwtRole: string | null;
      passedAdminId: string | null;
      adminProfile: ProfileRecord | null;
    }): { success: boolean; code?: string; error?: string; context?: string } {
      if (params.jwtRole !== "service_role") {
        return { success: false, code: "UNAUTHORIZED", error: "Permission denied." };
      }
      if (!params.passedAdminId) {
        return { success: false, code: "MISSING_ACTOR", error: "Service role execution requires explicit admin actor attribution." };
      }
      if (!params.adminProfile || params.adminProfile.id !== params.passedAdminId) {
        return { success: false, code: "UNAUTHORIZED_ADMIN_ACTOR", error: "Attributed administrator profile not found." };
      }
      if (params.adminProfile.role !== "admin") {
        return { success: false, code: "UNAUTHORIZED_ADMIN_ACTOR", error: "Permission denied: Attributed actor must possess administrator role." };
      }
      if (!params.adminProfile.isActive) {
        return { success: false, code: "INACTIVE_ADMIN_ACTOR", error: "Permission denied: Administrator account is inactive." };
      }

      return {
        success: true,
        context: "service_role_system_cron",
      };
    }

    it("rejects service-role execution without explicit actor attribution", () => {
      const res = simulateServiceRoleCronExecution({
        jwtRole: "service_role",
        passedAdminId: null,
        adminProfile: null,
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "MISSING_ACTOR");
    });

    it("rejects service-role execution attempting to attribute action to a student", () => {
      const studentProfile: ProfileRecord = {
        id: "student-uuid-1",
        role: "student",
        isActive: true,
      };
      const res = simulateServiceRoleCronExecution({
        jwtRole: "service_role",
        passedAdminId: studentProfile.id,
        adminProfile: studentProfile,
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "UNAUTHORIZED_ADMIN_ACTOR");
    });

    it("rejects service-role execution if attributed administrator is inactive", () => {
      const inactiveAdmin: ProfileRecord = {
        id: "admin-uuid-retired",
        role: "admin",
        isActive: false,
      };
      const res = simulateServiceRoleCronExecution({
        jwtRole: "service_role",
        passedAdminId: inactiveAdmin.id,
        adminProfile: inactiveAdmin,
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "INACTIVE_ADMIN_ACTOR");
    });

    it("permits service-role background cron dispatch when attributed to valid active administrator", () => {
      const activeAdmin: ProfileRecord = {
        id: "admin-system-lead",
        role: "admin",
        isActive: true,
      };
      const res = simulateServiceRoleCronExecution({
        jwtRole: "service_role",
        passedAdminId: activeAdmin.id,
        adminProfile: activeAdmin,
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.context, "service_role_system_cron");
    });
  });

  describe("4. Representative-Assisted Driver Operations (Mode B)", () => {
    interface AssistedContext {
      callerId: string;
      callerRole: string;
      callerTransportGroupId: string | null;
      journeyTransportGroupId: string;
      isAssisted: boolean;
    }

    function validateAssistedOperation(ctx: AssistedContext): {
      success: boolean;
      recordedActorId?: string;
      code?: string;
      error?: string;
    } {
      if (ctx.callerRole === "admin") {
        return { success: true, recordedActorId: ctx.callerId };
      }
      if (ctx.callerRole !== "boarding_officer") {
        return { success: false, code: "UNAUTHORIZED", error: "Only boarding officers or administrators can perform assisted operations." };
      }
      if (!ctx.callerTransportGroupId || ctx.callerTransportGroupId !== ctx.journeyTransportGroupId) {
        return { success: false, code: "CROSS_GROUP_DENIED", error: "Cross-group restriction: You cannot perform operations outside your corridor." };
      }
      return { success: true, recordedActorId: ctx.callerId };
    }

    it("strictly records the authenticated representative as the actor during assisted driver actions", () => {
      const tgBoys = "tg-boys-corridor";
      const res = validateAssistedOperation({
        callerId: "hostel-rep-aliyu",
        callerRole: "boarding_officer",
        callerTransportGroupId: tgBoys,
        journeyTransportGroupId: tgBoys,
        isAssisted: true,
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.recordedActorId, "hostel-rep-aliyu");
    });

    it("prevents representative from assisting a driver in a foreign corridor", () => {
      const res = validateAssistedOperation({
        callerId: "hostel-rep-aliyu",
        callerRole: "boarding_officer",
        callerTransportGroupId: "tg-boys-corridor",
        journeyTransportGroupId: "tg-girls-corridor",
        isAssisted: true,
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "CROSS_GROUP_DENIED");
    });
  });

  describe("5. Complete Student Booking Eligibility Matrix", () => {
    interface StudentProfile {
      id: string;
      role: string;
      isActive: boolean;
      gender: "male" | "female" | null;
      hostelGender: "male" | "female" | null;
      assignedTransportGroupId: string | null;
      hostelTransportGroupId: string | null;
    }

    interface JourneyRouteContext {
      id: string;
      status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
      scheduledDeparture: Date;
      vehicleSafeCapacity: number;
      proposedAllocation: number;
      vehicleActive: boolean;
      routeActive: boolean;
      routeGender: "male" | "female" | "mixed";
      routeTransportGroupId: string | null;
      validStopIds: string[];
      confirmedBookingsCount: number;
      existingWaitlist: { studentId: string; position: number }[];
    }

    function evaluateBookingEligibility(
      student: StudentProfile,
      journey: JourneyRouteContext,
      boardingStopId: string,
      hasActiveBooking: boolean
    ): {
      eligible: boolean;
      status?: "confirmed" | "waitlist";
      code?: string;
      error?: string;
      waitlistPosition?: number;
    } {
      // 1. Student account checks
      if (!student.isActive) {
        return { eligible: false, code: "ACCOUNT_INACTIVE", error: "Student account is suspended or inactive." };
      }
      if (student.role !== "student") {
        return { eligible: false, code: "ROLE_NOT_STUDENT", error: "Only registered students are eligible to book passenger seats." };
      }

      // 2. Journey & Route checks
      if (!journey.vehicleActive) {
        return { eligible: false, code: "VEHICLE_INACTIVE", error: "Assigned vehicle is inactive." };
      }
      if (!journey.routeActive) {
        return { eligible: false, code: "ROUTE_INACTIVE", error: "Route is inactive." };
      }
      if (journey.status !== "scheduled" && journey.status !== "boarding") {
        return { eligible: false, code: "JOURNEY_NOT_BOOKABLE", error: `Journey is not open for bookings (Status: ${journey.status}).` };
      }

      // 3. Cutoff check (15 minutes)
      const now = new Date();
      if (journey.scheduledDeparture.getTime() <= now.getTime() + 15 * 60 * 1000) {
        return { eligible: false, code: "BOOKING_WINDOW_CLOSED", error: "Bookings closed: Scheduled departure in less than 15 minutes." };
      }

      // 4. Valid boarding stop
      if (!journey.validStopIds.includes(boardingStopId)) {
        return { eligible: false, code: "INVALID_BOARDING_STOP", error: "Selected pickup stop does not belong to this journey route." };
      }

      // 5. Gender corridor separation
      const effectiveGender = student.gender || student.hostelGender;
      if (journey.routeGender === "male" || journey.routeGender === "female") {
        if (effectiveGender && effectiveGender !== journey.routeGender) {
          return { eligible: false, code: "CROSS_CORRIDOR_DENIED", error: `Designated exclusively for ${journey.routeGender} students.` };
        }
        if (!effectiveGender) {
          return { eligible: false, code: "UNVERIFIED_CORRIDOR_PROFILE", error: "Unverified gender profile." };
        }
      }

      // 6. Transport group corridor isolation
      const effectiveGroup = student.assignedTransportGroupId || student.hostelTransportGroupId;
      if (journey.routeTransportGroupId) {
        if (!effectiveGroup || effectiveGroup !== journey.routeTransportGroupId) {
          return { eligible: false, code: "CROSS_GROUP_DENIED", error: "Not assigned to this transport corridor." };
        }
      }

      // 7. Duplicate active booking
      if (hasActiveBooking) {
        return { eligible: false, code: "DUPLICATE_BOOKING", error: "You already have an active seat or boarding pass." };
      }

      // 8. Safe capacity limit
      const effectiveCapacity = Math.min(journey.vehicleSafeCapacity, journey.proposedAllocation);
      if (journey.confirmedBookingsCount < effectiveCapacity) {
        return { eligible: true, status: "confirmed" };
      } else {
        // Waitlist
        const existingEntry = journey.existingWaitlist.find((w) => w.studentId === student.id);
        if (existingEntry) {
          return { eligible: true, status: "waitlist", waitlistPosition: existingEntry.position };
        }
        return { eligible: true, status: "waitlist", waitlistPosition: journey.existingWaitlist.length + 1 };
      }
    }

    const validFutureDeparture = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

    it("rejects inactive student account", () => {
      const student: StudentProfile = {
        id: "stu-inactive",
        role: "student",
        isActive: false,
        gender: "female",
        hostelGender: "female",
        assignedTransportGroupId: "tg-girls",
        hostelTransportGroupId: "tg-girls",
      };
      const journey: JourneyRouteContext = {
        id: "j-1",
        status: "scheduled",
        scheduledDeparture: validFutureDeparture,
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "female",
        routeTransportGroupId: "tg-girls",
        validStopIds: ["stop-1", "stop-2"],
        confirmedBookingsCount: 10,
        existingWaitlist: [],
      };
      const res = evaluateBookingEligibility(student, journey, "stop-1", false);
      assert.strictEqual(res.eligible, false);
      assert.strictEqual(res.code, "ACCOUNT_INACTIVE");
    });

    it("rejects boarding officer attempting to book a passenger seat", () => {
      const officer: StudentProfile = {
        id: "officer-1",
        role: "boarding_officer",
        isActive: true,
        gender: "male",
        hostelGender: "male",
        assignedTransportGroupId: "tg-boys",
        hostelTransportGroupId: "tg-boys",
      };
      const journey: JourneyRouteContext = {
        id: "j-1",
        status: "scheduled",
        scheduledDeparture: validFutureDeparture,
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "mixed",
        routeTransportGroupId: null,
        validStopIds: ["stop-1"],
        confirmedBookingsCount: 5,
        existingWaitlist: [],
      };
      const res = evaluateBookingEligibility(officer, journey, "stop-1", false);
      assert.strictEqual(res.eligible, false);
      assert.strictEqual(res.code, "ROLE_NOT_STUDENT");
    });

    it("rejects male student attempting to book female corridor departure", () => {
      const maleStudent: StudentProfile = {
        id: "stu-male",
        role: "student",
        isActive: true,
        gender: "male",
        hostelGender: "male",
        assignedTransportGroupId: "tg-boys",
        hostelTransportGroupId: "tg-boys",
      };
      const girlsJourney: JourneyRouteContext = {
        id: "j-girls",
        status: "scheduled",
        scheduledDeparture: validFutureDeparture,
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "female",
        routeTransportGroupId: "tg-girls",
        validStopIds: ["stop-girls-hostel", "stop-main-campus"],
        confirmedBookingsCount: 15,
        existingWaitlist: [],
      };
      const res = evaluateBookingEligibility(maleStudent, girlsJourney, "stop-girls-hostel", false);
      assert.strictEqual(res.eligible, false);
      assert.strictEqual(res.code, "CROSS_CORRIDOR_DENIED");
    });

    it("rejects student attempting to book with an invalid stop not on the route", () => {
      const femaleStudent: StudentProfile = {
        id: "stu-female",
        role: "student",
        isActive: true,
        gender: "female",
        hostelGender: "female",
        assignedTransportGroupId: "tg-girls",
        hostelTransportGroupId: "tg-girls",
      };
      const girlsJourney: JourneyRouteContext = {
        id: "j-girls",
        status: "scheduled",
        scheduledDeparture: validFutureDeparture,
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "female",
        routeTransportGroupId: "tg-girls",
        validStopIds: ["stop-girls-hostel", "stop-main-campus"],
        confirmedBookingsCount: 15,
        existingWaitlist: [],
      };
      const res = evaluateBookingEligibility(femaleStudent, girlsJourney, "unrelated-kado-stop", false);
      assert.strictEqual(res.eligible, false);
      assert.strictEqual(res.code, "INVALID_BOARDING_STOP");
    });

    it("rejects bookings when departure window is within 15 minutes", () => {
      const student: StudentProfile = {
        id: "stu-1",
        role: "student",
        isActive: true,
        gender: "male",
        hostelGender: "male",
        assignedTransportGroupId: "tg-boys",
        hostelTransportGroupId: "tg-boys",
      };
      const imminentlyDepartingJourney: JourneyRouteContext = {
        id: "j-imminent",
        status: "scheduled",
        scheduledDeparture: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes from now
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "mixed",
        routeTransportGroupId: null,
        validStopIds: ["stop-1"],
        confirmedBookingsCount: 10,
        existingWaitlist: [],
      };
      const res = evaluateBookingEligibility(student, imminentlyDepartingJourney, "stop-1", false);
      assert.strictEqual(res.eligible, false);
      assert.strictEqual(res.code, "BOOKING_WINDOW_CLOSED");
    });

    it("rejects bookings on cancelled or completed journeys", () => {
      const student: StudentProfile = {
        id: "stu-1",
        role: "student",
        isActive: true,
        gender: "male",
        hostelGender: "male",
        assignedTransportGroupId: "tg-boys",
        hostelTransportGroupId: "tg-boys",
      };
      const cancelledJourney: JourneyRouteContext = {
        id: "j-cancelled",
        status: "cancelled",
        scheduledDeparture: validFutureDeparture,
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "mixed",
        routeTransportGroupId: null,
        validStopIds: ["stop-1"],
        confirmedBookingsCount: 0,
        existingWaitlist: [],
      };
      const res = evaluateBookingEligibility(student, cancelledJourney, "stop-1", false);
      assert.strictEqual(res.eligible, false);
      assert.strictEqual(res.code, "JOURNEY_NOT_BOOKABLE");
    });

    it("prevents duplicate active booking on the same journey", () => {
      const student: StudentProfile = {
        id: "stu-1",
        role: "student",
        isActive: true,
        gender: "male",
        hostelGender: "male",
        assignedTransportGroupId: "tg-boys",
        hostelTransportGroupId: "tg-boys",
      };
      const journey: JourneyRouteContext = {
        id: "j-1",
        status: "scheduled",
        scheduledDeparture: validFutureDeparture,
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "mixed",
        routeTransportGroupId: null,
        validStopIds: ["stop-1"],
        confirmedBookingsCount: 10,
        existingWaitlist: [],
      };
      const res = evaluateBookingEligibility(student, journey, "stop-1", true); // Already has active booking
      assert.strictEqual(res.eligible, false);
      assert.strictEqual(res.code, "DUPLICATE_BOOKING");
    });

    it("places student on FIFO waiting list when safe capacity ceiling is met", () => {
      const student: StudentProfile = {
        id: "stu-waitlisted",
        role: "student",
        isActive: true,
        gender: "female",
        hostelGender: "female",
        assignedTransportGroupId: "tg-girls",
        hostelTransportGroupId: "tg-girls",
      };
      const fullJourney: JourneyRouteContext = {
        id: "j-full",
        status: "scheduled",
        scheduledDeparture: validFutureDeparture,
        vehicleSafeCapacity: 30,
        proposedAllocation: 30,
        vehicleActive: true,
        routeActive: true,
        routeGender: "female",
        routeTransportGroupId: "tg-girls",
        validStopIds: ["stop-girls"],
        confirmedBookingsCount: 30, // Max safe capacity reached
        existingWaitlist: [{ studentId: "other-student-1", position: 1 }],
      };
      const res = evaluateBookingEligibility(student, fullJourney, "stop-girls", false);
      assert.strictEqual(res.eligible, true);
      assert.strictEqual(res.status, "waitlist");
      assert.strictEqual(res.waitlistPosition, 2);
    });
  });

  describe("6. In-Memory PostgreSQL Emulator (pg-mem) Schema & Partial Unique Index", () => {
    let db: ReturnType<typeof newDb>;

    it("verifies partial unique index allows historical cancelled bookings while enforcing single active booking", () => {
      db = newDb();

      // Create schema mirroring PostgreSQL
      db.public.none(`
        CREATE TABLE bookings (
          id text PRIMARY KEY,
          journey_id text NOT NULL,
          student_id text NOT NULL,
          status text NOT NULL CHECK (status IN ('confirmed', 'waitlisted', 'checked_in', 'cancelled', 'no_show')),
          created_at timestamp DEFAULT now()
        );

        CREATE UNIQUE INDEX bookings_active_unique_idx
          ON bookings (journey_id, student_id)
          WHERE status IN ('confirmed', 'checked_in');
      `);

      // 1. Student books seat -> status = 'confirmed'
      db.public.none(`
        INSERT INTO bookings (id, journey_id, student_id, status)
        VALUES ('b-1', 'j-100', 'student-amina', 'confirmed');
      `);

      const activeBooking = db.public.one("SELECT * FROM bookings WHERE id = 'b-1'");
      assert.strictEqual(activeBooking.status, "confirmed");

      // 2. Second active booking for same student on same journey MUST fail due to unique index
      assert.throws(
        () => {
          db.public.none(`
            INSERT INTO bookings (id, journey_id, student_id, status)
            VALUES ('b-duplicate', 'j-100', 'student-amina', 'confirmed');
          `);
        },
        /unique/i,
        "Partial unique index must block duplicate active booking"
      );

      // 3. Student cancels booking -> status changes to 'cancelled'
      db.public.none(`
        UPDATE bookings SET status = 'cancelled' WHERE id = 'b-1';
      `);

      // 4. Now a second booking record with 'cancelled' or a new active booking CAN coexist in history
      db.public.none(`
        INSERT INTO bookings (id, journey_id, student_id, status)
        VALUES ('b-2-rebooked', 'j-100', 'student-amina', 'confirmed');
      `);

      const allBookings = db.public.many("SELECT * FROM bookings WHERE journey_id = 'j-100' AND student_id = 'student-amina' ORDER BY id ASC");
      assert.strictEqual(allBookings.length, 2);
      assert.strictEqual(allBookings[0].status, "cancelled");
      assert.strictEqual(allBookings[1].status, "confirmed");
    });
  });
});
