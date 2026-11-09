import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAvailableSeats,
} from "../src/lib/utils";
import {
  registerSchema,
  verifyBoardingPassSchema,
  createJourneySchema,
} from "../src/lib/validators";

describe("CosmoRide Security & Capacity Integrity Validation", () => {
  // 1. Role Escalation Prevention
  it("prevents self-assignment of role in public registration schema", () => {
    const maliciousPayload = {
      fullName: "Attacker User",
      email: "attacker@cosmo.edu.ng",
      password: "Password123!",
      confirmPassword: "Password123!",
      role: "admin", // Attempt to inject admin role
    };

    const parsed = registerSchema.safeParse(maliciousPayload);
    assert.strictEqual(parsed.success, true);
    // Role key is stripped/ignored by schema, ensuring new registrations can never claim admin
    assert.strictEqual((parsed.data as Record<string, unknown>).role, undefined);
  });

  // 2. Capacity Integrity & Safe Passenger Limit Enforcement
  it("strictly enforces that proposed allocation never overrides vehicle safe capacity", () => {
    // Scenario: Bus safe capacity approved for 25, but route proposed allocation set to 30
    const proposedAllocation = 30;
    const safeCapacity = 25;
    const bookedCount = 10;

    const availableSeats = calculateAvailableSeats(
      proposedAllocation,
      safeCapacity,
      bookedCount
    );

    // Bookable capacity must be based on 25 (safe capacity), not 30
    assert.strictEqual(availableSeats, 15);
  });

  it("reports zero available seats when booked count reaches approved safe capacity", () => {
    const proposedAllocation = 30;
    const safeCapacity = 28;
    const bookedCount = 28;

    const availableSeats = calculateAvailableSeats(
      proposedAllocation,
      safeCapacity,
      bookedCount
    );

    assert.strictEqual(availableSeats, 0);
  });

  it("does not allow negative available seats under any circumstances", () => {
    const proposedAllocation = 30;
    const safeCapacity = 30;
    const bookedCount = 35; // Abnormal overbooking state

    const availableSeats = calculateAvailableSeats(
      proposedAllocation,
      safeCapacity,
      bookedCount
    );

    assert.strictEqual(availableSeats, 0);
  });

  // 3. Journey Creation Safe Capacity Validation
  it("validates journey creation parameters and requires positive allocation", () => {
    const invalidJourney = {
      routeId: "550e8400-e29b-41d4-a716-446655440000",
      vehicleId: "550e8400-e29b-41d4-a716-446655440001",
      driverId: "550e8400-e29b-41d4-a716-446655440002",
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T08:00:00Z",
      proposedAllocation: 0, // Invalid: must be >= 1
    };

    const parsed = createJourneySchema.safeParse(invalidJourney);
    assert.strictEqual(parsed.success, false);
  });

  // 4. QR Boarding Security & Opaque Token Validation
  it("requires valid ticket token format and rejects malformed/short tokens", () => {
    const invalidTokenPayload = {
      ticketToken: "short", // Invalid token length
      journeyId: "550e8400-e29b-41d4-a716-446655440000",
      boardingMethod: "qr_scan",
    };

    const parsed = verifyBoardingPassSchema.safeParse(invalidTokenPayload);
    assert.strictEqual(parsed.success, false);
  });

  it("accepts secure 48-character hex ticket tokens without exposing student data in payload", () => {
    // 24 bytes hex = 48 characters
    const validToken = "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0";
    const payload = {
      ticketToken: validToken,
      journeyId: "550e8400-e29b-41d4-a716-446655440000",
      boardingMethod: "qr_scan",
    };

    const parsed = verifyBoardingPassSchema.safeParse(payload);
    assert.strictEqual(parsed.success, true);
    // Ensure no sensitive student fields are required in QR code payload
    assert.strictEqual((parsed.data as Record<string, unknown>).studentName, undefined);
    assert.strictEqual((parsed.data as Record<string, unknown>).studentId, undefined);
  });

  // 5. Auditable Manual Boarding Exception Validation
  it("allows auditable manual boarding exceptions with reason", () => {
    const manualException = {
      ticketToken: "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0",
      journeyId: "550e8400-e29b-41d4-a716-446655440000",
      boardingMethod: "manual_override",
      exceptionReason: "Student device battery depleted; verified university ID card CSU/2024/042.",
    };

    const parsed = verifyBoardingPassSchema.safeParse(manualException);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.data.boardingMethod, "manual_override");
    assert.strictEqual(
      parsed.data.exceptionReason,
      "Student device battery depleted; verified university ID card CSU/2024/042."
    );
  });
});
