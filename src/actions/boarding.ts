"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type BoardingStatusCode =
  | "VALID"
  | "BOARDING_APPROVED"
  | "ALREADY_BOARDED"
  | "INVALID_TICKET"
  | "WRONG_JOURNEY"
  | "CANCELLED"
  | "TICKET_CANCELLED"
  | "CROSS_GROUP_DENIED"
  | "BUS_FULL"
  | "CAPACITY_EXCEEDED"
  | "JOURNEY_NOT_BOARDING"
  | "BOARDING_CLOSED"
  | "JOURNEY_CLOSED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SERVER_ERROR";

export interface BoardingVerificationResult {
  success: boolean;
  code: BoardingStatusCode;
  message: string;
  passengerName?: string;
  studentId?: string;
  passengerCategory?: "seated" | "standing";
  boardedCount?: number;
  boardedSeatedCount?: number;
  boardedStandingCount?: number;
  seatedLimit?: number;
  standingLimit?: number;
  capacity?: number;
  totalCapacity?: number;
  busRegistration?: string;
  originalScanAt?: string;
}

export interface BoardingActionResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Validates a passenger ticket token and records boarding atomically.
 * Strictly verifies transport group access, duplicate scan prevention,
 * journey match, and safe capacity ceilings.
 */
export async function verifyAndBoardPassAction(
  ticketToken: string,
  journeyId: string,
  boardingMethod: "qr_scan" | "manual_override" = "qr_scan",
  exceptionReason?: string
): Promise<BoardingVerificationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        code: "UNAUTHORIZED",
        message: "Authentication required to verify boarding passes.",
      };
    }

    const { data, error } = await supabase.rpc("verify_and_board_passenger", {
      p_ticket_token: ticketToken.trim(),
      p_officer_id: user.id,
      p_journey_id: journeyId,
      p_boarding_method: boardingMethod,
      p_exception_reason: exceptionReason?.trim() || null,
    });

    if (error) {
      return {
        success: false,
        code: "SERVER_ERROR",
        message: error.message,
      };
    }

    const result = data as Record<string, unknown>;

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/passengers");

    return {
      success: Boolean(result?.success),
      code: (result?.code as BoardingStatusCode) || (result?.success ? "BOARDING_APPROVED" : "SERVER_ERROR"),
      message: (result?.message as string) || (result?.error as string) || "Verification complete",
      passengerName: result?.passenger_name as string | undefined,
      studentId: result?.student_id as string | undefined,
      passengerCategory: result?.passenger_category as "seated" | "standing" | undefined,
      boardedCount: result?.boarded_count as number | undefined,
      boardedSeatedCount: result?.boarded_seated_count as number | undefined,
      boardedStandingCount: result?.boarded_standing_count as number | undefined,
      seatedLimit: (result?.seated_limit as number) ?? 20,
      standingLimit: (result?.standing_limit as number) ?? 10,
      capacity: (result?.total_capacity as number) ?? (result?.capacity as number) ?? 30,
      totalCapacity: (result?.total_capacity as number) ?? 30,
      busRegistration: result?.bus_registration as string | undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to verify boarding pass.";
    return {
      success: false,
      code: "SERVER_ERROR",
      message,
    };
  }
}

/**
 * Stage 2: Confirm Bus Arrival at designated pickup point.
 * Doors remain closed; arrival does NOT automatically open boarding.
 */
export async function confirmBusArrivalAction(
  journeyId: string,
  notes?: string
): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("confirm_bus_arrival", {
      p_journey_id: journeyId,
      p_user_id: user.id,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to confirm bus arrival.",
        code: result?.code as string,
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/admin/operations");
    revalidatePath("/driver");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Bus arrival confirmed at pickup point.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to confirm bus arrival.";
    return { success: false, error: message };
  }
}

/**
 * Stage 3: Open Boarding Session.
 * Confirmed by representative after bus & queue readiness check.
 * Starts visible countdown timer (default 10 mins or configured).
 */
export async function openBoardingSessionAction(
  journeyId: string,
  windowMinutes?: number
): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("open_journey_boarding", {
      p_journey_id: journeyId,
      p_officer_id: user.id,
      p_window_minutes: windowMinutes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to open boarding session.",
        code: result?.code as string,
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/admin/operations");
    revalidatePath("/driver");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Boarding session started.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to open boarding session.";
    return { success: false, error: message };
  }
}

/**
 * Backwards-compatible alias for startBoardingSession
 */
export async function startBoardingSession(journeyId: string) {
  return openBoardingSessionAction(journeyId);
}

/**
 * Stage 5: Close Boarding Session.
 * Representative manually closes boarding or reviews upon timer expiry.
 * Timer expiry NEVER auto-departs bus.
 * Preserves unboarded passengers WITHOUT auto-marking as no-shows.
 */
