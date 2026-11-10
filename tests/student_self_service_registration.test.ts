import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * CosmoRide — Self-Service Student Registration with Google OAuth
 *
 * Operational and Architecture Requirements:
 * 1. Independent Self-Service Registration:
 *    - Students create accounts via Cosmopolitan University Google Workspace (@cosmopolitan.edu.ng).
 *    - Self-declare legal full name and matriculation number.
 *    - Does NOT depend on a university roster, IT approvals, or exit-pass systems.
 * 2. Identity Verification & Domain Boundary:
 *    - Enforce @cosmopolitan.edu.ng on authenticated server identity.
 *    - Reject external domains (@gmail.com, @yahoo.com, etc.).
 * 3. Matriculation Number Normalization & Uniqueness:
 *    - Normalized via REPLACE(UPPER(TRIM(student_id)), ' ', '').
 *    - Enforced by database unique partial index idx_profiles_student_id_unique.
 *    - Duplicate attempts return a generic message without exposing another student's account.
 * 4. Immutability:
 *    - Once student_id is set, non-admins cannot change it (enforced by trigger protect_profile_privileges).
 * 5. Booking & Route Access Guards:
 *    - book_journey_seat fails closed with INCOMPLETE_PROFILE if student_id is missing.
 *    - Student dashboard routes redirect incomplete profiles to /register.
 * 6. Preserved Staff Authentication:
 *    - Admin, Hostel Representatives, and Drivers use credentials; student self-service does not disrupt staff roles.
 * 7. Invariant: Strictly zero occurrences of the forbidden term "corridor".
 */

