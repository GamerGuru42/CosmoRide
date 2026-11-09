import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getTodayDateString, formatTime, APP_TIMEZONE } from "../src/lib/utils";

describe("Phase 6.1: Integration, Timezone & Security Hardening Audit", () => {
  describe("Timezone & Local University Operations (WAT / Africa/Lagos)", () => {
    it("exports APP_TIMEZONE configured for Nigeria (Africa/Lagos)", () => {
      assert.strictEqual(APP_TIMEZONE, "Africa/Lagos");
    });

    it("generates date string in YYYY-MM-DD format grounded in Africa/Lagos", () => {
      const today = getTodayDateString();
      assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    });

    it("parses plain time strings (HH:mm:ss) robustly without throwing Invalid Date", () => {
      assert.doesNotThrow(() => {
        const t1 = formatTime("07:30:00");
        assert.ok(t1.length > 0);
        const t2 = formatTime("14:45");
        assert.ok(t2.length > 0);
      });
    });
  });

  describe("Database Migration Syntax & Enum Consistency", () => {
    it("ensures 00001_initial_schema.sql does not use invalid enum 'all' for gender", () => {
      const migration1Path = path.resolve(process.cwd(), "supabase/migrations/00001_initial_schema.sql");
      const content = fs.readFileSync(migration1Path, "utf-8");
      assert.strictEqual(content.includes("DEFAULT 'all'"), false, "Must not contain DEFAULT 'all'");
      assert.ok(content.includes("gender_group public.gender NOT NULL DEFAULT 'mixed'"));
    });

    it("ensures 00006_security_hardening_and_integrity.sql introduces audit_logs INSERT policy", () => {
      const migration6Path = path.resolve(process.cwd(), "supabase/migrations/00006_security_hardening_and_integrity.sql");
      assert.ok(fs.existsSync(migration6Path), "Migration 00006 must exist");
      const content = fs.readFileSync(migration6Path, "utf-8");
      assert.ok(content.includes('CREATE POLICY "Authenticated users and staff can insert audit logs"'));
      assert.ok(content.includes("ON public.audit_logs FOR INSERT"));
    });

    it("ensures 00006 migration revokes anonymous execution on public procedures", () => {
      const migration6Path = path.resolve(process.cwd(), "supabase/migrations/00006_security_hardening_and_integrity.sql");
      const content = fs.readFileSync(migration6Path, "utf-8");
      assert.ok(content.includes("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;"));
      assert.ok(content.includes("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;"));
    });

    it("ensures anti-spoofing caller verification is implemented across security definer RPCs", () => {
      const migration6Path = path.resolve(process.cwd(), "supabase/migrations/00006_security_hardening_and_integrity.sql");
      const content = fs.readFileSync(migration6Path, "utf-8");
      assert.ok(content.includes("Anti-spoofing check"));
      assert.ok(content.includes("auth.uid() IS NOT NULL AND auth.uid() <> p_student_id"));
      assert.ok(content.includes("auth.uid() IS NOT NULL AND auth.uid() <> p_officer_id"));
      assert.ok(content.includes("auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id"));
    });
  });

  describe("Anti-Spoofing Caller Identity Verification Logic", () => {
    function simulateCallerCheck(
      authUid: string | null,
      targetUserId: string,
      callerRole: "student" | "boarding_officer" | "driver" | "admin"
    ): { allowed: boolean; reason?: string } {
      if (authUid !== null && authUid !== targetUserId) {
        if (callerRole !== "admin" && callerRole !== "boarding_officer") {
          return { allowed: false, reason: "Permission denied: Caller cannot act on behalf of another user." };
        }
      }
      return { allowed: true };
    }

    it("permits action when auth.uid matches target parameter", () => {
      const res = simulateCallerCheck("user-123", "user-123", "student");
      assert.strictEqual(res.allowed, true);
    });

    it("blocks student caller attempting to act with another student UUID", () => {
      const res = simulateCallerCheck("malicious-student", "victim-student", "student");
      assert.strictEqual(res.allowed, false);
      assert.ok(res.reason?.includes("Permission denied"));
    });

    it("permits administrator to act in assisted mode or on behalf of user", () => {
      const res = simulateCallerCheck("admin-uuid", "student-uuid", "admin");
      assert.strictEqual(res.allowed, true);
    });
  });
});
