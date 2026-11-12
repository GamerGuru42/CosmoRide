import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

interface ParsedCreatePolicy {
  file: string;
  policyName: string;
  tableName: string;
  command: string;
  asType: "PERMISSIVE" | "RESTRICTIVE";
  roles: string;
  usingExpr: string;
  withCheckExpr: string | null;
  rawStatement: string;
}

interface ParsedDropPolicy {
  file: string;
  policyName: string;
  tableName: string;
  rawStatement: string;
}

/**
 * Splits PostgreSQL SQL text into individual top-level statements while stripping
 * comments (`--` and `/* ... *\/`) and preserving string literals and dollar-quoted blocks.
 */
function extractSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Single-line comment
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        i += 1;
      }
      current += " ";
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      current += " ";
      continue;
    }

    // Single-quoted string literal (handles '' escapes)
    if (ch === "'") {
      current += ch;
      i += 1;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Dollar-quoted body ($tag$...$tag$)
    if (ch === "$") {
      const tagMatch = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const endIdx = sql.indexOf(tag, i + tag.length);
        if (endIdx !== -1) {
          current += sql.slice(i, endIdx + tag.length);
          i = endIdx + tag.length;
          continue;
        }
      }
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

function normalizeWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractBalancedParenContent(
  text: string,
  openParenIndex: number
): { inner: string; endIndex: number } {
  assert.strictEqual(text[openParenIndex], "(", "Expected opening parenthesis");
  let depth = 0;
  let i = openParenIndex;

  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          inner: text.slice(openParenIndex + 1, i),
          endIndex: i,
        };
      }
    }
    i += 1;
  }

  throw new Error("Unbalanced parentheses in SQL expression");
}

