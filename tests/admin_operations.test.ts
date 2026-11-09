import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Phase 6: Transport Administration & Operational Control Centre", () => {
  // 1. FLEET VEHICLE REGISTRATION & CAPACITY BOUNDARIES
  describe("Fleet Management & Safe Capacity Enforcement", () => {
    function validateVehiclePayload(payload: {
      registrationNumber: string;
      safeCapacity: number;
      status: string;
    }) {
      if (!payload.registrationNumber || payload.registrationNumber.trim().length < 3) {
        return { valid: false, error: "Valid vehicle registration number is required." };
      }
      if (payload.safeCapacity < 1 || payload.safeCapacity > 100) {
        return { valid: false, error: "Approved safe capacity must be between 1 and 100 seats." };
      }
      const validStatuses = ["available", "assigned", "maintenance", "retired", "unavailable"];
      if (!validStatuses.includes(payload.status)) {
        return { valid: false, error: "Invalid operational status." };
      }
      return {
        valid: true,
        isActive: payload.status !== "retired" && payload.status !== "unavailable",
      };
    }

    it("accepts valid electric bus registration with certified 30-seat capacity", () => {
      const res = validateVehiclePayload({
        registrationNumber: "CU-BUS-01",
        safeCapacity: 30,
        status: "available",
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.isActive, true);
    });

    it("rejects dangerous or negative safe seating capacities", () => {
      const zeroCap = validateVehiclePayload({
        registrationNumber: "CU-BUS-02",
        safeCapacity: 0,
        status: "available",
      });
      assert.strictEqual(zeroCap.valid, false);

      const excessCap = validateVehiclePayload({
        registrationNumber: "CU-BUS-03",
        safeCapacity: 150,
        status: "available",
      });
      assert.strictEqual(excessCap.valid, false);
    });

    it("automatically deactivates retired or unavailable fleet vehicles", () => {
      const retiredBus = validateVehiclePayload({
        registrationNumber: "CU-BUS-OLD",
        safeCapacity: 25,
        status: "retired",
      });
      assert.strictEqual(retiredBus.valid, true);
      assert.strictEqual(retiredBus.isActive, false);
    });
  });

  // 2. DRIVER MANAGEMENT & INCLUSIVE DUAL MODES (MODE A & MODE B)
  describe("Driver Management & App Access Inclusivity", () => {
    function createDriverRecord(payload: {
      fullName: string;
      driverReference: string;
      hasAppAccess: boolean;
      phone?: string;
      licenseExpiry?: string;
    }) {
      if (!payload.fullName || payload.fullName.trim().length < 3) {
        throw new Error("Full driver name is required.");
      }
      if (!payload.driverReference || payload.driverReference.trim().length < 3) {
        throw new Error("Institutional driver reference is required.");
      }
      return {
        ...payload,
        profileId: payload.hasAppAccess ? "profile-uuid" : null,
        operationalMode: payload.hasAppAccess ? "MODE_A_DIRECT" : "MODE_B_ASSISTED",
      };
    }

    it("allows non-smartphone drivers (Mode B) without email or profile accounts", () => {
      const driver = createDriverRecord({
        fullName: "Malam Haruna Bello",
        driverReference: "DRV-CU-05",
        hasAppAccess: false,
        phone: "08031234567",
      });

      assert.strictEqual(driver.operationalMode, "MODE_B_ASSISTED");
      assert.strictEqual(driver.profileId, null);
      assert.strictEqual(driver.hasAppAccess, false);
    });

    it("supports smartphone drivers (Mode A) with direct login profiles", () => {
      const driver = createDriverRecord({
        fullName: "Samuel Okon",
        driverReference: "DRV-CU-06",
        hasAppAccess: true,
        phone: "08039876543",
      });

      assert.strictEqual(driver.operationalMode, "MODE_A_DIRECT");
      assert.ok(driver.profileId);
      assert.strictEqual(driver.hasAppAccess, true);
    });
  });

  // 3. SCHEDULE TEMPLATES & BULK JOURNEY GENERATOR
  describe("Schedule Templates & Bulk Journey Dispatch", () => {
    it("enforces safe capacity ceiling as the lower of vehicle safe capacity and template allocation", () => {
      function calculateEffectiveAllocation(
        templateAllocation: number,
        vehicleSafeCapacity: number
      ): number {
        return Math.min(templateAllocation, vehicleSafeCapacity);
      }

      // 30-seat proposed allocation with a 30-seat bus
      assert.strictEqual(calculateEffectiveAllocation(30, 30), 30);

      // 35-seat proposed allocation capped by a 30-seat vehicle safe capacity
      assert.strictEqual(calculateEffectiveAllocation(35, 30), 30);

      // 25-seat proposed allocation on a 30-seat bus remains 25
      assert.strictEqual(calculateEffectiveAllocation(25, 30), 25);
    });

    it("prevents duplicate journeys from being generated on the same schedule and date", () => {
      const existingJourneys = [
        { scheduleId: "sched-001", journeyDate: "2026-11-10" },
        { scheduleId: "sched-002", journeyDate: "2026-11-10" },
      ];

      function shouldGenerateJourney(
        scheduleId: string,
        targetDate: string,
        existing: { scheduleId: string; journeyDate: string }[]
      ): boolean {
        return !existing.some(
          (j) => j.scheduleId === scheduleId && j.journeyDate === targetDate
        );
      }

      assert.strictEqual(shouldGenerateJourney("sched-001", "2026-11-10", existingJourneys), false);
      assert.strictEqual(shouldGenerateJourney("sched-003", "2026-11-10", existingJourneys), true);
      assert.strictEqual(shouldGenerateJourney("sched-001", "2026-11-11", existingJourneys), true);
    });
  });

  // 4. MANDATORY CANCELLATION JUSTIFICATION
  describe("Journey Cancellation Governance", () => {
    function validateCancellation(reason: string) {
      if (!reason || reason.trim().length < 5) {
        return {
          allowed: false,
          error: "Please enter a valid cancellation justification (min 5 characters).",
        };
      }
      return { allowed: true };
    }

    it("strictly requires at least 5 characters justification for cancellation", () => {
      assert.strictEqual(validateCancellation("").allowed, false);
      assert.strictEqual(validateCancellation("bad").allowed, false);
      assert.strictEqual(
        validateCancellation("Mechanical alternator fault on bus CU-BUS-01").allowed,
        true
      );
    });

    it("cancels all passenger bookings and prepares notification payloads", () => {
      const bookings = [
        { id: "b1", studentId: "s1", status: "confirmed" },
        { id: "b2", studentId: "s2", status: "boarded" },
        { id: "b3", studentId: "s3", status: "confirmed" },
      ];

      function cancelJourneyBookings(
        bList: typeof bookings,
        reason: string,
        journeyCode: string
      ) {
        const notifications: { studentId: string; title: string; message: string }[] = [];
        const updatedBookings = bList.map((b) => {
          notifications.push({
            studentId: b.studentId,
            title: `Journey Cancelled: ${journeyCode}`,
            message: `Your bus journey has been cancelled: ${reason}`,
          });
          return { ...b, status: "cancelled" };
        });
        return { updatedBookings, notifications };
      }

      const res = cancelJourneyBookings(bookings, "Severe road obstruction", "GF-MAIN-01");
      assert.strictEqual(res.updatedBookings.length, 3);
      assert.ok(res.updatedBookings.every((b) => b.status === "cancelled"));
      assert.strictEqual(res.notifications.length, 3);
      assert.strictEqual(res.notifications[0].title, "Journey Cancelled: GF-MAIN-01");
    });
  });

  // 5. INCIDENT RESOLUTION GOVERNANCE
  describe("Incident Resolution Workflow", () => {
    function updateIncident(
      currentStatus: string,
      targetStatus: "reported" | "investigating" | "resolved" | "dismissed",
      resolutionNotes: string
    ) {
      if (!resolutionNotes || resolutionNotes.trim().length < 5) {
        return { success: false, error: "Resolution notes are required (min 5 characters)." };
      }
      return {
        success: true,
        newStatus: targetStatus,
        resolutionNotes: resolutionNotes.trim(),
        resolvedAt: targetStatus === "resolved" ? new Date().toISOString() : null,
      };
    }

    it("requires operational resolution notes before marking an incident resolved", () => {
      const invalid = updateIncident("investigating", "resolved", "ok");
      assert.strictEqual(invalid.success, false);

      const valid = updateIncident(
        "investigating",
        "resolved",
        "Spare battery installed by university workshop team."
      );
      assert.strictEqual(valid.success, true);
      assert.strictEqual(valid.newStatus, "resolved");
      assert.ok(valid.resolvedAt);
    });
  });

  // 6. REPORTS & METRICS INTEGRITY
  describe("Reporting & KPI Calculation Integrity", () => {
    it("correctly computes seat utilization percentage", () => {
      function calcUtilization(booked: number, capacity: number): number {
        if (capacity <= 0) return 0;
        return Math.round((booked / capacity) * 100);
      }

      assert.strictEqual(calcUtilization(30, 30), 100);
      assert.strictEqual(calcUtilization(15, 30), 50);
      assert.strictEqual(calcUtilization(0, 30), 0);
      assert.strictEqual(calcUtilization(10, 0), 0);
    });

    it("correctly computes boarding compliance rate", () => {
      function calcCompliance(boarded: number, confirmed: number): number {
        if (confirmed <= 0) return 0;
        return Math.round((boarded / confirmed) * 100);
      }

      assert.strictEqual(calcCompliance(28, 30), 93);
      assert.strictEqual(calcCompliance(30, 30), 100);
      assert.strictEqual(calcCompliance(0, 10), 0);
    });

    it("properly formats and escapes CSV output cells", () => {
      function escapeCsvCell(val: string | number | null): string {
        if (val === null || val === undefined) return '""';
        const str = String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return `"${str}"`;
      }

      assert.strictEqual(escapeCsvCell("CU-BUS-01"), '"CU-BUS-01"');
      assert.strictEqual(escapeCsvCell('Bus "Alpha", Girls Fleet'), '"Bus ""Alpha"", Girls Fleet"');
      assert.strictEqual(escapeCsvCell(30), '"30"');
    });
  });
});

