import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canAccessAdminDomain } from "../src/lib/admin-auth";
import {
  routeSchema,
  scheduleSchema,
  createJourneySchema,
  createBookingSchema,
  verifyBoardingPassSchema,
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

  // Note: The following tests validate SQL migration structure, TypeScript validators,
  // server action preconditions, and pure-JS delay/capacity invariants locally.
  // They are NOT live PostgreSQL runtime executions (Postgres/psql/Docker are not installed locally).

  it("fixes the public.gender SQL type typo in 00022 and preserves valid boarding-scanner JSX endings", () => {
    const sql = readWorkspaceFile(
      "supabase/migrations/00022_core_system_security_and_workflow_remediation.sql"
    );
    assert.strictEqual(
      sql.includes("public.gender_group"),
      false,
      "Migration 00022 must not reference non-existent type public.gender_group"
    );
    assert.ok(
      sql.includes("v_effective_student_gender public.gender;"),
      "book_journey_seat must use existing enum type public.gender"
    );

    const scannerView = readWorkspaceFile("src/components/boarding/boarding-scanner-view.tsx");
    assert.strictEqual(
      scannerView.includes("journeyId = { currentJourney.id }"),
      false,
      "Corrupted duplicate trailing JSX must not appear in boarding-scanner-view.tsx"
    );
    assert.ok(
      scannerView.trimEnd().endsWith(");\n}") || scannerView.trimEnd().endsWith(");}"),
      "boarding-scanner-view.tsx must end cleanly with component closure"
    );
  });

  it("closes direct client waitlist UPDATE bypass and restricts check_driver_assignment_conflict execution", () => {
    const sql = readWorkspaceFile(
      "supabase/migrations/00022_core_system_security_and_workflow_remediation.sql"
    );

    // Waitlist direct UPDATE policy removed; only SELECT policy exists in 00022
    assert.ok(
      sql.includes('DROP POLICY IF EXISTS "Students can cancel own waitlist entry" ON public.waitlists;'),
      "Must drop legacy direct student waitlist UPDATE policy"
    );
    assert.strictEqual(
      /CREATE POLICY[\s\S]{0,120}ON public\.waitlists FOR (?:INSERT|UPDATE|DELETE)/i.test(sql),
      false,
      "Must not create direct client INSERT/UPDATE/DELETE policies on public.waitlists"
    );
    assert.ok(
      sql.includes("CREATE OR REPLACE FUNCTION public.cancel_waitlist_entry(") &&
        sql.includes("ORDER BY w.position ASC, w.created_at ASC"),
      "Waitlist cancellation and FIFO promotion must remain intact in RPCs"
    );

    // check_driver_assignment_conflict restricted to internal callers / service_role
    assert.ok(
      sql.includes("REVOKE EXECUTE ON FUNCTION public.check_driver_assignment_conflict(UUID, UUID, DATE, TIMESTAMPTZ, UUID, UUID) FROM PUBLIC, anon, authenticated;"),
      "Direct execute on check_driver_assignment_conflict must be revoked from PUBLIC, anon, authenticated"
    );
    assert.ok(
      sql.includes("GRANT EXECUTE ON FUNCTION public.check_driver_assignment_conflict(UUID, UUID, DATE, TIMESTAMPTZ, UUID, UUID) TO service_role;"),
      "Execute on check_driver_assignment_conflict must be granted only to service_role"
    );
    assert.ok(
      sql.includes("IF pg_catalog.pg_trigger_depth() = 0 THEN") &&
        sql.includes("AND p.admin_role IN ('super_admin', 'bus_manager')"),
      "check_driver_assignment_conflict must validate non-trigger caller privileges"
    );
  });

  it("protects public.journeys lifecycle, readiness, and delay columns via trigger while allowing non-lifecycle admin edits", () => {
    const sql = readWorkspaceFile(
      "supabase/migrations/00022_core_system_security_and_workflow_remediation.sql"
    );

    assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.protect_journey_lifecycle()"));
    assert.ok(sql.includes("CREATE TRIGGER enforce_journey_lifecycle_protection"));
    assert.ok(
      sql.includes(
        "REVOKE EXECUTE ON FUNCTION public.protect_journey_lifecycle() FROM PUBLIC, anon, authenticated, service_role;"
      )
    );
    assert.ok(
      sql.includes("AND NEW.readiness_status = 'failed_unsafe' THEN") &&
        sql.includes("Safety violation: Pre-departure vehicle check was flagged unsafe. Dispatch blocked.")
    );
    assert.ok(
      sql.includes("cosmoride.internal_journey_workflow"),
      "Workflow RPCs and protection trigger must coordinate via cosmoride.internal_journey_workflow"
    );

    // Ensure non-lifecycle fields (e.g., vehicle_id, driver_id, scheduled_departure) are NOT blocked by protect_journey_lifecycle
    const triggerBodyStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.protect_journey_lifecycle()");
    const triggerBodyEnd = sql.indexOf("CREATE TRIGGER enforce_journey_lifecycle_protection");
    const triggerSql = sql.slice(triggerBodyStart, triggerBodyEnd);
    assert.ok(triggerSql.includes("NEW.status IS DISTINCT FROM OLD.status"));
    assert.ok(triggerSql.includes("NEW.readiness_status IS DISTINCT FROM OLD.readiness_status"));
    assert.ok(triggerSql.includes("NEW.delay_minutes IS DISTINCT FROM OLD.delay_minutes"));
    assert.strictEqual(
      triggerSql.includes("NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id"),
      false,
      "Non-lifecycle admin edits to vehicle_id on pre-dispatch trips must remain permitted"
    );
    assert.strictEqual(
      triggerSql.includes("NEW.scheduled_departure IS DISTINCT FROM OLD.scheduled_departure"),
      false,
      "Non-lifecycle admin edits to scheduled_departure on pre-dispatch trips must remain permitted"
    );

    // Verify all 11 workflow RPC UPDATE sites opt into cosmoride.internal_journey_workflow
    const updateMatches = sql.match(/\bUPDATE public\.journeys\b/g) ?? [];
    assert.strictEqual(updateMatches.length, 11, "Expected 11 controlled UPDATE public.journeys blocks in 00022");
    const optInMatches =
      sql.match(/set_config\('cosmoride\.internal_journey_workflow',\s*'on',\s*true\)/g) ?? [];
    assert.strictEqual(
      optInMatches.length,
      updateMatches.length,
      "Every workflow RPC UPDATE on public.journeys must set cosmoride.internal_journey_workflow = on"
    );
  });

  it("propagates delay_minutes into effective departure conflict detection and rejects overlapping delays cleanly", () => {
    const sql = readWorkspaceFile(
      "supabase/migrations/00022_core_system_security_and_workflow_remediation.sql"
    );

    assert.ok(
      sql.includes(
        "v_effective_departure := NEW.scheduled_departure + (COALESCE(NEW.delay_minutes, 0) * INTERVAL '1 minute');"
      ),
      "enforce_journey_vehicle_availability must compute effective delayed departure"
    );
    assert.ok(
      sql.includes("EXCEPTION WHEN check_violation THEN") &&
        sql.includes("'code', 'ASSIGNMENT_CONFLICT'"),
      "record_journey_delay_with_notifications must catch check_violation cleanly as ASSIGNMENT_CONFLICT"
    );

    // Behavioral model check of delayed overlap window
    function hasWindowOverlap(
      trip1StartIso: string,
      trip1DelayMin: number,
      trip1DurationMin: number,
      trip2StartIso: string,
      trip2DelayMin: number,
      trip2DurationMin: number
    ): boolean {
      const start1 = Date.parse(trip1StartIso) + trip1DelayMin * 60_000;
      const end1 = start1 + trip1DurationMin * 60_000;
      const start2 = Date.parse(trip2StartIso) + trip2DelayMin * 60_000;
      const end2 = start2 + trip2DurationMin * 60_000;
      return start1 < end2 && end1 > start2;
    }

    assert.strictEqual(
      hasWindowOverlap("2026-11-12T08:00:00Z", 0, 45, "2026-11-12T09:00:00Z", 0, 45),
      false,
      "08:00-08:45 clears 09:00-09:45 before delay"
    );
    assert.strictEqual(
      hasWindowOverlap("2026-11-12T08:00:00Z", 30, 45, "2026-11-12T09:00:00Z", 0, 45),
      true,
      "30m delay shifts window to 08:30-09:15 which overlaps 09:00-09:45"
    );
  });

  it("enforces boarding stop selection, cancellation cutoff, manual override reason, and 20+12=32 capacity invariants", () => {
    const sql = readWorkspaceFile(
      "supabase/migrations/00022_core_system_security_and_workflow_remediation.sql"
    );

    // 1. Missing boarding stop rejection in SQL + Zod schema
    assert.ok(
      sql.includes("IF p_boarding_stop_id IS NULL THEN") &&
        sql.includes("'code', 'BOARDING_STOP_REQUIRED'"),
      "book_journey_seat must reject missing boarding stop"
    );
    assert.strictEqual(
      createBookingSchema.safeParse({
        journeyId: "550e8400-e29b-41d4-a716-446655440000",
        boardingStopId: "",
      }).success,
      false
    );

    // 2. Cancellation cutoff enforcement in cancel_booking_and_promote + settings validation
    assert.ok(
      sql.includes("WHERE key = 'cancellation_cutoff_minutes'") &&
        sql.includes("CANCELLATION_CUTOFF_EXCEEDED") &&
        sql.includes("ELSIF p_key = 'cancellation_cutoff_minutes' THEN"),
      "cancel_booking_and_promote must enforce cancellation_cutoff_minutes setting"
    );

    // 3. Manual override auditability in SQL + Zod schema + actions
    assert.ok(
      sql.includes("IF p_boarding_method = 'manual_override' AND length(COALESCE(v_exception_reason, '')) < 5 THEN") &&
        sql.includes("'code', 'EXCEPTION_REASON_REQUIRED'") &&
        sql.includes("'exception_reason', v_exception_reason"),
      "verify_and_board_passenger must require and audit >=5-char reason for manual_override"
    );
    assert.strictEqual(
      verifyBoardingPassSchema.safeParse({
        ticketToken: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        journeyId: "550e8400-e29b-41d4-a716-446655440000",
        boardingMethod: "manual_override",
        exceptionReason: "   ",
      }).success,
      false,
      "verifyBoardingPassSchema must reject blank manual_override reason"
    );
    assert.strictEqual(
      verifyBoardingPassSchema.safeParse({
        ticketToken: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        journeyId: "550e8400-e29b-41d4-a716-446655440000",
        boardingMethod: "qr_scan",
      }).success,
      true,
      "verifyBoardingPassSchema must still allow qr_scan without exceptionReason"
    );

    // 4. Preserve 20 seated + 12 standing = 32 capacity ceiling
    assert.ok(sql.includes("v_seated_cap := 20;") || sql.includes("COALESCE(v_journey.seated_capacity, 20)"));
    assert.ok(sql.includes("v_standing_cap := 12;") || sql.includes("COALESCE(v_journey.standing_capacity, 12)"));
    assert.ok(sql.includes("32"), "Total capacity ceiling 32 must remain intact");
  });
});

