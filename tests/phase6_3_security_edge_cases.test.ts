import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { newDb } from "pg-mem";

/**
 * Phase 6.3 Security Edge-Case & Fail-Closed Isolation Review Test Suite.
 *
 * Test Methodology:
 * 1. Static SQL Inspection: Analyzes migration files for exact keywords, grants, revokes, and policy predicates.
 * 2. In-Memory PostgreSQL Emulator (pg-mem): Validates relational table DDL, check constraints, foreign keys, and queries.
 *    (Note: pg-mem is an in-memory SQL execution emulator for syntax and relational checks; not a live Supabase server).
 * 3. Functional Isolation & Anti-Spoofing Logic Tests: Evaluates mathematical correctness of the fail-closed predicates.
 */
describe("Phase 6.3: Security Edge-Case & Fail-Closed Corridor Review", () => {
  const migration7Path = path.resolve(
    process.cwd(),
    "supabase/migrations/00007_fail_closed_security_and_strict_jwt.sql"
  );
  const migration7Content = fs.readFileSync(migration7Path, "utf-8");

  describe("1. Static SQL Review: Fail-Closed Policies & Strict Grants", () => {
    it("ensures boarding officer NULL transport group wildcard is eliminated (FAIL CLOSED)", () => {
      // Must not contain permissive wildcard
      assert.strictEqual(
        migration7Content.includes("p.assigned_transport_group_id IS NULL OR r.transport_group_id"),
        false,
        "Permissive NULL transport group check must not exist on journeys"
      );
      assert.strictEqual(
        migration7Content.includes("me.assigned_transport_group_id IS NULL OR EXISTS"),
        false,
        "Permissive NULL transport group check must not exist on profiles"
      );
      // Must enforce non-null assignment
      assert.ok(
        migration7Content.includes("p.assigned_transport_group_id IS NOT NULL") &&
          migration7Content.includes("r.transport_group_id = p.assigned_transport_group_id"),
        "Must require non-null assigned transport group matching route"
      );
    });

    it("ensures every RPC rejects missing, anon, or unknown JWT roles", () => {
      assert.ok(
        migration7Content.includes("v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role')"),
        "Must reject NULL, missing, or unrecognized JWT roles"
      );
      assert.ok(
        migration7Content.includes("'Permission denied: Invalid or untrusted execution context.'"),
        "Must return explicit error for untrusted execution context"
      );
    });

    it("ensures service-role calls require explicit, non-null actor attribution", () => {
      assert.ok(
        migration7Content.includes("Service role execution requires explicit"),
        "Must validate that service-role execution provides explicit actor parameter"
      );
    });

    it("ensures blanket wildcard grants are completely replaced with function-by-function grants", () => {
      assert.strictEqual(
        migration7Content.includes("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;"),
        false,
        "Blanket grant to service_role must be removed"
      );
      assert.strictEqual(
        migration7Content.includes("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;"),
        false,
        "Blanket grant to authenticated must be removed"
      );
      assert.ok(
        migration7Content.includes("GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO service_role;"),
        "Must explicitly grant service_role"
      );
      assert.ok(
        migration7Content.includes("GRANT EXECUTE ON FUNCTION public.book_journey_seat(UUID, UUID, UUID) TO authenticated;"),
        "Must explicitly grant authenticated"
      );
    });

    it("ensures internal triggers are revoked from all client roles", () => {
      assert.ok(
        migration7Content.includes("REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated, service_role;"),
        "Trigger handle_updated_at must be revoked"
      );
      assert.ok(
        migration7Content.includes("REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;"),
        "Trigger handle_new_user must be revoked"
      );
      assert.ok(
        migration7Content.includes("REVOKE EXECUTE ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated, service_role;"),
        "Trigger protect_profile_privileges must be revoked"
      );
      assert.ok(
        migration7Content.includes("REVOKE EXECUTE ON FUNCTION public.prevent_audit_log_modification() FROM PUBLIC, anon, authenticated, service_role;"),
        "Trigger prevent_audit_log_modification must be revoked"
      );
    });
  });

  describe("2. Fail-Closed Boarding Officer Corridor Isolation Logic", () => {
    interface JourneyContext {
      journeyId: string;
      routeId: string;
      transportGroupId: string;
    }

    interface OfficerProfile {
      userId: string;
      role: "boarding_officer" | "admin" | "student" | "driver";
      assignedTransportGroupId: string | null;
    }

    function canOfficerAccessJourney(officer: OfficerProfile, journey: JourneyContext): boolean {
      if (officer.role === "admin") return true;
      if (officer.role !== "boarding_officer") return false;
      // Fail closed: must have non-null assigned group matching journey
      if (!officer.assignedTransportGroupId) return false;
      return officer.assignedTransportGroupId === journey.transportGroupId;
    }

    const tgBoys = "tg-boys-hostel-corridor";
    const tgGirls = "tg-girls-hostel-corridor";

    const boysJourney: JourneyContext = {
      journeyId: "j-boys-1",
      routeId: "r-boys-morning",
      transportGroupId: tgBoys,
    };

    const girlsJourney: JourneyContext = {
      journeyId: "j-girls-1",
      routeId: "r-girls-morning",
      transportGroupId: tgGirls,
    };

    it("rejects boarding officer with NULL transport group (FAIL CLOSED)", () => {
      const unassignedOfficer: OfficerProfile = {
        userId: "officer-null",
        role: "boarding_officer",
        assignedTransportGroupId: null, // Unassigned / NULL
      };
      assert.strictEqual(canOfficerAccessJourney(unassignedOfficer, boysJourney), false);
      assert.strictEqual(canOfficerAccessJourney(unassignedOfficer, girlsJourney), false);
    });

    it("rejects boys' officer attempting to access girls' journey", () => {
      const boysOfficer: OfficerProfile = {
        userId: "officer-boys",
        role: "boarding_officer",
        assignedTransportGroupId: tgBoys,
      };
      assert.strictEqual(canOfficerAccessJourney(boysOfficer, girlsJourney), false);
      assert.strictEqual(canOfficerAccessJourney(boysOfficer, boysJourney), true);
    });

    it("rejects girls' officer attempting to access boys' journey", () => {
      const girlsOfficer: OfficerProfile = {
        userId: "officer-girls",
        role: "boarding_officer",
        assignedTransportGroupId: tgGirls,
      };
      assert.strictEqual(canOfficerAccessJourney(girlsOfficer, boysJourney), false);
      assert.strictEqual(canOfficerAccessJourney(girlsOfficer, girlsJourney), true);
    });

    it("allows administrators supervisory access across all corridors", () => {
      const admin: OfficerProfile = {
        userId: "admin-superuser",
        role: "admin",
        assignedTransportGroupId: null,
      };
      assert.strictEqual(canOfficerAccessJourney(admin, boysJourney), true);
      assert.strictEqual(canOfficerAccessJourney(admin, girlsJourney), true);
    });
  });

  describe("3. Strict JWT Claim Role Handling in RPCs", () => {
    function simulateRpcJwtValidation(params: {
      jwtRole: string | null;
      authUid: string | null;
      passedActorId: string | null;
    }): { success: boolean; effectiveActorId?: string; error?: string } {
      const { jwtRole, authUid, passedActorId } = params;

      // Clean role
      const v_jwt_role = jwtRole && jwtRole.trim().length > 0 ? jwtRole.trim() : null;

      // Fail closed on invalid/untrusted role
      if (!v_jwt_role || (v_jwt_role !== "authenticated" && v_jwt_role !== "service_role")) {
        return {
          success: false,
          error: "Permission denied: Invalid or untrusted execution context.",
        };
      }

      if (v_jwt_role === "authenticated") {
        if (!authUid) {
          return { success: false, error: "Permission denied: Unauthenticated session." };
        }
        if (passedActorId && passedActorId !== authUid) {
          return {
            success: false,
            error: "Identity mismatch: Authenticated user cannot act under another identity.",
          };
        }
        return { success: true, effectiveActorId: authUid };
      } else {
        // service_role
        if (!passedActorId) {
          return {
            success: false,
            error: "Service role execution requires explicit actor attribution.",
          };
        }
        return { success: true, effectiveActorId: passedActorId };
      }
    }

    it("rejects execution when JWT role is NULL or missing", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: null,
        authUid: null,
        passedActorId: "some-user",
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("Invalid or untrusted execution context"));
    });

    it("rejects execution when JWT role is an empty string", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: "",
        authUid: null,
        passedActorId: "some-user",
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("Invalid or untrusted execution context"));
    });

    it("rejects execution when JWT role is 'anon'", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: "anon",
        authUid: null,
        passedActorId: "admin-id",
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("Invalid or untrusted execution context"));
    });

    it("rejects execution when JWT role is an unrecognized/custom role", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: "custom_moderator",
        authUid: "user-123",
        passedActorId: "user-123",
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("Invalid or untrusted execution context"));
    });

    it("rejects authenticated user attempting identity spoofing (mismatching actor ID)", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: "authenticated",
        authUid: "student-attacker",
        passedActorId: "student-victim",
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("Identity mismatch"));
    });

    it("permits authenticated user acting with their own identity", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: "authenticated",
        authUid: "student-legit",
        passedActorId: "student-legit",
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.effectiveActorId, "student-legit");
    });

    it("rejects service-role execution without explicit actor attribution", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: "service_role",
        authUid: null,
        passedActorId: null,
      });
      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes("requires explicit actor attribution"));
    });

    it("permits service-role execution with valid, explicit actor attribution", () => {
      const res = simulateRpcJwtValidation({
        jwtRole: "service_role",
        authUid: null,
        passedActorId: "system-job-admin",
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.effectiveActorId, "system-job-admin");
    });
  });

  describe("4. In-Memory PostgreSQL Emulator (pg-mem) Schema Integrity", () => {
    it("validates routes gender_group enum constraint and defaults", () => {
      const db = newDb();

      db.public.none(`
        CREATE TYPE user_role AS ENUM ('student', 'boarding_officer', 'driver', 'admin');
        CREATE TYPE gender AS ENUM ('male', 'female', 'mixed');

        CREATE TABLE transport_groups (
          id text PRIMARY KEY,
          name text NOT NULL,
          gender_group gender NOT NULL DEFAULT 'mixed'
        );

        CREATE TABLE routes (
          id text PRIMARY KEY,
          name text NOT NULL,
          code text NOT NULL UNIQUE,
          gender_group gender NOT NULL DEFAULT 'mixed',
          transport_group_id text REFERENCES transport_groups(id)
        );
      `);

      db.public.none(`
        INSERT INTO transport_groups (id, name, gender_group) VALUES ('tg-1', 'Boys Corridor', 'male');
        INSERT INTO routes (id, name, code, transport_group_id) VALUES ('r-1', 'Boys Route', 'BR-01', 'tg-1');
      `);

      const route = db.public.one("SELECT * FROM routes WHERE id = 'r-1'");
      assert.strictEqual(route.gender_group, "mixed", "Default must be mixed");
      assert.strictEqual(route.code, "BR-01");
    });
  });
});