function parseCreatePolicy(file: string, stmt: string): ParsedCreatePolicy | null {
  const headerMatch = stmt.match(
    /^CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([a-zA-Z0-9_.]+)(?:\s+AS\s+(PERMISSIVE|RESTRICTIVE))?(?:\s+FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE))?(?:\s+TO\s+([a-zA-Z0-9_,\s]+?))?\s+USING\s*\(/i
  );
  if (!headerMatch) {
    return null;
  }

  const [, policyName, rawTable, rawAsType, rawCommand, rawRoles] = headerMatch;
  const tableName = rawTable.includes(".")
    ? rawTable.toLowerCase()
    : `public.${rawTable.toLowerCase()}`;
  const openIdx = headerMatch[0].length - 1;
  const usingParsed = extractBalancedParenContent(stmt, openIdx);

  let withCheckExpr: string | null = null;
  const remainder = stmt.slice(usingParsed.endIndex + 1).trim();
  if (/^WITH\s+CHECK\s*\(/i.test(remainder)) {
    const checkOpenIdx = remainder.indexOf("(");
    withCheckExpr = normalizeWs(extractBalancedParenContent(remainder, checkOpenIdx).inner);
  }

  return {
    file,
    policyName,
    tableName,
    command: (rawCommand || "ALL").toUpperCase(),
    asType: (rawAsType ? rawAsType.toUpperCase() : "PERMISSIVE") as
      | "PERMISSIVE"
      | "RESTRICTIVE",
    roles: normalizeWs(rawRoles || "PUBLIC"),
    usingExpr: normalizeWs(usingParsed.inner),
    withCheckExpr,
    rawStatement: stmt,
  };
}

function parseDropPolicy(file: string, stmt: string): ParsedDropPolicy | null {
  const match = stmt.match(
    /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+([a-zA-Z0-9_.]+)$/i
  );
  if (!match) {
    return null;
  }
  const [, policyName, rawTable] = match;
  const tableName = rawTable.includes(".")
    ? rawTable.toLowerCase()
    : `public.${rawTable.toLowerCase()}`;

  return {
    file,
    policyName,
    tableName,
    rawStatement: stmt,
  };
}

/**
 * Splits a SQL boolean expression at top-level `OR` operators (depth 0 only).
 */
function splitTopLevelOrBranches(expr: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let lastSplit = 0;
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'") {
      i += 1;
      while (i < expr.length) {
        if (expr[i] === "'" && expr[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (expr[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (depth === 0) {
      const slice = expr.slice(i);
      const orMatch = slice.match(/^(\s+OR\s+)/i);
      if (orMatch) {
        branches.push(normalizeWs(expr.slice(lastSplit, i)));
        i += orMatch[0].length;
        lastSplit = i;
        continue;
      }
    }
    i += 1;
  }

  branches.push(normalizeWs(expr.slice(lastSplit)));
  return branches.filter(Boolean);
}

/**
 * Replays DROP/CREATE POLICY statements across migrations 00001..00024 to obtain
 * the final effective RLS policies per table.
 */
function computeEffectivePoliciesUpTo(maxPrefix: string): Map<string, ParsedCreatePolicy> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f <= `${maxPrefix}_zzzzzzzz`)
    .sort();

  const activePolicies = new Map<string, ParsedCreatePolicy>();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = extractSqlStatements(sql);
    for (const stmt of statements) {
      const dropped = parseDropPolicy(file, stmt);
      if (dropped) {
        activePolicies.delete(`${dropped.tableName}::${dropped.policyName}`);
        continue;
      }
      const created = parseCreatePolicy(file, stmt);
      if (created) {
        activePolicies.set(`${created.tableName}::${created.policyName}`, created);
      }
    }
  }

  return activePolicies;
}

describe("CosmoRide Migration 00024 — Fix Inactive-Account RLS Policy Bypass", () => {
  const migrationPath = path.join(
    MIGRATIONS_DIR,
    "00024_fix_staff_policy_active_bypass.sql"
  );
  const sql24 = fs.readFileSync(migrationPath, "utf8");
  const statements24 = extractSqlStatements(sql24);

  it("1. drops and recreates ONLY the two intended staff SELECT policies on boarding_records and waitlists", () => {
    assert.strictEqual(
      statements24.length,
      4,
      `Migration 00024 must contain exactly 4 SQL statements (2 DROP POLICY + 2 CREATE POLICY), found ${statements24.length}`
    );

    const drops = statements24
      .map((stmt) => parseDropPolicy("00024", stmt))
      .filter((x): x is ParsedDropPolicy => x !== null);
    const creates = statements24
      .map((stmt) => parseCreatePolicy("00024", stmt))
      .filter((x): x is ParsedCreatePolicy => x !== null);

    assert.strictEqual(drops.length, 2, "Expected exactly 2 DROP POLICY statements");
    assert.strictEqual(creates.length, 2, "Expected exactly 2 CREATE POLICY statements");

    assert.deepStrictEqual(
      drops.map((d) => `${d.tableName}::${d.policyName}`),
      [
        "public.boarding_records::Scoped staff boarding records access",
        "public.waitlists::Staff can view group waitlists",
      ]
    );
    assert.deepStrictEqual(
      creates.map((c) => `${c.tableName}::${c.policyName}`),
      [
        "public.boarding_records::Scoped staff boarding records access",
        "public.waitlists::Staff can view group waitlists",
      ]
    );

    for (const created of creates) {
      assert.strictEqual(created.command, "SELECT");
      assert.strictEqual(created.roles.toLowerCase(), "authenticated");
      assert.strictEqual(created.asType, "PERMISSIVE");
    }

    assert.strictEqual(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql24), false);
    assert.strictEqual(/ALTER\s+(TABLE|FUNCTION)/i.test(sql24), false);
    assert.strictEqual(/CREATE\s+TRIGGER/i.test(sql24), false);
    assert.strictEqual(/\bprofiles\b/i.test(sql24), true, "Only comment mention allowed; must have 0 statements targeting profiles");
    assert.strictEqual(
      statements24.some((s) => /\bON\s+(public\.)?profiles\b/i.test(s)),
      false,
      "Migration 00024 must not alter any policy on public.profiles"
    );
  });

  it("2. wraps the entire staff expression with public.rls_user_is_active(), removes student_id self-access, and preserves all staff paths", () => {
    const creates = statements24
      .map((stmt) => parseCreatePolicy("00024", stmt))
      .filter((x): x is ParsedCreatePolicy => x !== null);

    const expectedTables = ["boarding_records", "waitlists"];
    creates.forEach((policy, index) => {
      const tableShort = expectedTables[index];
      const expr = policy.usingExpr;

      // No unguarded student_id self-access branch allowed anywhere in the staff policy
      assert.strictEqual(
        /\bstudent_id\b/i.test(expr),
        false,
        `${policy.policyName} must not reference student_id`
      );

      // Must start with `public.rls_user_is_active() AND (` and close with `)` covering the entire remainder
      const prefix = "public.rls_user_is_active() AND (";
      assert.ok(
        expr.startsWith(prefix),
        `${policy.policyName} USING expression must wrap staff branches with "${prefix}..."`
      );
      const outerOpenIdx = prefix.length - 1;
      const wrapped = extractBalancedParenContent(expr, outerOpenIdx);
      assert.strictEqual(
        wrapped.endIndex,
        expr.length - 1,
        `${policy.policyName} must wrap the entire staff disjunction inside public.rls_user_is_active() AND (...)`
      );

      // Verify the 3 preserved top-level OR branches inside the active-guarded wrapper
      const branches = splitTopLevelOrBranches(wrapped.inner);
      assert.strictEqual(
        branches.length,
        3,
        `${policy.policyName} must have exactly 3 top-level staff OR branches (admin, boarding_officer, driver)`
      );

      assert.strictEqual(branches[0], "public.rls_is_admin()");

      // Boarding officer branch: wrapped in parens, checks role + non-null transport group + EXISTS join
      const boInner = extractBalancedParenContent(branches[1], 0).inner;
      assert.strictEqual(
        normalizeWs(boInner),
        `public.rls_user_role() = 'boarding_officer' AND public.rls_assigned_transport_group() IS NOT NULL AND EXISTS ( SELECT 1 FROM public.journeys j JOIN public.routes r ON r.id = j.route_id WHERE j.id = ${tableShort}.journey_id AND r.transport_group_id = public.rls_assigned_transport_group() )`
      );

      // Driver branch: wrapped in parens, checks role + assigned journey helper
      const drvInner = extractBalancedParenContent(branches[2], 0).inner;
      assert.strictEqual(
        normalizeWs(drvInner),
        "public.rls_user_role() = 'driver' AND public.rls_driver_assigned_to_journey(journey_id)"
      );
    });
  });

  it("3. confirms effective policies across 00001..00024 preserve 00023 student guards and profiles own-row SELECT exception", () => {
    const effective = computeEffectivePoliciesUpTo("00024");

    const boardingPolicies = [...effective.values()].filter(
      (p) => p.tableName === "public.boarding_records" && p.command === "SELECT"
    );
    assert.deepStrictEqual(
      boardingPolicies.map((p) => p.policyName).sort(),
      ["Scoped staff boarding records access", "Students can view own boarding records"]
    );

    const studentBoarding = effective.get(
      "public.boarding_records::Students can view own boarding records"
    );
    assert.ok(studentBoarding, "00023 student boarding_records policy must still exist");
    assert.strictEqual(
      studentBoarding.usingExpr,
      "student_id = (SELECT auth.uid()) AND public.rls_user_is_active()"
    );

    const waitlistPolicies = [...effective.values()].filter(
      (p) => p.tableName === "public.waitlists" && p.command === "SELECT"
    );
    assert.deepStrictEqual(
      waitlistPolicies.map((p) => p.policyName).sort(),
      ["Staff can view group waitlists", "Students can view own waitlist status"]
    );

    const studentWaitlist = effective.get(
      "public.waitlists::Students can view own waitlist status"
    );
    assert.ok(studentWaitlist, "00023 student waitlists policy must still exist");
    assert.strictEqual(
      studentWaitlist.usingExpr,
      "student_id = (SELECT auth.uid()) AND public.rls_user_is_active()"
    );

    // Profiles SELECT policy exception must remain unchanged from 00022
    const profileSelect = effective.get("public.profiles::Scoped profile read access");
    assert.ok(profileSelect, "profiles SELECT policy must exist");
    assert.strictEqual(profileSelect.file, "00022_core_system_security_and_workflow_remediation.sql");
    assert.strictEqual(
      profileSelect.usingExpr,
      "id = (SELECT auth.uid()) OR public.rls_is_admin() OR public.rls_staff_can_view_profile(id)"
    );
  });

  it("4. verifies boolean evaluation of surviving PERMISSIVE policy pairs across all user roles and active states", () => {
    interface ActorContext {
      uid: string;
      isActive: boolean;
      role: "student" | "boarding_officer" | "driver" | "admin";
      adminRole?: "super_admin" | "bus_manager" | "hostel_manager" | null;
      assignedTransportGroupId?: string | null;
      assignedJourneyIds?: string[];
    }

    interface TargetRow {
      studentId: string;
      journeyId: string;
      journeyTransportGroupId: string;
    }

    // Mirrors PostgreSQL PERMISSIVE OR evaluation of post-00024 policies
    const canSelectPost00024 = (actor: ActorContext, row: TargetRow): boolean => {
      const rlsUserIsActive = actor.isActive === true;
      const rlsIsAdmin =
        rlsUserIsActive &&
        actor.role === "admin" &&
        (actor.adminRole === "super_admin" ||
          actor.adminRole === "bus_manager" ||
          actor.adminRole === "hostel_manager");
      const rlsUserRole = rlsUserIsActive ? actor.role : null;
      const rlsAssignedGroup = rlsUserIsActive
        ? (actor.assignedTransportGroupId ?? null)
        : null;
      const rlsDriverAssigned =
        rlsUserIsActive &&
        actor.role === "driver" &&
        (actor.assignedJourneyIds ?? []).includes(row.journeyId);

      // Policy A (00024): Scoped staff policy
      const staffPolicy =
        rlsUserIsActive &&
        (rlsIsAdmin ||
          (rlsUserRole === "boarding_officer" &&
            rlsAssignedGroup !== null &&
            row.journeyTransportGroupId === rlsAssignedGroup) ||
          (rlsUserRole === "driver" && rlsDriverAssigned));

      // Policy B (00023): Student own-row policy
      const studentPolicy = actor.uid === row.studentId && rlsUserIsActive;

      return staffPolicy || studentPolicy;
    };

    const row: TargetRow = {
      studentId: "student-1",
      journeyId: "journey-1",
      journeyTransportGroupId: "group-male",
    };

    // Inactive student MUST be denied own row
    assert.strictEqual(
      canSelectPost00024(
        { uid: "student-1", isActive: false, role: "student" },
        row
      ),
      false
    );

    // Active student retains own-row access and is denied others' rows
    assert.strictEqual(
      canSelectPost00024(
        { uid: "student-1", isActive: true, role: "student" },
        row
      ),
      true
    );
    assert.strictEqual(
      canSelectPost00024(
        { uid: "student-2", isActive: true, role: "student" },
        row
      ),
      false
    );

    // Active admins retain scoped admin access; inactive admins denied
    for (const adminRole of ["super_admin", "bus_manager", "hostel_manager"] as const) {
      assert.strictEqual(
        canSelectPost00024(
          { uid: `admin-${adminRole}`, isActive: true, role: "admin", adminRole },
          row
        ),
        true
      );
      assert.strictEqual(
        canSelectPost00024(
          { uid: `admin-${adminRole}`, isActive: false, role: "admin", adminRole },
          row
        ),
        false
      );
    }

    // Active boarding officer sees assigned transport group only; inactive denied
    assert.strictEqual(
      canSelectPost00024(
        {
          uid: "bo-1",
          isActive: true,
          role: "boarding_officer",
          assignedTransportGroupId: "group-male",
        },
        row
      ),
      true
    );
    assert.strictEqual(
      canSelectPost00024(
        {
          uid: "bo-2",
          isActive: true,
          role: "boarding_officer",
          assignedTransportGroupId: "group-female",
        },
        row
      ),
      false
    );
    assert.strictEqual(
      canSelectPost00024(
        {
          uid: "bo-1",
          isActive: false,
          role: "boarding_officer",
          assignedTransportGroupId: "group-male",
        },
        row
      ),
      false
    );

    // Active driver sees assigned journey only; inactive denied
    assert.strictEqual(
      canSelectPost00024(
        {
          uid: "drv-1",
          isActive: true,
          role: "driver",
          assignedJourneyIds: ["journey-1"],
        },
        row
      ),
      true
    );
    assert.strictEqual(
      canSelectPost00024(
        {
          uid: "drv-2",
          isActive: true,
          role: "driver",
          assignedJourneyIds: ["journey-other"],
        },
        row
      ),
      false
    );
    assert.strictEqual(
      canSelectPost00024(
        {
          uid: "drv-1",
          isActive: false,
          role: "driver",
          assignedJourneyIds: ["journey-1"],
        },
        row
      ),
      false
    );
  });

  it("5. contains zero forbidden terminology in migration 00024", () => {
    const forbiddenWord = new RegExp("corri" + "dor", "i");
    assert.strictEqual(
      forbiddenWord.test(sql24),
      false,
      "Migration 00024 must not contain forbidden terminology"
    );
  });
});
