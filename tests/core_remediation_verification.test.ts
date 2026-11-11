import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canAccessAdminDomain } from "../src/lib/admin-auth";
import {
  routeSchema,
  scheduleSchema,
  createJourneySchema,
} from "../src/lib/validators";

const ROOT = process.cwd();

function readWorkspaceFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function listTsFiles(dirRel: string): string[] {
  const results: string[] = [];
  function walk(dirAbs: string) {
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      const fullPath = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        results.push(fullPath);
      }
    }
  }
  walk(path.join(ROOT, dirRel));
  return results;
}

describe("Consolidated Core System Remediation Verification (00022)", () => {
  it("enforces fail-closed admin domain RBAC and removes Vehicle Rotation roles", () => {
    assert.strictEqual(canAccessAdminDomain("super_admin", "overview"), true);
    assert.strictEqual(canAccessAdminDomain("super_admin", "journey_create"), true);
    assert.strictEqual(canAccessAdminDomain("bus_manager", "journey_create"), true);
    assert.strictEqual(canAccessAdminDomain("hostel_manager", "journey_create"), false);

    // Null / unknown / retired sub-roles must fail closed
    assert.strictEqual(canAccessAdminDomain(null, "overview"), false);
    assert.strictEqual(canAccessAdminDomain(undefined, "overview"), false);
    assert.strictEqual(canAccessAdminDomain("", "overview"), false);
    assert.strictEqual(canAccessAdminDomain("operations_controller", "overview"), false);
    assert.strictEqual(canAccessAdminDomain("operations_controller", "journey_create"), false);
  });

  it("validates updated route, schedule, and Mode A/B journey creation schemas", () => {
    const validMixedRoute = routeSchema.safeParse({
      code: "MC-GTH",
      name: "Main Campus to Global Transit Hub",
      direction: "campus_to_hostel",
      genderGroup: "mixed",
      transportGroupId: "550e8400-e29b-41d4-a716-446655440000",
      proposedAllocation: 20,
      estimatedDurationMinutes: 45,
    });
    assert.strictEqual(validMixedRoute.success, true);

    const scheduleShortTime = scheduleSchema.safeParse({
      routeId: "550e8400-e29b-41d4-a716-446655440000",
      dayOfWeek: 1,
      departureTime: "07:30",
      direction: "outbound",
      proposedAllocation: 24,
    });
    assert.strictEqual(scheduleShortTime.success, true);

    const scheduleWithSeconds = scheduleSchema.safeParse({
      routeId: "550e8400-e29b-41d4-a716-446655440000",
      dayOfWeek: 5,
      departureTime: "07:30:00",
      direction: "inbound",
      proposedAllocation: 20,
    });
    assert.strictEqual(scheduleWithSeconds.success, true);

    const modeBOnlyJourney = createJourneySchema.safeParse({
      routeId: "550e8400-e29b-41d4-a716-446655440000",
      vehicleId: "550e8400-e29b-41d4-a716-446655440001",
      driverRecordId: "550e8400-e29b-41d4-a716-446655440003",
      journeyDate: "2026-11-12",
      scheduledDeparture: "2026-11-12T16:30:00Z",
      proposedAllocation: 24,
    });
    assert.strictEqual(modeBOnlyJourney.success, true);

    const missingDriverJourney = createJourneySchema.safeParse({
      routeId: "550e8400-e29b-41d4-a716-446655440000",
      vehicleId: "550e8400-e29b-41d4-a716-446655440001",
      journeyDate: "2026-11-12",
      scheduledDeparture: "2026-11-12T16:30:00Z",
      proposedAllocation: 24,
    });
    assert.strictEqual(missingDriverJourney.success, false);
  });

  it("verifies migration 00022 security boundaries, concurrency locks, and strict grants", () => {
    const sql = readWorkspaceFile(
      "supabase/migrations/00022_core_system_security_and_workflow_remediation.sql"
    );

    // Non-recursive RLS helpers
    for (const helper of [
      "public.rls_user_role()",
      "public.rls_user_is_active()",
      "public.rls_admin_role()",
      "public.rls_is_admin()",
      "public.rls_is_super_admin()",
      "public.rls_assigned_transport_group()",
      "public.rls_driver_assigned_to_journey(",
      "public.rls_staff_can_view_profile(",
    ]) {
      assert.ok(sql.includes(helper), `Expected helper ${helper} in 00022`);
    }

    // Super admin privilege boundary & onboarding flag protection
    assert.ok(sql.includes("v_caller.admin_role <> 'super_admin'"));
    assert.ok(sql.includes("cosmoride.internal_student_onboarding"));

    // Duration-aware conflict checks & trigger coverage
    assert.ok(sql.includes("public.resolve_route_duration_minutes("));
    assert.ok(sql.includes("p_route_id UUID DEFAULT NULL"));
    assert.ok(sql.includes("FOR UPDATE"));
    assert.ok(
      sql.includes(
        "BEFORE INSERT OR UPDATE OF vehicle_id, route_id, scheduled_departure, delay_minutes, status, driver_id, driver_record_id ON public.journeys"
      )
    );

    // Strict 7-stage transition checks
    assert.ok(sql.includes("IF v_journey.status <> 'scheduled' THEN"));
    assert.ok(sql.includes("IF v_journey.status <> 'bus_arrived' THEN"));
    assert.ok(sql.includes("IF v_journey.status <> 'ready_to_depart' THEN"));

    // Least-privilege function revocations on triggers and student RPCs
    assert.ok(
      sql.includes(
        "REVOKE EXECUTE ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated, service_role;"
      )
    );
    assert.ok(
      sql.includes(
        "REVOKE EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) FROM anon, service_role;"
      )
    );
    assert.ok(
      sql.includes(
        "REVOKE EXECUTE ON FUNCTION public.cancel_waitlist_entry(UUID, UUID) FROM anon, service_role;"
      )
    );
    assert.ok(
      sql.includes(
        "REVOKE EXECUTE ON FUNCTION public.select_student_hostel(UUID) FROM anon, service_role;"
      )
    );
  });

  it("verifies strict 7-stage progression in driver, assisted, and boarding UIs", () => {
    const driverView = readWorkspaceFile("src/components/driver/driver-dashboard-view.tsx");
    assert.ok(!driverView.includes("startBoardingSession"), "Driver view must not skip to open boarding");
    assert.ok(driverView.includes("confirmBusArrivalAction"));
    assert.ok(driverView.includes('currentJourney.status === "ready_to_depart"'));
    assert.ok(driverView.includes("executeJourneyDepartureAction"));

    const assistedView = readWorkspaceFile("src/components/boarding/assisted-driver-operations.tsx");
    assert.ok(!assistedView.includes("startBoardingSession"), "Assisted ops must use stage-by-stage RPC actions");
    assert.ok(assistedView.includes("confirmBusArrivalAction"));
    assert.ok(assistedView.includes("openBoardingSessionAction"));
    assert.ok(assistedView.includes("closeBoardingSessionAction"));
    assert.ok(assistedView.includes("authoriseDepartureAction"));
    assert.ok(assistedView.includes('currentJourney.status === "ready_to_depart"'));

    const scannerView = readWorkspaceFile("src/components/boarding/boarding-scanner-view.tsx");
    assert.ok(
      !scannerView.includes('currentJourney.status === "scheduled" || currentJourney.status === "bus_arrived"'),
      "Open boarding control must only render once bus_arrived is confirmed"
    );

    const manifestView = readWorkspaceFile("src/components/boarding/passenger-manifest-view.tsx");
    assert.ok(!manifestView.includes("startBoardingSession"));
    assert.ok(manifestView.includes('"ready_to_depart"'));
  });

  it("removes hardcoded student profile defaults and wires hostel onboarding safely", () => {
    const profileView = readWorkspaceFile("src/components/student/student-profile-view.tsx");
    assert.ok(!profileView.includes("Main Campus"));
    assert.ok(!profileView.includes("University Residence"));
    assert.ok(!profileView.includes("Standard Student Fleet"));
    assert.ok(profileView.includes("selectStudentHostelAction"));

    const registerPage = readWorkspaceFile("src/app/(auth)/register/page.tsx");
    assert.ok(registerPage.includes(".from(\"hostels\")"));

    const registerForm = readWorkspaceFile("src/app/(auth)/register/register-form.tsx");
    assert.ok(registerForm.includes("hostelOptions"));
    assert.ok(registerForm.includes("hostelId: hostelId || null"));
  });

  it("removes prohibited corridor terminology and retired rotation identifiers across src/, and ensures PWA icons exist", () => {
    const srcFiles = listTsFiles("src");
    assert.ok(srcFiles.length > 0);

    for (const filePath of srcFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      const rel = path.relative(ROOT, filePath);
      assert.strictEqual(
        /corridor/i.test(content),
        false,
        `Prohibited word "corridor" found in ${rel}`
      );
      assert.strictEqual(
        content.includes("operations_controller"),
        false,
        `Retired role operations_controller found in ${rel}`
      );
      assert.strictEqual(
        content.includes("/rotations"),
        false,
        `Retired route /rotations found in ${rel}`
      );
    }

    const manifest = JSON.parse(readWorkspaceFile("public/manifest.json")) as {
      icons?: Array<{ src: string }>;
    };
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
    for (const icon of manifest.icons) {
      const diskPath = path.join(ROOT, "public", icon.src.replace(/^\//, ""));
      assert.ok(fs.existsSync(diskPath), `Manifest icon missing on disk: ${icon.src}`);
      const stat = fs.statSync(diskPath);
      assert.ok(stat.size > 100, `Manifest icon unexpectedly small/empty: ${icon.src}`);
    }
  });
});

