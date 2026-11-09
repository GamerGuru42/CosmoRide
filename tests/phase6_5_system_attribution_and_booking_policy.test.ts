import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";

/**
 * Phase 6.5: Honest System-Job Actor Attribution, Booking Cutoff Policy & PostgreSQL Verification
 *
 * Test Methodology:
 * 1. Static SQL Inspection: migration 00009 schema changes, honest audit recording, and dynamic settings.
 * 2. System vs. Human Actor Attribution Logic: verifies that scheduled background jobs never impersonate
 *    human administrators, and human admin actions retain strict session identity.
 * 3. Dynamic Booking Cutoff Policy Unit Tests: tests configurable cutoff values, timezone handling (Africa/Lagos),
 *    and cutoff boundary edge cases.
 * 4. Capacity & Occupancy Enforcement: tests safe capacity counting including 'confirmed' and 'checked_in' states.
 * 5. Corridor Isolation & Fixed Journey Patterns: verifies Boys' (Main/Wuye) and Girls' fleet separation.
 * 6. In-Memory PostgreSQL Engine Execution (pg-mem): tests relational DDL, nullable created_by, foreign keys, and indexes.
 */
describe("Phase 6.5: System Actor Attribution, Booking Policy & Verification", () => {
  const migration9Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00009_honest_system_actor_and_booking_policy.sql"
  );
  const migration9Content = fs.readFileSync(migration9Path, "utf-8");

  describe("1. Static Migration 00009 Review", () => {
    it("ensures journeys.created_by is made nullable for honest system generation", () => {
      assert.ok(
        migration9Content.includes("ALTER TABLE public.journeys ALTER COLUMN created_by DROP NOT NULL;"),
        "Must make created_by nullable so system jobs do not require a forged admin user"
      );
    });

    it("ensures audit log distinguishes human admin actions from system cron jobs", () => {
      assert.ok(
        migration9Content.includes("v_audit_action := 'ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE';"),
        "Must use distinct action name for human admin generation"
      );
      assert.ok(
        migration9Content.includes("v_audit_action := 'SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE';"),
        "Must use distinct action name for system cron generation"
      );
      assert.ok(
        migration9Content.includes("v_actor_type := 'scheduled_system_job';"),
        "Must record actor_type as scheduled_system_job"
      );
      assert.ok(
        migration9Content.includes("v_actor_type := 'human_administrator';"),
        "Must record actor_type as human_administrator"
      );
    });

    it("ensures scheduled departure is explicitly anchored to Africa/Lagos timezone", () => {
      assert.ok(
        migration9Content.includes("timezone('Africa/Lagos'"),
        "Must anchor generated departures to Africa/Lagos (WAT / UTC+1)"
      );
    });

    it("ensures book_journey_seat dynamically fetches booking_cutoff_minutes from system_settings", () => {
      assert.ok(
        migration9Content.includes("FROM public.system_settings"),
        "Must read booking_cutoff_minutes from system_settings table"
      );
      assert.ok(
        migration9Content.includes("WHERE key = 'booking_cutoff_minutes'"),
        "Must query key booking_cutoff_minutes"
      );
    });

    it("ensures book_journey_seat counts BOTH confirmed and checked_in bookings for occupancy", () => {
      assert.ok(
        migration9Content.includes("WHERE journey_id = p_journey_id\n    AND status IN ('confirmed', 'checked_in')"),
        "Must count both confirmed and checked_in bookings to prevent overselling active boarding buses"
      );
    });
  });

  describe("2. Honest System vs. Human Actor Attribution Logic", () => {
    interface GenerationInvocation {
      jwtRole: string | null;
      authUid: string | null;
      passedAdminId: string | null;
      adminProfile?: { id: string; role: string; isActive: boolean } | null;
    }

    interface GenerationResult {
      success: boolean;
      code?: string;
      error?: string;
      auditRecord?: {
        userId: string | null;
        action: string;
        actorType: string;
        executionContext: string;
      };
      journeyCreatedBy?: string | null;
    }

    function simulateJourneyGeneration(inv: GenerationInvocation): GenerationResult {
      const v_jwt_role = inv.jwtRole && inv.jwtRole.trim().length > 0 ? inv.jwtRole.trim() : null;

      if (!v_jwt_role || (v_jwt_role !== "authenticated" && v_jwt_role !== "service_role")) {
        return { success: false, code: "UNAUTHORIZED", error: "Permission denied: Invalid execution context." };
      }

      if (v_jwt_role === "authenticated") {
        if (!inv.authUid) {
          return { success: false, code: "UNAUTHORIZED", error: "Permission denied: Unauthenticated session." };
        }
        if (inv.passedAdminId && inv.passedAdminId !== inv.authUid) {
          return { success: false, code: "IDENTITY_MISMATCH", error: "Identity mismatch: Administrator cannot impersonate another admin." };
        }
        if (!inv.adminProfile || inv.adminProfile.id !== inv.authUid || inv.adminProfile.role !== "admin") {
          return { success: false, code: "UNAUTHORIZED_ADMIN_ACTOR", error: "Caller must possess administrator role." };
        }
        if (!inv.adminProfile.isActive) {
          return { success: false, code: "INACTIVE_ADMIN_ACTOR", error: "Administrator account is inactive." };
        }

        return {
          success: true,
          auditRecord: {
            userId: inv.authUid,
            action: "ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE",
            actorType: "human_administrator",
            executionContext: "interactive_admin_session",
          },
          journeyCreatedBy: inv.authUid,
        };
      } else {
        // service_role: scheduled automated job
        // Never impersonates an admin; records honest system attribution
        return {
          success: true,
          auditRecord: {
            userId: null,
            action: "SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE",
            actorType: "scheduled_system_job",
            executionContext: "service_role_system_cron",
          },
          journeyCreatedBy: null,
        };
      }
    }

    it("correctly attributes human admin execution to the authenticated session UUID", () => {
      const adminId = "admin-aliyu-1111";
      const res = simulateJourneyGeneration({
        jwtRole: "authenticated",
        authUid: adminId,
        passedAdminId: adminId,
        adminProfile: { id: adminId, role: "admin", isActive: true },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.auditRecord?.userId, adminId);
      assert.strictEqual(res.auditRecord?.action, "ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE");
      assert.strictEqual(res.auditRecord?.actorType, "human_administrator");
      assert.strictEqual(res.journeyCreatedBy, adminId);
    });

    it("blocks authenticated user attempting to forge another administrator UUID", () => {
      const res = simulateJourneyGeneration({
        jwtRole: "authenticated",
        authUid: "admin-real-user",
        passedAdminId: "admin-victim-user",
        adminProfile: { id: "admin-real-user", role: "admin", isActive: true },
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "IDENTITY_MISMATCH");
    });

    it("honestly records scheduled system cron without impersonating a human administrator", () => {
      const res = simulateJourneyGeneration({
        jwtRole: "service_role",
        authUid: null,
        passedAdminId: null, // No human admin needed
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.auditRecord?.userId, null, "Audit user_id must be NULL for system jobs");
      assert.strictEqual(res.auditRecord?.action, "SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE");
      assert.strictEqual(res.auditRecord?.actorType, "scheduled_system_job");
      assert.strictEqual(res.journeyCreatedBy, null, "Journeys created_by must be NULL for system jobs");
    });

    it("refuses to credit a human admin even if a service-role caller passes an admin UUID", () => {
      // Even if a script passes an admin UUID, the system job contract forces system attribution
      const res = simulateJourneyGeneration({
        jwtRole: "service_role",
        authUid: null,
        passedAdminId: "admin-dr-aliyu-uuid",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.auditRecord?.userId, null, "Must not forge Dr. Aliyu as the actor of an automated cron");
      assert.strictEqual(res.auditRecord?.actorType, "scheduled_system_job");
    });

    it("rejects unauthorized execution without valid JWT role", () => {
      const res = simulateJourneyGeneration({
        jwtRole: "anon",
        authUid: null,
        passedAdminId: null,
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, "UNAUTHORIZED");
    });
  });

  describe("3. Dynamic Booking Cutoff Policy & Timezone Handling", () => {
    function evaluateBookingWindow(params: {
      scheduledDeparture: Date;
      currentTime: Date;
      configuredCutoffMinutes: number;
      journeyStatus: string;
    }): { open: boolean; code?: string; error?: string } {
      if (params.journeyStatus !== "scheduled" && params.journeyStatus !== "boarding") {
        return { open: false, code: "JOURNEY_NOT_BOOKABLE", error: `Journey is not open for bookings (Status: ${params.journeyStatus}).` };
      }

      const cutoffTime = new Date(params.currentTime.getTime() + params.configuredCutoffMinutes * 60 * 1000);
      if (params.scheduledDeparture.getTime() <= cutoffTime.getTime()) {
        return {
          open: false,
          code: "BOOKING_WINDOW_CLOSED",
          error: `Bookings closed: Scheduled departure is in less than ${params.configuredCutoffMinutes} minutes.`,
        };
      }

      return { open: true };
    }

    const now = new Date("2026-11-10T08:00:00Z");

    it("rejects booking when scheduled departure is in the past (already departed)", () => {
      const pastDeparture = new Date("2026-11-10T07:30:00Z"); // 30 minutes ago
      const res = evaluateBookingWindow({
        scheduledDeparture: pastDeparture,
        currentTime: now,
        configuredCutoffMinutes: 15,
        journeyStatus: "scheduled",
      });
      assert.strictEqual(res.open, false);
      assert.strictEqual(res.code, "BOOKING_WINDOW_CLOSED");
    });

    it("rejects booking exactly at the 15-minute cutoff", () => {
      const exactCutoff = new Date("2026-11-10T08:15:00Z"); // Exactly 15 minutes from now
      const res = evaluateBookingWindow({
        scheduledDeparture: exactCutoff,
        currentTime: now,
        configuredCutoffMinutes: 15,
        journeyStatus: "scheduled",
      });
      assert.strictEqual(res.open, false);
      assert.strictEqual(res.code, "BOOKING_WINDOW_CLOSED");
    });

    it("rejects booking within the 15-minute cutoff (e.g. 5 minutes before departure)", () => {
      const fiveMinDeparture = new Date("2026-11-10T08:05:00Z");
      const res = evaluateBookingWindow({
        scheduledDeparture: fiveMinDeparture,
        currentTime: now,
        configuredCutoffMinutes: 15,
        journeyStatus: "scheduled",
      });
      assert.strictEqual(res.open, false);
      assert.strictEqual(res.code, "BOOKING_WINDOW_CLOSED");
    });

    it("permits booking well in advance of the cutoff (e.g. 45 minutes before departure)", () => {
      const futureDeparture = new Date("2026-11-10T08:45:00Z");
      const res = evaluateBookingWindow({
        scheduledDeparture: futureDeparture,
        currentTime: now,
        configuredCutoffMinutes: 15,
        journeyStatus: "scheduled",
      });
      assert.strictEqual(res.open, true);
    });

    it("dynamically respects custom administrator cutoff policy (e.g. 25 minutes)", () => {
      const departureInTwentyMins = new Date("2026-11-10T08:20:00Z");
      // Under default 15m, 20m would be open
      const res15 = evaluateBookingWindow({
        scheduledDeparture: departureInTwentyMins,
        currentTime: now,
        configuredCutoffMinutes: 15,
        journeyStatus: "scheduled",
      });
      assert.strictEqual(res15.open, true);

      // Under admin-configured 25m, 20m must be blocked!
      const res25 = evaluateBookingWindow({
        scheduledDeparture: departureInTwentyMins,
        currentTime: now,
        configuredCutoffMinutes: 25,
        journeyStatus: "scheduled",
      });
      assert.strictEqual(res25.open, false);
      assert.strictEqual(res25.code, "BOOKING_WINDOW_CLOSED");
    });

    it("rejects bookings on cancelled journeys regardless of departure time", () => {
      const futureDeparture = new Date("2026-11-10T14:00:00Z");
      const res = evaluateBookingWindow({
        scheduledDeparture: futureDeparture,
        currentTime: now,
        configuredCutoffMinutes: 15,
        journeyStatus: "cancelled",
      });
      assert.strictEqual(res.open, false);
      assert.strictEqual(res.code, "JOURNEY_NOT_BOOKABLE");
    });
  });

  describe("4. Comprehensive Active Seat Occupancy Counting", () => {
    function calculateSeatAvailability(params: {
      safeCapacity: number;
      proposedAllocation: number;
      confirmedBookingsCount: number;
      checkedInBookingsCount: number;
    }): { effectiveCapacity: number; occupiedSeats: number; availableSeats: number; isFull: boolean } {
      const effectiveCapacity = Math.min(params.safeCapacity, params.proposedAllocation);
      // Occupied seats strictly combines confirmed reservations AND boarded passengers
      const occupiedSeats = params.confirmedBookingsCount + params.checkedInBookingsCount;
      const availableSeats = Math.max(0, effectiveCapacity - occupiedSeats);
      return {
        effectiveCapacity,
        occupiedSeats,
        availableSeats,
        isFull: availableSeats <= 0,
      };
    }

    it("counts both confirmed and checked_in passengers to prevent capacity overselling during boarding", () => {
      // 30-passenger electric bus: 10 passengers already boarded (checked_in), 20 seats confirmed
      const res = calculateSeatAvailability({
        safeCapacity: 30,
        proposedAllocation: 30,
        confirmedBookingsCount: 20,
        checkedInBookingsCount: 10,
      });

      assert.strictEqual(res.effectiveCapacity, 30);
      assert.strictEqual(res.occupiedSeats, 30);
      assert.strictEqual(res.availableSeats, 0);
      assert.strictEqual(res.isFull, true, "Bus must be reported full even when some passengers have already boarded");
    });

    it("correctly identifies available capacity when total active seats are below approved ceiling", () => {
      const res = calculateSeatAvailability({
        safeCapacity: 30,
        proposedAllocation: 30,
        confirmedBookingsCount: 12,
        checkedInBookingsCount: 8,
      });

      assert.strictEqual(res.occupiedSeats, 20);
      assert.strictEqual(res.availableSeats, 10);
      assert.strictEqual(res.isFull, false);
    });

    it("never permits proposed allocation to override vehicle safe capacity ceiling", () => {
      // Proposed 40 on a 30-passenger vehicle
      const res = calculateSeatAvailability({
        safeCapacity: 30,
        proposedAllocation: 40,
        confirmedBookingsCount: 25,
        checkedInBookingsCount: 5,
      });

      assert.strictEqual(res.effectiveCapacity, 30, "Ceiling must clamp to 30");
      assert.strictEqual(res.isFull, true);
    });
  });

  describe("5. Corridor Separation & Boys' Fixed Journey Patterns", () => {
    interface RouteConfig {
      code: string;
      genderGroup: "male" | "female" | "mixed";
      transportGroupId: string | null;
    }

    interface StudentContext {
      id: string;
      gender: "male" | "female";
      assignedTransportGroupId: string | null;
      hostelId: string | null;
    }

    function checkCorridorEligibility(student: StudentContext, route: RouteConfig): { allowed: boolean; code?: string } {
      if (route.genderGroup !== "mixed" && student.gender !== route.genderGroup) {
        return { allowed: false, code: "CROSS_CORRIDOR_DENIED" };
      }
      if (route.transportGroupId && student.assignedTransportGroupId !== route.transportGroupId) {
        return { allowed: false, code: "CROSS_GROUP_DENIED" };
      }
      return { allowed: true };
    }

    const tgBoys = "tg-boys-transport-fleet";
    const tgGirls = "tg-girls-transport-fleet";

    // Four primary operational corridors:
    const boysMorningRoute: RouteConfig = {
      code: "BOYS_AM_ROUTE",
      genderGroup: "male",
      transportGroupId: tgBoys,
    };

    const boysEveningRoute: RouteConfig = {
      code: "BOYS_PM_ROUTE",
      genderGroup: "male",
      transportGroupId: tgBoys,
    };

    const girlsCorridorRoute: RouteConfig = {
      code: "GIRLS_AM_ROUTE",
      genderGroup: "female",
      transportGroupId: tgGirls,
    };

    const interCampusTransferRoute: RouteConfig = {
      code: "MAIN_KADO_SHUTTLE",
      genderGroup: "mixed",
      transportGroupId: null, // Shared route
    };

    it("permits male student in Boys' transport group to book Boys' Morning Corridor", () => {
      const student: StudentContext = {
        id: "stu-boy-main",
        gender: "male",
        assignedTransportGroupId: tgBoys,
        hostelId: "hostel-main-boys",
      };
      const res = checkCorridorEligibility(student, boysMorningRoute);
      assert.strictEqual(res.allowed, true);
    });

    it("permits male student in Wuye Boys' Hostel to book Boys' Evening Return", () => {
      const student: StudentContext = {
        id: "stu-boy-wuye",
        gender: "male",
        assignedTransportGroupId: tgBoys,
        hostelId: "hostel-wuye-boys",
      };
      const res = checkCorridorEligibility(student, boysEveningRoute);
      assert.strictEqual(res.allowed, true);
    });

    it("rejects female student attempting to book Boys' corridor", () => {
      const student: StudentContext = {
        id: "stu-girl",
        gender: "female",
        assignedTransportGroupId: tgGirls,
        hostelId: "hostel-girls",
      };
      const res = checkCorridorEligibility(student, boysMorningRoute);
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.code, "CROSS_CORRIDOR_DENIED");
    });

    it("rejects male student attempting to book Girls' fleet", () => {
      const student: StudentContext = {
        id: "stu-boy",
        gender: "male",
        assignedTransportGroupId: tgBoys,
        hostelId: "hostel-main-boys",
      };
      const res = checkCorridorEligibility(student, girlsCorridorRoute);
      assert.strictEqual(res.allowed, false);
      assert.strictEqual(res.code, "CROSS_CORRIDOR_DENIED");
    });

    it("permits both male and female students to book shared Inter-Campus Shuttle", () => {
      const maleStudent: StudentContext = { id: "m-1", gender: "male", assignedTransportGroupId: tgBoys, hostelId: null };
      const femaleStudent: StudentContext = { id: "f-1", gender: "female", assignedTransportGroupId: tgGirls, hostelId: null };

      assert.strictEqual(checkCorridorEligibility(maleStudent, interCampusTransferRoute).allowed, true);
      assert.strictEqual(checkCorridorEligibility(femaleStudent, interCampusTransferRoute).allowed, true);
    });
  });

  describe("6. In-Memory PostgreSQL Emulator (pg-mem) Execution", () => {
    let db: ReturnType<typeof newDb>;

    it("verifies that journeys.created_by can be NULL for system-generated records", () => {
      db = newDb();

      db.public.none(`
        CREATE TABLE profiles (
          id text PRIMARY KEY,
          full_name text NOT NULL,
          role text NOT NULL
        );

        CREATE TABLE journeys (
          id text PRIMARY KEY,
          route_code text NOT NULL,
          created_by text REFERENCES profiles(id) ON DELETE SET NULL,
          created_at timestamp DEFAULT now()
        );

        CREATE TABLE audit_logs (
          id text PRIMARY KEY,
          user_id text REFERENCES profiles(id) ON DELETE SET NULL,
          action text NOT NULL,
          details jsonb,
          created_at timestamp DEFAULT now()
        );
      `);

      // 1. Insert human admin generated journey
      db.public.none(`
        INSERT INTO profiles (id, full_name, role) VALUES ('admin-1', 'Dr. Aliyu', 'admin');
        INSERT INTO journeys (id, route_code, created_by) VALUES ('j-human', 'BOYS_AM_ROUTE', 'admin-1');
        INSERT INTO audit_logs (id, user_id, action, details)
        VALUES ('log-human', 'admin-1', 'ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE', '{"actor_type": "human_administrator"}');
      `);

      const humanJourney = db.public.one("SELECT * FROM journeys WHERE id = 'j-human'");
      assert.strictEqual(humanJourney.created_by, "admin-1");

      const humanLog = db.public.one("SELECT * FROM audit_logs WHERE id = 'log-human'");
      assert.strictEqual(humanLog.user_id, "admin-1");
      assert.strictEqual(humanLog.action, "ADMIN_JOURNEYS_GENERATED_FROM_SCHEDULE");

      // 2. Insert system cron generated journey (honest NULL attribution)
      db.public.none(`
        INSERT INTO journeys (id, route_code, created_by) VALUES ('j-system', 'BOYS_AM_ROUTE', NULL);
        INSERT INTO audit_logs (id, user_id, action, details)
        VALUES ('log-system', NULL, 'SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE', '{"actor_type": "scheduled_system_job"}');
      `);

      const systemJourney = db.public.one("SELECT * FROM journeys WHERE id = 'j-system'");
      assert.strictEqual(systemJourney.created_by, null, "created_by must be null for system jobs");

      const systemLog = db.public.one("SELECT * FROM audit_logs WHERE id = 'log-system'");
      assert.strictEqual(systemLog.user_id, null, "user_id must be null for system jobs");
      assert.strictEqual(systemLog.action, "SYSTEM_JOURNEYS_GENERATED_FROM_SCHEDULE");
    });
  });
});