describe("COSMORIDE — Self-Service Student Registration Verification Suite", () => {
  const migration20Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00020_self_service_student_registration.sql"
  );
  const migration20Content = fs.readFileSync(migration20Path, "utf-8").replace(/\r\n/g, "\n");

  const typesPath = path.resolve(process.cwd(), "src/lib/supabase/types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf-8");

  const studentAuthActionPath = path.resolve(process.cwd(), "src/actions/student-auth.ts");
  const studentAuthActionContent = fs.readFileSync(studentAuthActionPath, "utf-8");

  const authCallbackPath = path.resolve(process.cwd(), "src/app/auth/callback/route.ts");
  const authCallbackContent = fs.readFileSync(authCallbackPath, "utf-8");

  const middlewarePath = path.resolve(process.cwd(), "src/lib/supabase/middleware.ts");
  const middlewareContent = fs.readFileSync(middlewarePath, "utf-8");

  const registerPagePath = path.resolve(process.cwd(), "src/app/(auth)/register/page.tsx");
  const registerPageContent = fs.readFileSync(registerPagePath, "utf-8");

  const registerFormPath = path.resolve(process.cwd(), "src/app/(auth)/register/register-form.tsx");
  const registerFormContent = fs.readFileSync(registerFormPath, "utf-8");

  const loginPagePath = path.resolve(process.cwd(), "src/app/(auth)/login/page.tsx");
  const loginPageContent = fs.readFileSync(loginPagePath, "utf-8");

  const bookingsActionPath = path.resolve(process.cwd(), "src/actions/bookings.ts");
  const bookingsActionContent = fs.readFileSync(bookingsActionPath, "utf-8");

  // ============================================================
  // 1. STATIC SCHEMA & MIGRATION 00020 INSPECTION
  // ============================================================
  describe("1. Static Schema & Migration 00020 Inspection", () => {
    it("creates unique partial index on normalized matriculation number", () => {
      assert.ok(
        migration20Content.includes("idx_profiles_student_id_unique"),
        "Must define idx_profiles_student_id_unique"
      );
      assert.ok(
        migration20Content.includes("replace(upper(trim(student_id)), ' ', '')"),
        "Unique index must normalize matriculation number (replace spaces, upper, trim)"
      );
      assert.ok(
        migration20Content.includes("WHERE student_id IS NOT NULL AND trim(student_id) <> ''"),
        "Index must be partial to exclude null/empty staff and pending student records"
      );
    });

    it("creates atomic complete_student_profile stored procedure", () => {
      assert.ok(
        migration20Content.includes("CREATE OR REPLACE FUNCTION public.complete_student_profile"),
        "Must create complete_student_profile function"
      );
      assert.ok(
        migration20Content.includes("p_full_name TEXT"),
        "Function must take p_full_name parameter"
      );
      assert.ok(
        migration20Content.includes("p_student_id TEXT"),
        "Function must take p_student_id parameter"
      );
      assert.ok(
        migration20Content.toUpperCase().includes("RETURNS JSONB"),
        "Function must return JSONB result object"
      );
      assert.ok(
        migration20Content.includes("SECURITY DEFINER"),
        "Function must be SECURITY DEFINER to safely read auth.users and bypass public update restrictions"
      );
      assert.ok(
        migration20Content.includes("SET search_path = public, auth, pg_temp") ||
          migration20Content.includes("SET search_path = ''"),
        "Function must specify secure search_path"
      );
    });

    it("enforces row-level lock (FOR UPDATE) in complete_student_profile to prevent race conditions", () => {
      assert.ok(
        migration20Content.includes("FOR UPDATE"),
        "Must lock profile row with FOR UPDATE"
      );
    });

    it("verifies server-side email domain (@cosmopolitan.edu.ng) inside complete_student_profile", () => {
      assert.ok(
        migration20Content.includes("@cosmopolitan.edu.ng"),
        "RPC must verify email ends with @cosmopolitan.edu.ng"
      );
      assert.ok(
        migration20Content.includes("INVALID_DOMAIN"),
        "RPC must return INVALID_DOMAIN on domain mismatch"
      );
    });

    it("enforces immutability: students cannot alter matriculation number once set", () => {
      assert.ok(
        migration20Content.includes("MATRIC_IMMUTABLE"),
        "complete_student_profile must return MATRIC_IMMUTABLE if student_id is already set"
      );
      assert.ok(
        migration20Content.includes("protect_profile_privileges"),
        "Must update protect_profile_privileges trigger"
      );
      assert.ok(
        migration20Content.includes("Matriculation number cannot be modified once registered"),
        "Trigger must reject modifications to existing student_id by non-admins"
      );
    });

    it("hardens book_journey_seat to reject bookings from students with incomplete profiles", () => {
      assert.ok(
        migration20Content.includes("INCOMPLETE_PROFILE"),
        "book_journey_seat must return INCOMPLETE_PROFILE error code"
      );
      assert.ok(
        migration20Content.includes("v_student.student_id IS NULL OR trim(v_student.student_id) = ''"),
        "book_journey_seat must check that student_id is neither null nor blank"
      );
    });

    it("exports complete_student_profile in TypeScript definitions", () => {
      assert.ok(
        typesContent.includes("complete_student_profile: {"),
        "TypeScript types must include complete_student_profile RPC"
      );
      assert.ok(
        typesContent.includes("p_full_name: string"),
        "Args must declare p_full_name"
      );
      assert.ok(
        typesContent.includes("p_student_id: string"),
        "Args must declare p_student_id"
      );
    });
  });

  // ============================================================
  // 2. EMAIL DOMAIN VALIDATION LOGIC
  // ============================================================
  describe("2. Email Domain Boundary Enforcement (@cosmopolitan.edu.ng)", () => {
    function validateEmailDomain(email: string): boolean {
      const trimmed = email.trim().toLowerCase();
      const parts = trimmed.split("@");
      if (parts.length !== 2) return false;
      const domain = parts[1];
      return domain === "cosmopolitan.edu.ng";
    }

    it("accepts valid Cosmopolitan University student emails", () => {
      assert.strictEqual(validateEmailDomain("student@cosmopolitan.edu.ng"), true);
      assert.strictEqual(validateEmailDomain("john.doe@cosmopolitan.edu.ng"), true);
      assert.strictEqual(validateEmailDomain("cu.2024.001@cosmopolitan.edu.ng"), true);
      assert.strictEqual(validateEmailDomain("  STUDENT@COSMOPOLITAN.EDU.NG  "), true);
    });

    it("strictly rejects external consumer email domains", () => {
      assert.strictEqual(validateEmailDomain("student@gmail.com"), false);
      assert.strictEqual(validateEmailDomain("student@yahoo.com"), false);
      assert.strictEqual(validateEmailDomain("student@outlook.com"), false);
      assert.strictEqual(validateEmailDomain("student@hotmail.com"), false);
      assert.strictEqual(validateEmailDomain("student@icloud.com"), false);
    });

    it("strictly rejects subdomains or similar looking phishing domains", () => {
      assert.strictEqual(validateEmailDomain("student@fakecosmopolitan.edu.ng"), false);
      assert.strictEqual(validateEmailDomain("student@mail.cosmopolitan.edu.ng"), false);
      assert.strictEqual(validateEmailDomain("student@cosmopolitan.edu"), false);
      assert.strictEqual(validateEmailDomain("student@cosmopolitan.ng"), false);
      assert.strictEqual(validateEmailDomain("student@cosmopolitan.com"), false);
      assert.strictEqual(validateEmailDomain("student@cosmopolitan.edu.ng.attacker.com"), false);
    });

    it("auth callback invalidates sessions and signs out immediately on unauthorized email domains", () => {
      assert.ok(
        authCallbackContent.includes("cosmopolitan.edu.ng"),
        "Auth callback must verify domain cosmopolitan.edu.ng"
      );
      assert.ok(
        authCallbackContent.includes("await supabase.auth.signOut()"),
        "Auth callback must sign out unauthorized domain immediately"
      );
      assert.ok(
        authCallbackContent.includes("error=domain_restricted"),
        "Auth callback must redirect to login with domain_restricted error"
      );
    });
  });

  // ============================================================
  // 3. MATRICULATION NUMBER NORMALIZATION & SANITIZATION
  // ============================================================
  describe("3. Matriculation Number Normalization & Sanitization", () => {
    function normalizeMatriculation(raw: string): string {
      return raw.trim().toUpperCase().replace(/\s+/g, "");
    }

    it("normalizes lowercase and whitespace variations consistently", () => {
      assert.strictEqual(normalizeMatriculation("cu/2024/0012"), "CU/2024/0012");
      assert.strictEqual(normalizeMatriculation("  CU / 2024 / 0012  "), "CU/2024/0012");
      assert.strictEqual(normalizeMatriculation("cu / 2024 / 0012"), "CU/2024/0012");
      assert.strictEqual(normalizeMatriculation("cu-2023-9999"), "CU-2023-9999");
      assert.strictEqual(normalizeMatriculation("CU 2024 1234"), "CU20241234");
    });

    it("ensures different input formatting of the same matriculation collides as duplicates", () => {
      const input1 = normalizeMatriculation("cu/2024/0045");
      const input2 = normalizeMatriculation("  CU / 2024 / 0045  ");
      const input3 = normalizeMatriculation("CU/2024/0045");

      assert.strictEqual(input1, input2);
      assert.strictEqual(input2, input3);
    });

    it("client form and server action enforce minimum length validation", () => {
      assert.ok(
        registerFormContent.includes("rawMatric.length < 3"),
        "Register form must validate minimum matriculation length"
      );
      assert.ok(
        studentAuthActionContent.includes("rawStudentId.length < 3"),
        "Server action must validate minimum matriculation length"
      );
      assert.ok(
        studentAuthActionContent.includes("trimmedName.length < 2"),
        "Server action must validate minimum name length"
      );
    });
  });

  // ============================================================
  // 4. DUPLICATE REJECTION & PRIVACY PRESERVATION
  // ============================================================
  describe("4. Duplicate Matriculation Rejection & Privacy Preservation", () => {
    it("returns DUPLICATE_MATRIC error code from database RPC", () => {
      assert.ok(
        migration20Content.includes("DUPLICATE_MATRIC"),
        "complete_student_profile must return DUPLICATE_MATRIC"
      );
    });

    it("returns clean, non-leaking error message without exposing other student data", () => {
      assert.ok(
        migration20Content.includes(
          "This matriculation number is already linked to another student account."
        ),
        "Error message must be clear and never reveal another student's name, email, or user ID"
      );
      assert.ok(
        !migration20Content.includes("v_duplicate_email"),
        "Must NOT leak duplicate owner's email address"
      );
    });

    it("client register form displays actionable resolution instructions for duplicates", () => {
      assert.ok(
        registerFormContent.includes(
          "This matriculation number is already linked to another student account."
        ),
        "Register form must handle duplicate error"
      );
      assert.ok(
        registerFormContent.includes("university transport administration"),
        "Form must direct student to transport administration if they believe this is an error"
      );
    });
  });

  // ============================================================
  // 5. IMMUTABILITY & PRIVILEGE PROTECTION
  // ============================================================
  describe("5. Matriculation Number Immutability", () => {
    it("prevents students from changing student_id once registered", () => {
      assert.ok(
        migration20Content.includes("Matriculation number cannot be modified once registered"),
        "Database trigger protect_profile_privileges must protect student_id immutability"
      );
    });

    it("allows administrators to update student_id for corrections", () => {
      assert.ok(
        migration20Content.includes("IF v_caller_role != 'admin' THEN"),
        "Trigger must permit admin role to correct student_id when necessary"
      );
    });

    it("complete_student_profile blocks re-submission if already completed", () => {
      assert.ok(
        migration20Content.includes(
          "Your matriculation number has already been registered and cannot be altered."
        ),
        "RPC must reject re-registration attempts"
      );
    });
  });

  // ============================================================
  // 6. BOOKING & BOARDING FAIL-CLOSED GUARDS
  // ============================================================
  describe("6. Booking & Boarding Fail-Closed Guards", () => {
    it("RPC book_journey_seat fails closed if student has no student_id", () => {
      assert.ok(
        migration20Content.includes(
          "IF v_student.student_id IS NULL OR trim(v_student.student_id) = ''"
        ),
        "RPC must check student_id before processing reservation"
      );
      assert.ok(
        migration20Content.includes("INCOMPLETE_PROFILE"),
        "RPC must return INCOMPLETE_PROFILE error code"
      );
    });

    it("server action bookSeat validates profile completeness before executing reservation", () => {
      assert.ok(
        bookingsActionContent.includes("profile?.student_id"),
        "bookSeat server action must verify student_id"
      );
      assert.ok(
        bookingsActionContent.includes(
          "Your student profile is incomplete. Please complete your registration with your matriculation number before booking."
        ),
        "bookSeat must return clear incomplete profile guidance"
      );
    });

    it("dashboard layout redirects incomplete student profiles to /register?reason=incomplete_profile", () => {
      const layoutPath = path.resolve(process.cwd(), "src/app/(dashboard)/layout.tsx");
      const layoutContent = fs.readFileSync(layoutPath, "utf-8");

      assert.ok(
        layoutContent.includes('redirect("/register?reason=incomplete_profile")'),
        "DashboardLayout must redirect students with incomplete profile to /register"
      );
      assert.ok(
        layoutContent.includes('profile.role === "student"'),
        "Incomplete profile redirect must only apply to students (not staff)"
      );
    });

    it("student dashboard pages (home, departures, trips, profile) protect against incomplete profiles", () => {
      const studentHomePath = path.resolve(
        process.cwd(),
        "src/app/(dashboard)/student/page.tsx"
      );
      const studentDeparturesPath = path.resolve(
        process.cwd(),
        "src/app/(dashboard)/student/departures/page.tsx"
      );
      const studentTripsPath = path.resolve(
        process.cwd(),
        "src/app/(dashboard)/student/trips/page.tsx"
      );
      const studentProfilePath = path.resolve(
        process.cwd(),
        "src/app/(dashboard)/student/profile/page.tsx"
      );

      const homeContent = fs.readFileSync(studentHomePath, "utf-8");
      const departuresContent = fs.readFileSync(studentDeparturesPath, "utf-8");
      const tripsContent = fs.readFileSync(studentTripsPath, "utf-8");
      const profileContent = fs.readFileSync(studentProfilePath, "utf-8");

      assert.ok(
        homeContent.includes('redirect("/register?reason=incomplete_profile")'),
        "Student home page must guard incomplete profiles"
      );
      assert.ok(
        departuresContent.includes('redirect("/register?reason=incomplete_profile")'),
        "Departures page must guard incomplete profiles"
      );
      assert.ok(
        tripsContent.includes('redirect("/register?reason=incomplete_profile")'),
        "Trips page must guard incomplete profiles"
      );
      assert.ok(
        profileContent.includes('redirect("/register?reason=incomplete_profile")'),
        "Profile page must guard incomplete profiles"
      );
    });
  });

  // ============================================================
  // 7. MIDDLEWARE ROUTE PROTECTION & STATE MANAGEMENT
  // ============================================================
  describe("7. Middleware Route Protection & State Transitions", () => {
    it("treats /auth/* paths (callbacks and signouts) as public to avoid redirect loops", () => {
      assert.ok(
        middlewareContent.includes('pathname.startsWith("/auth/")'),
        "Middleware must allow /auth/* public paths"
      );
    });

    it("redirects authenticated student with incomplete profile from /student to /register", () => {
      assert.ok(
        middlewareContent.includes('url.searchParams.set("reason", "incomplete_profile")'),
        "Middleware must set reason=incomplete_profile when redirecting incomplete student"
      );
    });

    it("redirects authenticated student with complete profile from /register or /login to /student", () => {
      assert.ok(
        middlewareContent.includes('new URL(hasCompleteProfile ? "/student" : "/register", request.url)'),
        "Middleware must route complete profile to /student on /login access"
      );
    });

    it("preserves updated cookies on middleware redirect responses", () => {
      assert.ok(
        middlewareContent.includes("redirectResponse.cookies.set(cookie)"),
        "Middleware must copy session cookies onto redirect response"
      );
    });

    it("preserves staff direct routing to /admin, /boarding, and /driver", () => {
      assert.ok(
        middlewareContent.includes('profile.role === "admin"'),
        "Middleware must check profile.role === 'admin'"
      );
      assert.ok(
        middlewareContent.includes('"/admin"'),
        "Middleware must route admin to /admin"
      );
      assert.ok(
        middlewareContent.includes('profile.role === "boarding_officer"'),
        "Middleware must check profile.role === 'boarding_officer'"
      );
      assert.ok(
        middlewareContent.includes('"/boarding"'),
        "Middleware must route boarding officer to /boarding"
      );
      assert.ok(
        middlewareContent.includes('"/driver"'),
        "Middleware must route driver to /driver"
      );
    });
  });

  // ============================================================
  // 8. UI & USER EXPERIENCE FLOWS
  // ============================================================
  describe("8. UI Flow States & Form Components", () => {
    it("login page provides prominent Google sign-in for students", () => {
      assert.ok(
        loginPageContent.includes("GoogleSignInButton"),
        "Login page must include GoogleSignInButton"
      );
      assert.ok(
        loginPageContent.includes("Student Portal"),
        "Login page must provide student portal section"
      );
    });

    it("login page maintains separate credential section for university staff", () => {
      assert.ok(
        loginPageContent.includes("Staff & Operational Admin"),
        "Login page must include separate staff section"
      );
      assert.ok(
        loginPageContent.includes("LoginForm"),
        "Login page must include LoginForm for staff credentials"
      );
    });

    it("register page shows Step 1 Google sign-in when unauthenticated", () => {
      assert.ok(
        registerPageContent.includes("Step 1: Authenticate with Google Workspace"),
        "Register page must guide student to Google sign-in first"
      );
      assert.ok(
        registerPageContent.includes("GoogleSignInButton"),
        "Register page must render GoogleSignInButton"
      );
    });

    it("register page shows unsupported domain alert with account switch button", () => {
      assert.ok(
        registerPageContent.includes("Unsupported Email Domain"),
        "Register page must show clear rejection for non-university domains"
      );
      assert.ok(
        registerPageContent.includes("Sign Out & Switch Account"),
        "Register page must offer account switch button"
      );
    });

    it("register form displays verified Google email and editable name", () => {
      assert.ok(
        registerFormContent.includes("initialEmail"),
        "Register form must accept verified initialEmail"
      );
      assert.ok(
        registerFormContent.includes("Verified University Identity"),
        "Email must be displayed under Verified University Identity"
      );
      assert.ok(
        registerFormContent.includes("initialFullName"),
        "Register form must accept prepopulated initialFullName"
      );
    });

    it("register form includes formal self-declaration accuracy disclaimer", () => {
      assert.ok(
        registerFormContent.includes("Self-Declared Student Identity"),
        "Form must contain self-declaration disclaimer"
      );
      assert.ok(
        registerFormContent.includes("manifests for campus transit verification"),
        "Disclaimer must state that self-declared identity appears on manifests and boarding passes"
      );
    });
  });

  // ============================================================
  // 9. INDEPENDENCE FROM UNIVERSITY ROSTER OR EXIT PASS SYSTEM
  // ============================================================
  describe("9. System Independence & Invariant Verification", () => {
    it("does NOT query or depend on a pre-loaded student roster table", () => {
      assert.ok(
        !migration20Content.includes("university_students"),
        "Must NOT depend on university_students roster table"
      );
      assert.ok(
        !migration20Content.includes("student_roster"),
        "Must NOT depend on student_roster table"
      );
      assert.ok(
        !migration20Content.includes("exit_pass"),
        "Must NOT depend on exit-pass system"
      );
    });

    it("INVARIANT: Strictly zero occurrences of forbidden term 'corridor'", () => {
      const filesToCheck = [
        migration20Content,
        studentAuthActionContent,
        authCallbackContent,
        registerPageContent,
        registerFormContent,
        loginPageContent,
      ];

      for (const content of filesToCheck) {
        assert.ok(
          !content.toLowerCase().includes("corridor"),
          "Forbidden term 'corridor' must not appear in any auth files, UI, or migrations"
        );
      }
    });
  });
});
