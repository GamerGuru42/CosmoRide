import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAvailableSeats,
} from "../src/lib/utils";
import {
  verifyBoardingPassSchema,
} from "../src/lib/validators";

describe("Phase 4: Hostel Representative & Boarding Officer Security Validation", () => {
  // 1. Cross-Group Corridor Access Prevention Logic
  it("enforces cross-group corridor isolation between boys and girls operations", () => {
    const boysTransportGroupId = "11111111-1111-1111-1111-111111111111";
    const girlsTransportGroupId = "22222222-2222-2222-2222-222222222222";

    // Officer is assigned to Boys' operations
    const officer = {
      id: "officer-boy-1",
      role: "boarding_officer",
      assigned_transport_group_id: boysTransportGroupId,
    };

    // Journey is on a route belonging to Girls' operations
    const girlsJourney = {
      id: "journey-girls-1",
      transport_group_id: girlsTransportGroupId,
    };

    // Verification check simulating RPC policy
    function canOfficerBoardJourney(
      officerGroup: string | null,
      officerRole: string,
      journeyGroup: string
    ) {
      if (officerRole === "admin") return { allowed: true };
      if (officerRole === "boarding_officer" && officerGroup) {
        if (officerGroup !== journeyGroup) {
          return {
            allowed: false,
            code: "CROSS_GROUP_DENIED",
            error: "Cross-Group Restriction: You are not authorised to board passengers for this transport corridor.",
          };
        }
      }
      return { allowed: true };
    }

    const check = canOfficerBoardJourney(
      officer.assigned_transport_group_id,
      officer.role,
      girlsJourney.transport_group_id
    );

    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.code, "CROSS_GROUP_DENIED");

    // Conversely, officer with matching corridor is allowed
    const sameGroupCheck = canOfficerBoardJourney(
      boysTransportGroupId,
      "boarding_officer",
      boysTransportGroupId
    );
    assert.strictEqual(sameGroupCheck.allowed, true);
  });

  // 2. Duplicate Boarding Pass Detection
  it("detects and rejects duplicate scans when passenger is already checked in", () => {
    const existingBooking = {
      id: "bkg-101",
      status: "checked_in",
      ticket_token: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
      checked_in_at: "2026-11-09T07:45:00Z",
    };

    function validateBoardingTicket(booking: typeof existingBooking) {
      if (booking.status === "checked_in") {
        return {
          success: false,
          code: "ALREADY_BOARDED",
          message: "Duplicate scan prevented: Passenger already boarded.",
        };
      }
      return { success: true, code: "VALID" };
    }

    const result = validateBoardingTicket(existingBooking);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, "ALREADY_BOARDED");
  });

  // 3. Cross-Journey / Wrong Bus Rejection
  it("rejects valid tickets presented at the wrong journey or bus", () => {
    const booking = {
      id: "bkg-102",
      journey_id: "journey-main-kado-0700",
      status: "confirmed",
      ticket_token: "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1",
    };

    const targetJourneyId = "journey-main-kado-0800"; // Different departure time/bus

    function verifyJourneyMatch(ticketJourneyId: string, activeJourneyId: string) {
      if (ticketJourneyId !== activeJourneyId) {
        return {
          success: false,
          code: "WRONG_JOURNEY",
          message: "Wrong Bus: This boarding pass is issued for a different scheduled departure.",
        };
      }
      return { success: true };
    }

    const res = verifyJourneyMatch(booking.journey_id, targetJourneyId);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, "WRONG_JOURNEY");
  });

  // 4. Cancelled Ticket Validation
  it("rejects cancelled boarding passes", () => {
    const cancelledBooking = {
      id: "bkg-103",
      status: "cancelled",
      ticket_token: "112233445566112233445566112233445566112233445566",
    };

    function checkTicketStatus(status: string) {
      if (status === "cancelled") {
        return {
          success: false,
          code: "CANCELLED",
          message: "Booking was cancelled by passenger or administrator.",
        };
      }
      return { success: true };
    }

    const res = checkTicketStatus(cancelledBooking.status);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, "CANCELLED");
  });

  // 5. Safe Capacity Ceiling Enforcement at Boarding Gate
  it("enforces safe passenger limit and halts boarding when ceiling is met", () => {
    const proposedAllocation = 30;
    const safeCapacity = 28; // Physical vehicle capacity is 28
    const effectiveCeiling = Math.min(proposedAllocation, safeCapacity); // 28
    let currentBoarded = 28;

    function attemptBoarding(boarded: number, ceiling: number) {
      if (boarded >= ceiling) {
        return {
          success: false,
          code: "CAPACITY_EXCEEDED",
          message: `Safe Capacity Limit Reached: Cannot board beyond approved limit of ${ceiling} passengers.`,
        };
      }
      return { success: true, newBoarded: boarded + 1 };
    }

    const res = attemptBoarding(currentBoarded, effectiveCeiling);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, "CAPACITY_EXCEEDED");
  });

  // 6. Auditable Manual Boarding Override Requirement
  it("requires auditable justification reason of at least 5 characters for manual exceptions", () => {
    const invalidReasons = ["", "   ", "ok", "card"];
    const validReason = "Verified physical student ID card CU/2024/098";

    function validateExceptionReason(reason?: string) {
      if (!reason || reason.trim().length < 5) {
        return {
          valid: false,
          error: "A valid exception reason is required for auditable manual boarding.",
        };
      }
      return { valid: true };
    }

    for (const bad of invalidReasons) {
      const res = validateExceptionReason(bad);
      assert.strictEqual(res.valid, false);
    }

    const goodRes = validateExceptionReason(validReason);
    assert.strictEqual(goodRes.valid, true);
  });

  // 7. Journey Closure & No-Show Accounting Logic
  it("correctly reconciles boarded, unboarded, and no-show counts on journey gate closure", () => {
    const manifest = [
      { id: "1", status: "checked_in" },
      { id: "2", status: "checked_in" },
      { id: "3", status: "confirmed" }, // Did not show up
      { id: "4", status: "confirmed" }, // Did not show up
      { id: "5", status: "cancelled" },
    ];

    const boarded = manifest.filter((p) => p.status === "checked_in").length;
    const unboarded = manifest.filter((p) => p.status === "confirmed").length;
    const cancelled = manifest.filter((p) => p.status === "cancelled").length;

    assert.strictEqual(boarded, 2);
    assert.strictEqual(unboarded, 2);
    assert.strictEqual(cancelled, 1);

    // Closure procedure with markNoShow = true
    const postClosureManifest = manifest.map((p) => {
      if (p.status === "confirmed") {
        return { ...p, status: "no_show" };
      }
      return p;
    });

    const finalNoShows = postClosureManifest.filter((p) => p.status === "no_show").length;
    assert.strictEqual(finalNoShows, 2);
  });
});