export async function closeBoardingSessionAction(
  journeyId: string,
  notes?: string
): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("close_journey_boarding", {
      p_journey_id: journeyId,
      p_officer_id: user.id,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to close boarding.",
        code: result?.code as string,
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/admin/operations");

    return {
      success: true,
      message: (result.message as string) || "Boarding closed. Manifest ready for review.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to close boarding.";
    return { success: false, error: message };
  }
}

/**
 * Stage 6: Authorise Journey Departure (Ready to Depart).
 * The representative explicitly confirms boarding completion and authorises departure.
 * Bus Manager sees that the journey is ready for dispatch; driver is instructed to close doors.
 */
export async function authoriseDepartureAction(
  journeyId: string,
  notes?: string
): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("authorise_journey_departure", {
      p_journey_id: journeyId,
      p_officer_id: user.id,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to authorise departure.",
        code: result?.code as string,
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/admin/operations");
    revalidatePath("/driver");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Departure authorised. Ready for dispatch.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to authorise departure.";
    return { success: false, error: message };
  }
}

/**
 * Stage 7: Confirm Journey Dispatch / Actual Departure.
 * Confirms actual departure time, sets journey status to 'in_transit',
 * and notifies students.
 */
export async function confirmDispatchAction(
  journeyId: string,
  notes?: string
): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("confirm_journey_dispatch", {
      p_journey_id: journeyId,
      p_user_id: user.id,
      p_notes: notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to confirm dispatch.",
        code: result?.code as string,
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/admin/operations");
    revalidatePath("/driver");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Journey successfully departed.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record departure.";
    return { success: false, error: message };
  }
}

/**
 * Authorised journey closure workflow (backwards compatible).
 */
export async function closeAndDepartJourneyAction(
  journeyId: string,
  markUnboardedAsNoShow: boolean = false,
  closureNotes?: string
): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("close_and_depart_journey", {
      p_journey_id: journeyId,
      p_officer_id: user.id,
      p_closure_notes: closureNotes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to close journey.",
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/driver");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Journey successfully closed and departed.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to close journey.";
    return { success: false, error: message };
  }
}

/**
 * Backwards-compatible alias for closeAndDepartJourneyAction
 */
export async function departJourney(
  journeyId: string,
  markUnboardedAsNoShow = false,
  closureNotes?: string
) {
  return closeAndDepartJourneyAction(journeyId, markUnboardedAsNoShow, closureNotes);
}

/**
 * Manual boarding override for a student who does not have their phone/QR pass.
 * Logs an auditable exception reason and calls the atomic verify_and_board_passenger procedure.
 */
export async function boardPassengerManualOverride(
  bookingId: string,
  journeyId: string,
  exceptionReason: string
): Promise<BoardingActionResponse> {
  try {
    if (!exceptionReason || exceptionReason.trim().length < 5) {
      return {
        success: false,
        error: "A valid exception reason is required for auditable manual boarding (e.g. 'Verified physical university ID card').",
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    // Retrieve ticket_token for this booking
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("ticket_token")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking || !booking.ticket_token) {
      return { success: false, error: "Booking ticket token not found." };
    }

    // Call atomic verification procedure with 'manual_override'
    const result = await verifyAndBoardPassAction(
      booking.ticket_token,
      journeyId,
      "manual_override",
      exceptionReason
    );

    if (!result.success) {
      return {
        success: false,
        error: result.message,
      };
    }

    return {
      success: true,
      message: result.message,
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete manual boarding.";
    return { success: false, error: message };
  }
}

/**
 * Marks a single passenger as no-show.
 */
export async function markPassengerNoShowAction(bookingId: string): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { error } = await supabase
      .from("bookings")
      .update({ status: "no_show" })
      .eq("id", bookingId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/boarding/boarding");

    return { success: true, message: "Passenger marked as no-show." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update status.";
    return { success: false, error: message };
  }
}

/**
 * Incident Reporting: Allows boarding officers and representatives to report
 * operational incidents (overcrowding, breakdown, student left behind, etc.).
 */
export async function reportOperationalIncident(
  journeyId: string | null,
  vehicleId: string | null,
  category: string,
  severity: "low" | "medium" | "high" | "critical",
  description: string
): Promise<BoardingActionResponse> {
  try {
    if (!description || description.trim().length < 10) {
      return { success: false, error: "Please provide a detailed incident description (min 10 characters)." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { error } = await supabase.from("incident_reports").insert({
      journey_id: journeyId || null,
      vehicle_id: vehicleId || null,
      reported_by: user.id,
      category: category.trim(),
      severity,
      description: description.trim(),
      status: "reported",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/boarding");
    return { success: true, message: "Incident logged successfully for administrator review." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to submit incident report.";
    return { success: false, error: message };
  }
}
