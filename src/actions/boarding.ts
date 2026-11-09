"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type BoardingStatusCode =
  | "VALID"
  | "ALREADY_BOARDED"
  | "INVALID_TICKET"
  | "WRONG_JOURNEY"
  | "CANCELLED"
  | "CROSS_GROUP_DENIED"
  | "CAPACITY_EXCEEDED"
  | "JOURNEY_CLOSED"
  | "UNAUTHORIZED"
  | "SERVER_ERROR";

export interface BoardingVerificationResult {
  success: boolean;
  code: BoardingStatusCode;
  message: string;
  passengerName?: string;
  studentId?: string;
  boardedCount?: number;
  capacity?: number;
  busRegistration?: string;
  originalScanAt?: string;
}

export interface BoardingActionResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
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
      code: (result?.code as BoardingStatusCode) || (result?.success ? "VALID" : "SERVER_ERROR"),
      message: (result?.message as string) || (result?.error as string) || "Verification complete",
      passengerName: result?.passenger_name as string | undefined,
      studentId: result?.student_id as string | undefined,
      boardedCount: result?.boarded_count as number | undefined,
      capacity: result?.capacity as number | undefined,
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
 * Starts a boarding session for a journey (transitions status to 'boarding').
 */
export async function startBoardingSession(journeyId: string): Promise<BoardingActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "boarding_officer" && profile?.role !== "admin") {
      return { success: false, error: "Only boarding officers or administrators can start boarding." };
    }

    const { error } = await supabase
      .from("journeys")
      .update({ status: "boarding" })
      .eq("id", journeyId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/student/departures");

    return { success: true, message: "Boarding session started." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start boarding session.";
    return { success: false, error: message };
  }
}

/**
 * Authorised journey closure workflow.
 * Summarises boarding metrics, optionally marks unboarded confirmed passengers as no-shows,
 * departs the bus, and logs the closure timestamp to audit logs.
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
      p_mark_unboarded_as_noshow: markUnboardedAsNoShow,
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
export const departJourney = closeAndDepartJourneyAction;

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
