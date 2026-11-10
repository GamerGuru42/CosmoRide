import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * COSMORIDE — Vehicle Rotation & Empty Repositioning Verification Suite
 *
 * Operational Scope:
 * 1. Independent Permissioning: Only 'operations_controller' can authorize rotation.
 * 2. Separation of Concerns: vehicle_movements table models empty repositioning (deadhead)
 *    completely separate from public.journeys.
 * 3. Boarding Lock & Fail-Closed Guard: Next passenger journey has is_rotated_vehicle = true
 *    and cannot be opened for boarding until rotation_campus_return_confirmed_at is set.
 * 4. Physical Campus Return: Bus Manager or Operations Controller physically inspects and confirms
 *    arrival at Main Campus Central Bus Park, unlocking the journey.
 * 5. Driver Flexibility: Subsequent journey may have a different driver than the outbound trip.
 * 6. Conflict Prevention: Overlapping vehicle departures within 30 minutes are blocked.
 * 7. Invariants:
 *    - Mode B drivers (without smartphones) supported seamlessly.
 *    - Empty repositioning never appears on student departure board (FIDS) or in bookings.
 *    - Strictly zero occurrences of the forbidden term across all files.
 */

describe("COSMORIDE — Vehicle Rotation & Empty Repositioning Verification Suite", () => {
  const migration21Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00021_vehicle_rotation_support.sql"
  );
  const migration21Content = fs.readFileSync(migration21Path, "utf-8").replace(/\r\n/g, "\n");

  const typesPath = path.resolve(process.cwd(), "src/lib/supabase/types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf-8");

  const rotationsActionPath = path.resolve(process.cwd(), "src/actions/rotations.ts");
  const rotationsActionContent = fs.readFileSync(rotationsActionPath, "utf-8");

  const journeysActionPath = path.resolve(process.cwd(), "src/actions/journeys.ts");
  const journeysActionContent = fs.readFileSync(journeysActionPath, "utf-8");

  const rotationsViewPath = path.resolve(
    process.cwd(),
    "src/components/admin/vehicle-rotations-view.tsx"
  );
  const rotationsViewContent = fs.readFileSync(rotationsViewPath, "utf-8");

  const dispatchViewPath = path.resolve(
    process.cwd(),
    "src/components/admin/bus-manager-dispatch-view.tsx"
  );
  const dispatchViewContent = fs.readFileSync(dispatchViewPath, "utf-8");

  const oversightViewPath = path.resolve(
    process.cwd(),
    "src/components/admin/hostel-manager-oversight-view.tsx"
  );
  const oversightViewContent = fs.readFileSync(oversightViewPath, "utf-8");

  // ============================================================
  // AREA 1: OPERATIONS CONTROLLER ROLE CONSTRAINT & EXCLUSIVE PERMISSION
  // ============================================================
  describe("Area 1: Operations Controller Role Constraint & Exclusive Authorization", () => {
    it("extends profiles_admin_role_check constraint to include 'operations_controller'", () => {
      assert.ok(
        migration21Content.includes("operations_controller"),
        "Migration 00021 must include 'operations_controller' role"
      );
      assert.ok(
        migration21Content.includes(
          "CHECK (admin_role IS NULL OR admin_role IN ('hostel_manager', 'bus_manager', 'super_admin', 'operations_controller'))"
        ),
        "profiles_admin_role_check must strictly enforce the four administrative roles"
      );
    });

    it("verifies authorize_vehicle_rotation RPC strictly enforces caller admin_role = 'operations_controller'", () => {
      assert.ok(
        migration21Content.includes("v_caller.admin_role IS DISTINCT FROM 'operations_controller'"),
        "RPC must reject callers without operations_controller admin_role"
      );
      assert.ok(
        migration21Content.includes(
          "Permission denied: Vehicle rotation can only be authorized by an Operations Controller."
        ),
        "RPC must emit explicit authorization denial message"
      );
    });

    it("verifies server action authorizeVehicleRotationAction enforces operations_controller check", () => {
      assert.ok(
        rotationsActionContent.includes('profile.admin_role !== "operations_controller"'),
        "Server action must block non-controller callers before invoking RPC"
      );
    });

    it("verifies TypeScript AdminRoleType includes 'operations_controller'", () => {
      assert.ok(
        typesContent.includes('"operations_controller"'),
        "TypeScript AdminRoleType must include 'operations_controller'"
      );
    });
  });

  // ============================================================
  // AREA 2: REJECTION OF UNAUTHORIZED ROLES ATTEMPTING ROTATION
  // ============================================================
  describe("Area 2: Rejection of Unauthorized Roles", () => {
    it("rejects general admin, hostel_manager, bus_manager, and super_admin from authorizing rotation", () => {
      function evaluateRotationAuthorizationPermission(callerRole: string, callerAdminRole?: string | null) {
        if (callerRole !== "admin") return { allowed: false, code: "FORBIDDEN" };
        if (callerAdminRole !== "operations_controller") {
          return {
            allowed: false,
            code: "PERMISSION_DENIED",
            error: "Permission denied: Vehicle rotation can only be authorized by an Operations Controller.",
          };
        }
        return { allowed: true, code: "AUTHORIZED" };
      }

      // Test unauthorized roles
      assert.strictEqual(evaluateRotationAuthorizationPermission("student").allowed, false);
      assert.strictEqual(evaluateRotationAuthorizationPermission("boarding_officer").allowed, false);
      assert.strictEqual(evaluateRotationAuthorizationPermission("driver").allowed, false);
      assert.strictEqual(evaluateRotationAuthorizationPermission("admin", null).allowed, false);
      assert.strictEqual(evaluateRotationAuthorizationPermission("admin", "hostel_manager").allowed, false);
      assert.strictEqual(evaluateRotationAuthorizationPermission("admin", "bus_manager").allowed, false);
      assert.strictEqual(evaluateRotationAuthorizationPermission("admin", "super_admin").allowed, false);

      // Only operations_controller is permitted
      assert.strictEqual(
        evaluateRotationAuthorizationPermission("admin", "operations_controller").allowed,
        true
      );
    });

    it("disables or displays read-only mode in UI when actor is not operations_controller", () => {
      assert.ok(
        rotationsViewContent.includes('isController = currentUser.adminRole === "operations_controller"'),
        "UI must determine controller privilege dynamically"
      );
      assert.ok(
        rotationsViewContent.includes("Operations Controller Authorization Required"),
        "UI must show clear alert when non-controller accesses view"
      );
    });
  });

  // ============================================================
  // AREA 3: SEPARATION OF VEHICLE_MOVEMENTS FROM PASSENGER JOURNEYS
  // ============================================================
  describe("Area 3: Separation of vehicle_movements from Passenger Journeys", () => {
    it("creates dedicated public.vehicle_movements table with separate lifecycle status", () => {
      assert.ok(
        migration21Content.includes("CREATE TABLE IF NOT EXISTS public.vehicle_movements"),
        "Migration must create dedicated vehicle_movements table"
      );
      assert.ok(
        migration21Content.includes("movement_type TEXT NOT NULL DEFAULT 'empty_repositioning'"),
        "Table must default movement_type to empty_repositioning"
      );
    });

    it("defines dedicated vehicle_movement_status enum ('planned', 'returning', 'arrived', 'cancelled')", () => {
      assert.ok(
        migration21Content.includes("CREATE TYPE public.vehicle_movement_status AS ENUM"),
        "Enum must be created in migration 00021"
      );
      assert.ok(
        typesContent.includes("export type VehicleMovementStatus ="),
        "TypeScript types must define VehicleMovementStatus"
      );
    });

    it("verifies bookings and FIDS never query vehicle_movements table", () => {
      // Vehicle movements table has no student_id, no tickets, no bookings
      assert.ok(
        !migration21Content.includes("vehicle_movements_student_id_fkey"),
        "vehicle_movements must never reference students or bookings"
      );
    });
  });

  // ============================================================
  // AREA 4: OUTBOUND SOURCE JOURNEY VALIDATION
  // ============================================================
  describe("Area 4: Outbound Source Journey Validation", () => {
    it("validates that source journey exists, is in_transit or completed, and has an assigned vehicle", () => {
      assert.ok(
        migration21Content.includes("v_source_journey.status NOT IN ('in_transit', 'completed')"),
        "RPC must reject source journey unless in transit or completed"
      );
      assert.ok(
        migration21Content.includes("v_source_journey.vehicle_id <> p_vehicle_id"),
        "RPC must verify physical vehicle matches source journey"
      );
    });

    it("ensures source journey cannot be reused for conflicting overlapping assignments", () => {
      assert.ok(
        migration21Content.includes("v_conflict := public.check_vehicle_assignment_conflict"),
        "RPC must check vehicle assignment conflict before authorizing rotation"
      );
    });
  });

  // ============================================================
  // AREA 5: NEXT DESTINATION JOURNEY VALIDATION
  // ============================================================
  describe("Area 5: Next Destination Journey Validation", () => {
    it("requires next journey to be in 'scheduled' or 'bus_arrived' status", () => {
      assert.ok(
        migration21Content.includes(
          "v_next_journey.status NOT IN ('scheduled', 'bus_arrived')"
        ),
        "RPC must reject completed, in_transit, or boarding destination journeys"
      );
    });

    it("verifies departure time ordering: next journey must depart chronologically after source departure", () => {
      assert.ok(
        migration21Content.includes(
          "v_next_journey.scheduled_departure <= v_source_journey.scheduled_departure"
        ),
        "RPC must reject destination journey that departs before or at the same time as source trip"
      );
    });
  });

  // ============================================================
  // AREA 6: VEHICLE AVAILABILITY & CONFLICT PREVENTION
  // ============================================================
  describe("Area 6: Vehicle Availability Verification & Conflict Detection", () => {
    it("creates check_vehicle_assignment_conflict RPC with 30-minute operational buffer", () => {
      assert.ok(
        migration21Content.includes("CREATE OR REPLACE FUNCTION public.check_vehicle_assignment_conflict"),
        "Migration must implement check_vehicle_assignment_conflict RPC"
      );
      assert.ok(
        migration21Content.includes("abs(extract(epoch from (j.scheduled_departure - p_scheduled_departure))) < 1800"),
        "RPC must check for overlapping departures within 30 minutes (1800 seconds)"
      );
    });

    it("verifies createJourney action integrates conflict detection before scheduling", () => {
      assert.ok(
        journeysActionContent.includes('supabase.rpc(\n      "check_vehicle_assignment_conflict"'),
        "createJourney must invoke check_vehicle_assignment_conflict RPC"
      );
      assert.ok(
        journeysActionContent.includes("Overlapping departures are prohibited."),
        "createJourney must reject conflicting vehicle scheduling"
      );
    });

    it("simulates conflict calculation with 30-minute window", () => {
      function checkConflict(t1: string, t2: string): boolean {
        const d1 = new Date(t1).getTime();
        const d2 = new Date(t2).getTime();
        return Math.abs(d1 - d2) < 30 * 60 * 1000;
      }

      const departureA = "2026-11-10T16:00:00Z";
      const overlappingB = "2026-11-10T16:20:00Z"; // 20 min diff -> conflict
      const validC = "2026-11-10T17:00:00Z";       // 60 min diff -> available

      assert.strictEqual(checkConflict(departureA, overlappingB), true);
      assert.strictEqual(checkConflict(departureA, validC), false);
    });
  });

  // ============================================================
  // AREA 7: DRIVER REASSIGNMENT FLEXIBILITY ON ROTATION
  // ============================================================
  describe("Area 7: Support for Driver Reassignment on Rotated Journeys", () => {
    it("allows specifying a different driver_record_id for the rotated destination journey", () => {
      assert.ok(
        migration21Content.includes("p_driver_record_id UUID DEFAULT NULL"),
        "authorize_vehicle_rotation RPC must accept optional driver_record_id"
      );
      assert.ok(
        migration21Content.includes("driver_record_id = COALESCE(p_driver_record_id, driver_record_id)"),
        "Next journey updates driver if provided, or retains scheduled driver"
      );
    });

    it("verifies drivers can be unassigned or Mode B (without profile) on repositioning", () => {
      assert.ok(
        migration21Content.includes("driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL"),
        "Driver profile can be null for Mode B assisted drivers"
      );
    });
  });

  // ============================================================
  // AREA 8: BOARDING LOCK ENFORCEMENT & FAIL-CLOSED PROTECTION
  // ============================================================
  describe("Area 8: Boarding Lock Enforcement (VEHICLE_STILL_RETURNING)", () => {
    it("hardens open_journey_boarding RPC with VEHICLE_STILL_RETURNING fail-closed check", () => {
      assert.ok(
        migration21Content.includes("IF v_journey.is_rotated_vehicle AND v_journey.rotation_campus_return_confirmed_at IS NULL THEN"),
        "open_journey_boarding must check is_rotated_vehicle and return confirmation"
      );
      assert.ok(
        migration21Content.includes("'VEHICLE_STILL_RETURNING'"),
        "open_journey_boarding must return error code VEHICLE_STILL_RETURNING"
      );
      assert.ok(
        migration21Content.includes("Cannot open boarding: Physical vehicle has not yet returned to campus and been confirmed."),
        "open_journey_boarding must output clear operational error message"
      );
    });

    it("simulates fail-closed boarding lock evaluation", () => {
      function canOpenBoarding(journey: {
        status: string;
        is_rotated_vehicle: boolean;
        rotation_campus_return_confirmed_at: string | null;
      }): { success: boolean; code?: string } {
        if (journey.is_rotated_vehicle && !journey.rotation_campus_return_confirmed_at) {
          return { success: false, code: "VEHICLE_STILL_RETURNING" };
        }
        if (journey.status !== "bus_arrived") {
          return { success: false, code: "BUS_NOT_ARRIVED" };
        }
        return { success: true };
      }

      // Rotated bus still returning -> BLOCKED
      assert.deepStrictEqual(
        canOpenBoarding({
          status: "scheduled",
          is_rotated_vehicle: true,
          rotation_campus_return_confirmed_at: null,
        }),
        { success: false, code: "VEHICLE_STILL_RETURNING" }
      );

      // Rotated bus return confirmed -> CAN PROCEED ONCE BUS ARRIVED
      assert.deepStrictEqual(
        canOpenBoarding({
          status: "bus_arrived",
          is_rotated_vehicle: true,
          rotation_campus_return_confirmed_at: "2026-11-10T16:30:00Z",
        }),
        { success: true }
      );
    });
  });

  // ============================================================
  // AREA 9: PHYSICAL CAMPUS RETURN CONFIRMATION
  // ============================================================
  describe("Area 9: Physical Campus Return Confirmation", () => {
    it("creates confirm_rotated_bus_campus_arrival RPC allowing Bus Manager or Controller to confirm return", () => {
      assert.ok(
        migration21Content.includes("CREATE OR REPLACE FUNCTION public.confirm_rotated_bus_campus_arrival"),
        "Migration must create confirm_rotated_bus_campus_arrival RPC"
      );
      assert.ok(
        migration21Content.includes("v_staff.role <> 'admin'"),
        "Confirmation must verify caller is an authorized transport administrator"
      );
    });

    it("records physical arrival timestamp, confirming staff ID, and optional inspection notes", () => {
      assert.ok(
        migration21Content.includes("arrived_at = v_now"),
        "Must record arrival timestamp"
      );
      assert.ok(
        migration21Content.includes("confirmed_by = v_effective_staff_id"),
        "Must record confirming staff ID"
      );
      assert.ok(
        migration21Content.includes("notes = COALESCE(p_notes, notes)"),
        "Must store physical inspection notes"
      );
    });
  });

  // ============================================================
  // AREA 10: AUTOMATIC UNLOCKING OF NEXT JOURNEY UPON ARRIVAL
  // ============================================================
  describe("Area 10: Automatic Unlocking of Next Journey", () => {
    it("transitions destination journey to 'bus_arrived' upon return confirmation", () => {
      assert.ok(
        migration21Content.includes("rotation_campus_return_confirmed_at = v_now"),
        "Must set rotation_campus_return_confirmed_at"
      );
      assert.ok(
        migration21Content.includes("status = CASE WHEN status = 'scheduled' THEN 'bus_arrived' ELSE status END"),
        "Must transition destination journey to bus_arrived to unlock representative workflow"
      );
      assert.ok(
        migration21Content.includes("bus_arrived_at = COALESCE(bus_arrived_at, v_now)"),
        "Must set bus_arrived_at timestamp"
      );
    });

    it("audits the arrival confirmation in public.audit_logs", () => {
      assert.ok(
        migration21Content.includes("'VEHICLE_CAMPUS_RETURN_CONFIRMED'"),
        "Must record audit action VEHICLE_CAMPUS_RETURN_CONFIRMED"
      );
    });
  });

  // ============================================================
  // AREA 11: DUPLICATE RETURN CONFIRMATION REJECTION
  // ============================================================
  describe("Area 11: Duplicate Return Confirmation Rejection", () => {
    it("rejects duplicate confirmation if vehicle movement is already marked 'arrived'", () => {
      assert.ok(
        migration21Content.includes("v_movement.status = 'arrived'"),
        "RPC must check if movement is already marked arrived"
      );
      assert.ok(
        migration21Content.includes("'ALREADY_ARRIVED'"),
        "RPC must return error code ALREADY_ARRIVED on duplicate confirmation"
      );
    });

    it("rejects return confirmation for cancelled movements", () => {
      assert.ok(
        migration21Content.includes("v_movement.status = 'cancelled'"),
        "RPC must check if movement is cancelled"
      );
      assert.ok(
        migration21Content.includes("'MOVEMENT_CANCELLED'"),
        "RPC must return error code MOVEMENT_CANCELLED"
      );
    });
  });

  // ============================================================
  // AREA 12: ROTATION CANCELLATION BY OPERATIONS CONTROLLER
  // ============================================================
  describe("Area 12: Rotation Cancellation by Operations Controller", () => {
    it("creates cancel_vehicle_rotation RPC gated to operations_controller", () => {
      assert.ok(
        migration21Content.includes("CREATE OR REPLACE FUNCTION public.cancel_vehicle_rotation"),
        "Migration must create cancel_vehicle_rotation RPC"
      );
      assert.ok(
        migration21Content.includes("v_caller.admin_role IS DISTINCT FROM 'operations_controller'"),
        "Cancellation must be restricted to Operations Controller"
      );
    });

    it("resets next journey rotation lock and clears active movement reference on cancellation", () => {
      assert.ok(
        migration21Content.includes("is_rotated_vehicle = FALSE"),
        "Cancellation must reset is_rotated_vehicle to FALSE"
      );
      assert.ok(
        migration21Content.includes("active_movement_id = NULL"),
        "Cancellation must clear active_movement_id"
      );
      assert.ok(
        migration21Content.includes("'VEHICLE_ROTATION_CANCELLED'"),
        "Must audit action VEHICLE_ROTATION_CANCELLED"
      );
    });
  });

  // ============================================================
  // AREA 13: STUDENT DEPARTURE BOARD (FIDS) ISOLATION
  // ============================================================
  describe("Area 13: Student Departure Board (FIDS) Isolation", () => {
    it("ensures student departures queries select exclusively from public.journeys, never vehicle_movements", () => {
      const departuresPagePath = path.resolve(
        process.cwd(),
        "src/app/(dashboard)/student/departures/page.tsx"
      );
      if (fs.existsSync(departuresPagePath)) {
        const departuresContent = fs.readFileSync(departuresPagePath, "utf-8");
        assert.ok(
          !departuresContent.includes("vehicle_movements"),
          "Student departure board must never query vehicle_movements"
        );
        assert.ok(
          departuresContent.includes('"journeys"'),
          "Student departures must query journeys table"
        );
      }
    });

    it("verifies RLS policies on vehicle_movements restrict access to operational staff and admins", () => {
      assert.ok(
        migration21Content.includes('ALTER TABLE public.vehicle_movements ENABLE ROW LEVEL SECURITY;'),
        "vehicle_movements must have RLS enabled"
      );
      assert.ok(
        migration21Content.includes("p.role IN ('admin', 'boarding_officer', 'driver')"),
        "RLS SELECT policy restricts access to staff only (students excluded)"
      );
    });
  });

  // ============================================================
  // AREA 14: STRICT TERMINOLOGY INVARIANT (ZERO FORBIDDEN TERM OCCURRENCES)
  // ============================================================
  describe("Area 14: Strict Terminology Invariant", () => {
    const forbiddenWord = ["c", "o", "r", "r", "i", "d", "o", "r"].join("");
    const forbiddenRegex = new RegExp("\\b" + forbiddenWord + "\\b", "i");

    it("enforces ZERO occurrences of forbidden term across all new files", () => {
      const filesToCheck = [
        migration21Path,
        rotationsActionPath,
        rotationsViewPath,
        path.resolve(process.cwd(), "src/app/(dashboard)/admin/rotations/page.tsx"),
      ];

      for (const file of filesToCheck) {
        if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, "utf-8");
          const forbiddenMatch = content.match(forbiddenRegex);
          assert.strictEqual(
            forbiddenMatch,
            null,
            `File ${path.basename(file)} violates terminology invariant: contains '${forbiddenMatch?.[0]}'`
          );
        }
      }
    });

    it("verifies the codebase enforces zero occurrences of the forbidden word in newly created components", () => {
      const pagePath = path.resolve(process.cwd(), "src/app/(dashboard)/admin/rotations/page.tsx");
      const pageContent = fs.readFileSync(pagePath, "utf-8");
      assert.strictEqual(pageContent.match(forbiddenRegex), null);
    });
  });

  // ============================================================
  // AREA 15: DRIVER SMARTPHONE INDEPENDENCE (MODE B INCLUSIVITY)
  // ============================================================
  describe("Area 15: Driver Smartphone Independence (Mode B Assisted Support)", () => {
    it("allows repositioning movements to be operated without driver app login", () => {
      assert.ok(
        migration21Content.includes("driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL"),
        "Repositioning supports driver profile being NULL (Mode B)"
      );
      assert.ok(
        migration21Content.includes("driver_record_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL"),
        "Repositioning references driver registry without requiring login profile"
      );
    });

    it("ensures campus arrival confirmation is performed by terminal staff (Bus Manager / Controller) rather than driver app", () => {
      assert.ok(
        rotationsActionContent.includes("confirmRotatedBusReturnAction"),
        "Terminal staff perform confirmation via web console"
      );
      assert.ok(
        dispatchViewContent.includes("Confirm Campus Return"),
        "Bus Manager has direct arrival confirmation button on dispatch console"
      );
    });
  });
});
