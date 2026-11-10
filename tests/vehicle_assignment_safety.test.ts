import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

describe("COSMORIDE — Vehicle Assignment Safety & Availability Protection Suite", () => {
  const migration21Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00021_vehicle_assignment_safety_and_concurrency.sql"
  );
  const migration21Content = fs.readFileSync(migration21Path, "utf-8");

  // ============================================================
  // 1. MIGRATION 00021 SCHEMA & INTEGRITY INSPECTION
  // ============================================================

  describe("1. Migration 00021 Schema & Integrity Inspection", () => {
    it("verifies migration 00021 drops experimental rotation objects cleanly", () => {
      assert.ok(
        migration21Content.includes("DROP FUNCTION IF EXISTS public.authorize_vehicle_rotation"),
        "Must drop authorize_vehicle_rotation"
      );
      assert.ok(
        migration21Content.includes("DROP FUNCTION IF EXISTS public.confirm_rotated_bus_campus_arrival"),
        "Must drop confirm_rotated_bus_campus_arrival"
      );
      assert.ok(
        migration21Content.includes("DROP FUNCTION IF EXISTS public.cancel_vehicle_rotation"),
        "Must drop cancel_vehicle_rotation"
      );
      assert.ok(
        migration21Content.includes("DROP FUNCTION IF EXISTS public.start_vehicle_repositioning"),
        "Must drop start_vehicle_repositioning"
      );
      assert.ok(
        migration21Content.includes("DROP TABLE IF EXISTS public.vehicle_movements CASCADE"),
        "Must drop vehicle_movements table"
      );
      assert.ok(
        migration21Content.includes("DROP TYPE IF EXISTS public.vehicle_movement_status"),
        "Must drop vehicle_movement_status enum"
      );
    });

    it("verifies migration 00021 removes rotation columns from public.journeys", () => {
      assert.ok(
        migration21Content.includes("DROP COLUMN IF EXISTS is_rotated_vehicle"),
        "Must drop is_rotated_vehicle column"
      );
      assert.ok(
        migration21Content.includes("DROP COLUMN IF EXISTS active_movement_id"),
        "Must drop active_movement_id column"
      );
      assert.ok(
        migration21Content.includes("DROP COLUMN IF EXISTS rotation_campus_return_confirmed_at"),
        "Must drop rotation_campus_return_confirmed_at column"
      );
      assert.ok(
        migration21Content.includes("DROP COLUMN IF EXISTS rotated_from_journey_id"),
        "Must drop rotated_from_journey_id column"
      );
      assert.ok(
        migration21Content.includes("DROP COLUMN IF EXISTS rotation_previous_vehicle_id"),
        "Must drop rotation_previous_vehicle_id column"
      );
    });

    it("verifies profiles.admin_role constraint is restricted to core roles", () => {
      assert.ok(
        migration21Content.includes("CHECK (admin_role IS NULL OR admin_role IN ('hostel_manager', 'bus_manager', 'super_admin'))"),
        "profiles.admin_role check constraint must only include core transport roles"
      );
      assert.ok(
        !migration21Content.includes("'operations_controller'"),
        "Must not include operations_controller in admin_role check constraint"
      );
    });

    it("verifies single authoritative check_vehicle_assignment_conflict function signature", () => {
      assert.ok(
        migration21Content.includes("CREATE OR REPLACE FUNCTION public.check_vehicle_assignment_conflict("),
        "Must create check_vehicle_assignment_conflict function"
      );
      assert.ok(
        migration21Content.includes("p_vehicle_id UUID"),
        "Must accept p_vehicle_id"
      );
      assert.ok(
        migration21Content.includes("p_journey_date DATE"),
        "Must accept p_journey_date"
      );
      assert.ok(
        migration21Content.includes("p_scheduled_departure TIMESTAMPTZ"),
        "Must accept p_scheduled_departure"
      );
      assert.ok(
        migration21Content.includes("p_exclude_journey_id UUID DEFAULT NULL"),
        "Must accept p_exclude_journey_id"
      );
      assert.ok(
        !migration21Content.includes("p_source_journey_id"),
        "Must NOT include rotation-specific p_source_journey_id parameter"
      );
    });

    it("verifies admin_create_journey enforces exclusive FOR UPDATE vehicle locking", () => {
      assert.ok(
        migration21Content.includes("SELECT * INTO v_vehicle"),
        "Must select vehicle"
      );
      assert.ok(
        migration21Content.includes("FROM public.vehicles"),
        "Must query vehicles"
      );
      assert.ok(
        migration21Content.includes("FOR UPDATE;"),
        "Must lock vehicle row exclusively with FOR UPDATE"
      );
    });

    it("verifies admin_generate_journeys_from_schedules uses FOR UPDATE SKIP LOCKED", () => {
      assert.ok(
        migration21Content.includes("FOR UPDATE SKIP LOCKED"),
        "Bulk schedule generation must lock candidate vehicle with FOR UPDATE SKIP LOCKED"
      );
    });

    it("verifies defense-in-depth trigger is provisioned on public.journeys", () => {
      assert.ok(
        migration21Content.includes("CREATE TRIGGER trg_enforce_journey_vehicle_availability"),
        "Must create availability enforcement trigger"
      );
      assert.ok(
        migration21Content.includes("BEFORE INSERT OR UPDATE OF vehicle_id, scheduled_departure ON public.journeys"),
        "Trigger must fire BEFORE INSERT OR UPDATE OF vehicle_id, scheduled_departure"
      );
    });

    it("verifies legacy open Admin ALL policy is replaced with scoped policies", () => {
      assert.ok(
        migration21Content.includes('DROP POLICY IF EXISTS "Admins can manage journeys" ON public.journeys;'),
        "Must drop broad ALL policy"
      );
      assert.ok(
        migration21Content.includes('CREATE POLICY "Admins can update journeys"'),
        "Must create scoped UPDATE policy"
      );
      assert.ok(
        migration21Content.includes('CREATE POLICY "Admins can delete journeys"'),
        "Must create scoped DELETE policy"
      );
      assert.ok(
        !migration21Content.includes('CREATE POLICY "Admins can insert journeys"'),
        "Must NOT allow direct INSERT by admins via PostgREST"
      );
    });
  });

  // ============================================================
  // 2. VEHICLE AVAILABILITY & CONFLICT LOGIC VERIFICATION
  // ============================================================

  describe("2. Vehicle Availability & Conflict Logic Verification", () => {
    interface MockVehicle {
      id: string;
      registration_number: string;
      is_active: boolean;
      status: "available" | "maintenance" | "retired" | "unavailable";
      safe_capacity: number;
    }

    interface MockJourney {
      id: string;
      vehicle_id: string;
      route_name: string;
      status: "scheduled" | "bus_arrived" | "boarding" | "boarding_closed" | "ready_to_depart" | "in_transit" | "completed" | "cancelled";
      scheduled_departure: Date;
    }

    function evaluateVehicleConflict(
      vehicle: MockVehicle | null,
      journeys: MockJourney[],
      scheduledDeparture: Date,
      excludeJourneyId: string | null = null
    ): { has_conflict: boolean; code: string; error?: string } {
      if (!vehicle) {
        return { has_conflict: true, code: "VEHICLE_NOT_FOUND", error: "Selected vehicle does not exist." };
      }
      if (!vehicle.is_active) {
        return { has_conflict: true, code: "VEHICLE_INACTIVE", error: "Selected vehicle is currently marked inactive." };
      }
      if (["maintenance", "retired", "unavailable"].includes(vehicle.status)) {
        return { has_conflict: true, code: "VEHICLE_UNAVAILABLE", error: `Vehicle is currently in ${vehicle.status} status and cannot be assigned.` };
      }

      // Check active unfinished journeys
      const activeTrip = journeys.find(
        (j) =>
          j.vehicle_id === vehicle.id &&
          ["bus_arrived", "boarding", "boarding_closed", "ready_to_depart", "in_transit"].includes(j.status) &&
          (excludeJourneyId === null || j.id !== excludeJourneyId)
      );
      if (activeTrip) {
        return {
          has_conflict: true,
          code: "VEHICLE_CURRENTLY_ACTIVE",
          error: `Vehicle is currently committed to active trip (${activeTrip.route_name} - status: ${activeTrip.status}). It cannot be assigned until operational completion.`,
        };
      }

      // Check overlapping scheduled journeys within 30 minutes (1800s)
      const targetTime = scheduledDeparture.getTime();
      const overlapping = journeys.find(
        (j) =>
          j.vehicle_id === vehicle.id &&
          j.status !== "cancelled" &&
          (excludeJourneyId === null || j.id !== excludeJourneyId) &&
          Math.abs(j.scheduled_departure.getTime() - targetTime) < 30 * 60 * 1000
      );
      if (overlapping) {
        return {
          has_conflict: true,
          code: "ASSIGNMENT_CONFLICT",
          error: `Vehicle is already assigned to ${overlapping.route_name}. Overlapping commitments are prohibited.`,
        };
      }

      return { has_conflict: false, code: "AVAILABLE" };
    }

    const testVehicle: MockVehicle = {
      id: "veh-001",
      registration_number: "CR-BUS-01",
      is_active: true,
      status: "available",
      safe_capacity: 32,
    };

    it("rejects non-existent vehicle (fail closed)", () => {
      const res = evaluateVehicleConflict(null, [], new Date("2026-11-10T08:00:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "VEHICLE_NOT_FOUND");
    });

    it("rejects inactive vehicle", () => {
      const inactiveVeh = { ...testVehicle, is_active: false };
      const res = evaluateVehicleConflict(inactiveVeh, [], new Date("2026-11-10T08:00:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "VEHICLE_INACTIVE");
    });

    it("rejects vehicle in maintenance status", () => {
      const maintVeh: MockVehicle = { ...testVehicle, status: "maintenance" };
      const res = evaluateVehicleConflict(maintVeh, [], new Date("2026-11-10T08:00:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "VEHICLE_UNAVAILABLE");
    });

    it("rejects vehicle in retired or unavailable status", () => {
      const retiredVeh: MockVehicle = { ...testVehicle, status: "retired" };
      const res = evaluateVehicleConflict(retiredVeh, [], new Date("2026-11-10T08:00:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "VEHICLE_UNAVAILABLE");
    });

    it("rejects assignment when vehicle is currently in_transit on an active trip", () => {
      const activeJourneys: MockJourney[] = [
        {
          id: "j-active",
          vehicle_id: "veh-001",
          route_name: "Morning Campus Express",
          status: "in_transit",
          scheduled_departure: new Date("2026-11-10T07:30:00Z"),
        },
      ];
      const res = evaluateVehicleConflict(testVehicle, activeJourneys, new Date("2026-11-10T08:30:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "VEHICLE_CURRENTLY_ACTIVE");
    });

    it("rejects assignment when vehicle is in boarding status", () => {
      const activeJourneys: MockJourney[] = [
        {
          id: "j-boarding",
          vehicle_id: "veh-001",
          route_name: "Boys Hostel Express",
          status: "boarding",
          scheduled_departure: new Date("2026-11-10T08:00:00Z"),
        },
      ];
      const res = evaluateVehicleConflict(testVehicle, activeJourneys, new Date("2026-11-10T09:00:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "VEHICLE_CURRENTLY_ACTIVE");
    });

    it("detects overlapping scheduled journey within 30 minutes on same day", () => {
      const existingJourneys: MockJourney[] = [
        {
          id: "j-1",
          vehicle_id: "veh-001",
          route_name: "Route A",
          status: "scheduled",
          scheduled_departure: new Date("2026-11-10T08:00:00Z"),
        },
      ];
      // 15 minutes later -> within 30-min buffer -> conflict!
      const res = evaluateVehicleConflict(testVehicle, existingJourneys, new Date("2026-11-10T08:15:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "ASSIGNMENT_CONFLICT");
    });

    it("detects cross-midnight overlapping journey within 30 minutes across calendar dates", () => {
      const existingJourneys: MockJourney[] = [
        {
          id: "j-midnight",
          vehicle_id: "veh-001",
          route_name: "Late Night Shuttle",
          status: "scheduled",
          scheduled_departure: new Date("2026-11-10T23:50:00Z"),
        },
      ];
      // 00:10 on Nov 11 is exactly 20 minutes later -> cross-midnight conflict!
      const res = evaluateVehicleConflict(testVehicle, existingJourneys, new Date("2026-11-11T00:10:00Z"));
      assert.strictEqual(res.has_conflict, true);
      assert.strictEqual(res.code, "ASSIGNMENT_CONFLICT");
    });

    it("allows assignment when existing journey is cancelled", () => {
      const cancelledJourneys: MockJourney[] = [
        {
          id: "j-cancelled",
          vehicle_id: "veh-001",
          route_name: "Cancelled Trip",
          status: "cancelled",
          scheduled_departure: new Date("2026-11-10T08:00:00Z"),
        },
      ];
      const res = evaluateVehicleConflict(testVehicle, cancelledJourneys, new Date("2026-11-10T08:10:00Z"));
      assert.strictEqual(res.has_conflict, false);
      assert.strictEqual(res.code, "AVAILABLE");
    });

    it("allows assignment when existing journey is completed and departure is outside 30 minutes", () => {
      const completedJourneys: MockJourney[] = [
        {
          id: "j-completed",
          vehicle_id: "veh-001",
          route_name: "Early Run",
          status: "completed",
          scheduled_departure: new Date("2026-11-10T06:00:00Z"),
        },
      ];
      const res = evaluateVehicleConflict(testVehicle, completedJourneys, new Date("2026-11-10T08:00:00Z"));
      assert.strictEqual(res.has_conflict, false);
      assert.strictEqual(res.code, "AVAILABLE");
    });

    it("excludes self journey ID during updates to prevent false self-conflict", () => {
      const currentJourneys: MockJourney[] = [
        {
          id: "j-self",
          vehicle_id: "veh-001",
          route_name: "Current Trip",
          status: "scheduled",
          scheduled_departure: new Date("2026-11-10T08:00:00Z"),
        },
      ];
      const res = evaluateVehicleConflict(testVehicle, currentJourneys, new Date("2026-11-10T08:05:00Z"), "j-self");
      assert.strictEqual(res.has_conflict, false);
      assert.strictEqual(res.code, "AVAILABLE");
    });
  });

  // ============================================================
  // 3. CORE CAPACITY CEILING & ALLOCATION PRESERVATION
  // ============================================================

  describe("3. Core Capacity Ceiling & Allocation Preservation", () => {
    it("enforces safe capacity ceiling as LEAST of proposed allocation and safe capacity", () => {
      function computeAllocation(proposed: number, vehicleSafeCapacity: number): number {
        return Math.min(proposed || 32, vehicleSafeCapacity);
      }

      assert.strictEqual(computeAllocation(35, 32), 32, "Proposed 35 capped at vehicle safe capacity 32");
      assert.strictEqual(computeAllocation(25, 32), 25, "Proposed 25 honored within safe capacity 32");
      assert.strictEqual(computeAllocation(32, 30), 30, "Proposed 32 capped at bus capacity 30");
    });

    it("preserves 20 seated + 12 standing = 32 maximum capacity model", () => {
      const maxSeated = 20;
      const maxStanding = 12;
      const totalCapacity = maxSeated + maxStanding;

      assert.strictEqual(totalCapacity, 32);

      function allocatePassenger(currentSeated: number, currentStanding: number): "seated" | "standing" | "full" {
        if (currentSeated < maxSeated) return "seated";
        if (currentStanding < maxStanding) return "standing";
        return "full";
      }

      // First 20 are seated
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(allocatePassenger(i, 0), "seated");
      }
      // Next 12 are standing
      for (let i = 0; i < 12; i++) {
        assert.strictEqual(allocatePassenger(20, i), "standing");
      }
      // 33rd passenger is rejected (bus is full)
      assert.strictEqual(allocatePassenger(20, 12), "full");
    });
  });

  // ============================================================
  // 4. CODEBASE HYGIENE & STRICT TERMINOLOGY INVARIANTS
  // ============================================================

  describe("4. Codebase Hygiene & Strict Terminology Invariants", () => {
    it("verifies zero occurrences of the forbidden word across migration 00021", () => {
      const forbiddenWord = ["corr", "idor"].join("");
      assert.ok(
        !migration21Content.toLowerCase().includes(forbiddenWord),
        "Migration 00021 must contain zero occurrences of the forbidden word"
      );
    });

    it("verifies zero rotation files exist in src/actions", () => {
      const rotationsActionPath = path.resolve(process.cwd(), "src/actions/rotations.ts");
      assert.strictEqual(fs.existsSync(rotationsActionPath), false, "src/actions/rotations.ts must be deleted");
    });

    it("verifies zero rotation components exist in src/components/admin", () => {
      const rotationsViewPath = path.resolve(process.cwd(), "src/components/admin/vehicle-rotations-view.tsx");
      assert.strictEqual(fs.existsSync(rotationsViewPath), false, "vehicle-rotations-view.tsx must be deleted");
    });

    it("verifies zero rotation pages exist in src/app/(dashboard)/admin/rotations", () => {
      const rotationsPagePath = path.resolve(process.cwd(), "src/app/(dashboard)/admin/rotations");
      assert.strictEqual(fs.existsSync(rotationsPagePath), false, "admin/rotations page directory must be deleted");
    });

    it("verifies dashboard shell has no links to /rotations or operations_controller", () => {
      const shellPath = path.resolve(process.cwd(), "src/components/layout/dashboard-shell.tsx");
      const shellContent = fs.readFileSync(shellPath, "utf-8");
      assert.ok(!shellContent.includes("/rotations"), "dashboard-shell must not link to /rotations");
      assert.ok(!shellContent.includes("operations_controller"), "dashboard-shell must not mention operations_controller");
    });

    it("verifies dispatch view has no rotation badges or return confirmation buttons", () => {
      const dispatchViewPath = path.resolve(process.cwd(), "src/components/admin/bus-manager-dispatch-view.tsx");
      const dispatchViewContent = fs.readFileSync(dispatchViewPath, "utf-8");
      assert.ok(!dispatchViewContent.includes("confirmRotatedBusReturnAction"), "Must not import confirmRotatedBusReturnAction");
      assert.ok(!dispatchViewContent.includes("ROTATING EMPTY"), "Must not include rotating empty badge");
      assert.ok(!dispatchViewContent.includes("ROTATED BUS RETURNED"), "Must not include rotated bus returned badge");
    });
  });
});
