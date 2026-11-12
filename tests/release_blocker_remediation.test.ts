import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_ADMIN_SUB_ROLES,
  isAllowedAdminSubRole,
  canAccessAdminDomain,
  getDefaultAdminHome,
  getRoleHome,
} from "../src/lib/role-routing";
import { calculateAvailableSeats, calculateCapacityBreakdown } from "../src/lib/utils";

const ROOT = process.cwd();

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function listFilesRecursive(dirRel: string, exts: string[]): string[] {
  const results: string[] = [];
  function walk(absDir: string) {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const fullPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  walk(path.join(ROOT, dirRel));
  return results;
}

describe("CosmoRide Consolidated Release-Blocker Remediation (00023)", () => {
  const sql23 = readRel("supabase/migrations/00023_release_blocker_remediation.sql");
  const typesTs = readRel("src/lib/supabase/types.ts");

  it("1. drops unsafe legacy function overloads, hardens grants, and locks ALTER DEFAULT PRIVILEGES", () => {
    assert.ok(sql23.includes("DROP FUNCTION IF EXISTS public.cancel_booking_and_promote(UUID, UUID);"));
    assert.ok(sql23.includes("DROP FUNCTION IF EXISTS public.close_and_depart_journey(UUID, UUID, BOOLEAN, TEXT);"));

    assert.ok(sql23.includes("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;"));
    assert.ok(
      sql23.includes("ALTER DEFAULT PRIVILEGES IN SCHEMA public") &&
      sql23.includes("REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;")
    );

    for (const triggerFn of [
      "public.handle_updated_at()",
      "public.handle_new_user()",
      "public.protect_profile_privileges()",
      "public.prevent_audit_log_modification()",
      "public.enforce_journey_vehicle_availability()",
      "public.protect_journey_lifecycle()",
    ]) {
      assert.ok(
        sql23.includes(`REVOKE EXECUTE ON FUNCTION ${triggerFn} FROM PUBLIC, anon, authenticated, service_role;`),
        `Trigger helper ${triggerFn} must be revoked from all roles`
      );
    }

    for (const studentRpc of [
      "public.book_journey_seat(UUID, UUID, UUID)",
      "public.cancel_booking_and_promote(UUID, UUID, TEXT)",
      "public.cancel_waitlist_entry(UUID, UUID)",
      "public.select_student_hostel(UUID)",
      "public.complete_student_profile(TEXT, TEXT, UUID)",
    ]) {
      assert.ok(
        sql23.includes(`REVOKE EXECUTE ON FUNCTION ${studentRpc} FROM PUBLIC, anon, service_role;`) &&
        sql23.includes(`GRANT EXECUTE ON FUNCTION ${studentRpc} TO authenticated;`),
        `Student RPC ${studentRpc} must execute only as authenticated`
      );
    }

    for (const newRpc of [
      "get_student_departure_occupancy",
      "report_operational_incident",
      "admin_set_user_active_status",
      "admin_update_schedule_template",
      "admin_toggle_schedule_status",
      "admin_link_driver_profile",
    ]) {
      assert.ok(sql23.includes(`public.${newRpc}(`), `Migration 00023 must define ${newRpc}`);
      assert.ok(typesTs.includes(`${newRpc}:`), `types.ts must declare ${newRpc}`);
    }
    assert.ok(typesTs.includes("confirm_journey_dispatch:"), "confirm_journey_dispatch must remain in types.ts");
  });

  it("2. enforces profiles.is_active across RLS helpers, own-row policies, auth callback, middleware, layouts, and actions", () => {
    assert.ok(sql23.includes("WHEN p.is_active IS TRUE THEN p.role"));
    assert.ok(sql23.includes("AND p.is_active IS TRUE"));
    for (const policyName of [
      "Users can update own non-privileged profile",
      "Students can view own bookings",
      "Students can view own waitlist status",
      "Students can view own boarding records",
      "Users can view own notifications",
      "Users can mark own notifications as read",
    ]) {
      assert.ok(
        sql23.includes(`CREATE POLICY "${policyName}"`) && sql23.includes("public.rls_user_is_active()"),
        `Own-row policy "${policyName}" must enforce rls_user_is_active()`
      );
    }

    const middleware = readRel("src/lib/supabase/middleware.ts");
    const callback = readRel("src/app/auth/callback/route.ts");
    const loginForm = readRel("src/app/(auth)/login/login-form.tsx");
    const loginPage = readRel("src/app/(auth)/login/page.tsx");
    const dashboardLayout = readRel("src/app/(dashboard)/layout.tsx");
    const adminAuth = readRel("src/lib/admin-auth.ts");

    for (const content of [middleware, callback, dashboardLayout, adminAuth]) {
      assert.ok(content.includes("account_inactive"), "Route guards must route deactivated users to account_inactive");
    }
    assert.ok(
      loginForm.includes("!profile || profile.is_active === false") &&
        loginForm.includes("await supabase.auth.signOut()") &&
        loginForm.includes("setError(") &&
        loginForm.includes("deactivated"),
      "Login form must sign out and show an inline deactivation message for inactive accounts"
    );
    assert.ok(loginPage.includes("account_inactive"), "Login page must render suspension banner for account_inactive");
    assert.ok(middleware.includes("profile.is_active === false") && middleware.includes("await supabase.auth.signOut()"));

    for (const actionFile of [
      "src/actions/bookings.ts",
      "src/actions/notifications.ts",
      "src/actions/student-auth.ts",
      "src/actions/users.ts",
      "src/actions/driver.ts",
      "src/actions/boarding.ts",
      "src/actions/journeys.ts",
    ]) {
      const code = readRel(actionFile);
      assert.ok(code.includes("is_active"), `${actionFile} must check active user state`);
    }
  });

  it("3. closes broad operational table policies and moves incident submission to report_operational_incident RPC", () => {
    assert.ok(sql23.includes('DROP POLICY IF EXISTS "Authenticated users can view readiness checks" ON public.vehicle_readiness_checks;'));
    assert.ok(sql23.includes('DROP POLICY IF EXISTS "Staff can insert readiness checks" ON public.vehicle_readiness_checks;'));
    assert.ok(sql23.includes('DROP POLICY IF EXISTS "Authenticated users can view stop updates" ON public.journey_stop_updates;'));
    assert.ok(sql23.includes('DROP POLICY IF EXISTS "Staff can insert stop updates" ON public.journey_stop_updates;'));
    assert.ok(sql23.includes('DROP POLICY IF EXISTS "Staff can view operational logs" ON public.journey_operational_logs;'));
    assert.ok(sql23.includes('DROP POLICY IF EXISTS "Staff can insert operational logs" ON public.journey_operational_logs;'));

    assert.ok(
      sql23.includes("CREATE OR REPLACE FUNCTION public.report_operational_incident(") &&
      sql23.includes("CROSS_GROUP_DENIED") &&
      sql23.includes("UNASSIGNED_DRIVER") &&
      sql23.includes("INCIDENT_REPORTED")
    );

    const driverAction = readRel("src/actions/driver.ts");
    const boardingAction = readRel("src/actions/boarding.ts");
    assert.ok(driverAction.includes('.rpc("report_operational_incident"'));
    assert.ok(boardingAction.includes('.rpc("report_operational_incident"'));
    assert.ok(!driverAction.includes('.from("incident_reports").insert'));
    assert.ok(!boardingAction.includes('.from("incident_reports").insert'));
  });

  it("4. enforces explicit admin_role checks and positive capacity in admin_create_journey", () => {
    assert.ok(
      sql23.includes("v_admin.admin_role NOT IN ('super_admin', 'bus_manager')") &&
      sql23.includes("'UNVERIFIED_VEHICLE_CAPACITY'") &&
      sql23.includes("v_safe_capacity <= 0")
    );
  });

  it("5. enforces real vehicle capacity bounded at 20 seated + 12 standing = 32 max without failing open on zero/null", () => {
    assert.strictEqual(calculateAvailableSeats(32, 32, 0), 32);
    assert.strictEqual(calculateAvailableSeats(24, 32, 4), 20);
    assert.strictEqual(calculateAvailableSeats(40, 32, 0), 32);
    assert.strictEqual(calculateAvailableSeats(0, 32, 0), 0);
    assert.strictEqual(calculateAvailableSeats(-1, 32, 0), 0);
    assert.strictEqual(calculateAvailableSeats(32, 0, 0), 0);

    assert.deepStrictEqual(
      calculateCapacityBreakdown({ proposedAllocation: 32, safeCapacity: 32 }),
      { seatedLimit: 20, standingLimit: 12, effectiveCapacity: 32 }
    );
    assert.deepStrictEqual(
      calculateCapacityBreakdown({ proposedAllocation: 24, safeCapacity: 24 }),
      { seatedLimit: 20, standingLimit: 4, effectiveCapacity: 24 }
    );
    assert.deepStrictEqual(
      calculateCapacityBreakdown({ proposedAllocation: 16, safeCapacity: 16 }),
      { seatedLimit: 16, standingLimit: 0, effectiveCapacity: 16 }
    );
    assert.deepStrictEqual(
      calculateCapacityBreakdown({ proposedAllocation: 32, safeCapacity: 0 }),
      { seatedLimit: 0, standingLimit: 0, effectiveCapacity: 0 }
    );
    assert.deepStrictEqual(
      calculateCapacityBreakdown({ proposedAllocation: 32, safeCapacity: null }),
      { seatedLimit: 0, standingLimit: 0, effectiveCapacity: 0 }
    );

    assert.ok(
      sql23.includes("v_journey.safe_capacity IS NULL OR v_journey.safe_capacity <= 0") &&
      sql23.includes("LEAST(COALESCE(v_journey.seated_capacity, 20), 20, v_effective_capacity)") &&
      sql23.includes("LEAST(COALESCE(v_journey.standing_capacity, 12), 12, GREATEST(0, v_effective_capacity - v_max_seated))")
    );
  });

  it("6. isolates Stage 7 dispatch, cancellation, assisted Mode B departure, and Hostel Manager read-only dispatch", () => {
    assert.deepStrictEqual([...ALLOWED_ADMIN_SUB_ROLES], ["super_admin", "bus_manager", "hostel_manager"]);
    assert.strictEqual(isAllowedAdminSubRole("super_admin"), true);
    assert.strictEqual(isAllowedAdminSubRole("bus_manager"), true);
    assert.strictEqual(isAllowedAdminSubRole("hostel_manager"), true);
    assert.strictEqual(isAllowedAdminSubRole("operations_controller"), false);
    assert.strictEqual(isAllowedAdminSubRole(null), false);

    assert.strictEqual(getDefaultAdminHome("bus_manager"), "/admin/dispatch");
    assert.strictEqual(getDefaultAdminHome("hostel_manager"), "/admin");
    assert.strictEqual(getRoleHome("admin", "bus_manager"), "/admin/dispatch");
    assert.strictEqual(getRoleHome("boarding_officer"), "/boarding");
    assert.strictEqual(getRoleHome("driver"), "/driver");
    assert.strictEqual(getRoleHome("student"), "/student");

    assert.strictEqual(canAccessAdminDomain("bus_manager", "dispatch"), true);
    assert.strictEqual(canAccessAdminDomain("bus_manager", "users"), false);
    assert.strictEqual(canAccessAdminDomain("hostel_manager", "dispatch"), true);
    assert.strictEqual(canAccessAdminDomain("hostel_manager", "journey_create"), false);

    // SQL governance isolation
    assert.ok(sql23.includes("Stage 7 rolling dispatch confirmation is restricted to Super Administrators and the Bus Manager."));
    assert.ok(sql23.includes("Stage 7 departure confirmation is restricted to Super Administrators and the Bus Manager."));
    assert.ok(sql23.includes("Only Super Administrators and the Bus Manager may cancel journeys."));
    assert.ok(sql23.includes("'ASSISTED_MODE_REQUIRED'"));
    assert.ok(sql23.includes("'DIRECT_DRIVER_MODE_REQUIRED'"));
    assert.ok(sql23.includes("v_journey.driver_record_id IS NULL OR v_journey.assigned_driver_has_app IS TRUE"));

    // UI read-only & cancel restrictions
    const dispatchPage = readRel("src/app/(dashboard)/admin/dispatch/page.tsx");
    const dispatchView = readRel("src/components/admin/bus-manager-dispatch-view.tsx");
    const journeysPage = readRel("src/app/(dashboard)/admin/journeys/page.tsx");
    const journeysView = readRel("src/components/admin/journeys-management.tsx");
    assert.ok(dispatchPage.includes('isReadOnlySupervisory = adminRole === "hostel_manager"'));
    assert.ok(dispatchView.includes("Supervisory Read-Only View (Hostel Manager)"));
    assert.ok(dispatchView.includes("!isReadOnlySupervisory && j.status === \"ready_to_depart\""));
    assert.match(
      journeysPage,
      /\bconst\s+canCancelJourneys\s*=\s*adminRole\s*===\s*"super_admin"\s*\|\|\s*adminRole\s*===\s*"bus_manager"\s*;/
    );
    assert.ok(journeysPage.includes("canCancelJourneys={canCancelJourneys}"));
    assert.ok(journeysView.includes("canCancelJourneys &&"));
  });

  it("7. blocks unassigned boarding officers across all /boarding SSR routes", () => {
    for (const rel of [
      "src/app/(dashboard)/boarding/page.tsx",
      "src/app/(dashboard)/boarding/boarding/page.tsx",
      "src/app/(dashboard)/boarding/assisted/page.tsx",
      "src/app/(dashboard)/boarding/passengers/page.tsx",
      "src/app/(dashboard)/boarding/profile/page.tsx",
    ]) {
      const code = readRel(rel);
      assert.ok(code.includes("requireOperationalStaffPageAccess"), `${rel} must use requireOperationalStaffPageAccess`);
      assert.ok(code.includes("Unassigned") || code.includes("unassignedTransportGroup"), `${rel} must block unassigned boarding officers explicitly`);
    }

    const scannerView = readRel("src/components/boarding/boarding-scanner-view.tsx");
    assert.ok(scannerView.includes("if (unassignedTransportGroup)"));
  });

  it("8. provides Admin governance actions & UI controls for driver Mode A linking, recurring schedule edits/toggles, user status, and route duration", () => {
    const adminActions = readRel("src/actions/admin.ts");
    for (const fn of [
      "setUserActiveStatusAction",
      "linkDriverProfileAction",
      "updateScheduleTemplateAction",
      "toggleScheduleStatusAction",
      "updateRouteDurationAction",
    ]) {
      assert.ok(adminActions.includes(`export async function ${fn}`), `admin.ts must export ${fn}`);
    }

    const driversPage = readRel("src/app/(dashboard)/admin/drivers/page.tsx");
    const driversView = readRel("src/components/admin/drivers-management.tsx");
    assert.ok(driversPage.includes("driverProfiles") && driversView.includes("linkDriverProfileAction"));
    assert.ok(driversView.includes("Mode B: Assisted"));

    const usersView = readRel("src/components/admin/users-management.tsx");
    assert.ok(usersView.includes("setUserActiveStatusAction") && usersView.includes("Suspend") && usersView.includes("Reactivate"));

    const schedulesView = readRel("src/components/admin/schedules-management.tsx");
    assert.ok(
      schedulesView.includes("updateScheduleTemplateAction") &&
      schedulesView.includes("toggleScheduleStatusAction") &&
      schedulesView.includes("Existing generated journeys remain preserved")
    );

    const routesView = readRel("src/components/admin/routes-management.tsx");
    assert.ok(
      routesView.includes("updateRouteDurationAction") &&
      routesView.includes("Unconfigured (blocks automated vehicle conflict window checks)")
    );
  });

  it("9. uses batch get_student_departure_occupancy and strictly restricts student booking/waitlist to scheduled trips", () => {
    const studentHome = readRel("src/app/(dashboard)/student/page.tsx");
    const departuresPage = readRel("src/app/(dashboard)/student/departures/page.tsx");
    const departureBoard = readRel("src/components/student/departure-board.tsx");

    assert.ok(studentHome.includes('.rpc("get_student_departure_occupancy"'));
    assert.ok(departuresPage.includes('.rpc("get_student_departure_occupancy"'));
    assert.ok(!departuresPage.includes('from("bookings").select("*")'));
    assert.ok(departureBoard.includes('const isBookingWindowOpen = j.status === "scheduled" && totalLimit > 0;'));
  });

  it("10. aligns boarding status codes, readiness display, closureNotes wiring, and removes Stage 7 bypass from boarding scanner", () => {
    const boardingAction = readRel("src/actions/boarding.ts");
    const modal = readRel("src/components/boarding/scan-result-modal.tsx");
    const scannerView = readRel("src/components/boarding/boarding-scanner-view.tsx");

    for (const code of [
      "BOARDING_APPROVED",
      "ALREADY_CHECKED_IN",
      "CANCELLED_TICKET",
      "BUS_FULL",
      "UNVERIFIED_VEHICLE_CAPACITY",
    ]) {
      assert.ok(boardingAction.includes(`"${code}"`), `boarding.ts must type status code ${code}`);
      assert.ok(modal.includes(`case "${code}":`), `scan-result-modal.tsx must handle status code ${code}`);
    }

    assert.ok(boardingAction.includes("result?.seated_count"));
    assert.ok(boardingAction.includes("result?.standing_count"));

    assert.ok(scannerView.includes("readinessStatus"));
    assert.ok(scannerView.includes("closureNotes"));
    assert.ok(scannerView.includes("closeBoardingSessionAction(currentJourney.id, closureNotes.trim() || undefined)"));
    assert.ok(scannerView.includes("authoriseDepartureAction(currentJourney.id, closureNotes.trim() || undefined)"));
    assert.ok(!scannerView.includes("closeAndDepartJourneyAction"));
    assert.ok(!scannerView.includes("confirmDispatchAction"));
  });

  it("11. documents unregistered online-only service worker, removes dead closure modal & dead action exports", () => {
    const sw = readRel("public/sw.js");
    const layout = readRel("src/app/layout.tsx");
    assert.ok(sw.includes("Intentionally Unregistered (Online-Only Security Policy)"));
    assert.ok(!layout.includes("serviceWorker.register"));

    assert.strictEqual(
      fs.existsSync(path.join(ROOT, "src/components/boarding/journey-closure-modal.tsx")),
      false,
      "journey-closure-modal.tsx must be deleted"
    );

    const boardingAction = readRel("src/actions/boarding.ts");
    const bookingsAction = readRel("src/actions/bookings.ts");
    assert.ok(!boardingAction.includes("export async function startBoardingSession"));
    assert.ok(!boardingAction.includes("export async function closeAndDepartJourneyAction"));
    assert.ok(!boardingAction.includes("export async function departJourney"));
    assert.ok(!bookingsAction.includes("export async function verifyAndBoardPass"));
    assert.ok(!bookingsAction.includes("/boarding/sessions"));
  });

  it("12. contains zero forbidden terminology across src/ and migration 00023, and eliminates hardcoded fake UI fallbacks", () => {
    const forbiddenWord = new RegExp("corri" + "dor", "i");
    assert.strictEqual(forbiddenWord.test(sql23), false, "Migration 00023 must not contain forbidden terminology");

    const srcFiles = listFilesRecursive("src", [".ts", ".tsx"]);
    for (const filePath of srcFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      const rel = path.relative(ROOT, filePath);
      assert.strictEqual(forbiddenWord.test(content), false, `Forbidden terminology found in ${rel}`);
    }

    const driverPage = readRel("src/app/(dashboard)/driver/page.tsx");
    const driverProfile = readRel("src/app/(dashboard)/driver/profile/page.tsx");
    const boardingAssisted = readRel("src/app/(dashboard)/boarding/assisted/page.tsx");
    const driverDashboard = readRel("src/components/driver/driver-dashboard-view.tsx");

    assert.ok(!driverPage.includes('"DRV-CU"'));
    assert.ok(!driverProfile.includes('"DRV-CU-APP"'));
    assert.ok(!boardingAssisted.includes('"CU-EB-01"'));
    assert.ok(!boardingAssisted.includes('"DRV-CU-01"'));
    assert.ok(!driverDashboard.includes('"Main Campus Terminal"'));
    assert.ok(!driverDashboard.includes('"Electric Transit Coach"'));
  });
});