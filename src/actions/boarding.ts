"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type BoardingStatusCode =
  | "VALID"
  | "BOARDING_APPROVED"
  | "ALREADY_BOARDED"
  | "ALREADY_CHECKED_IN"
  | "TICKET_ALREADY_BOARDED"
  | "INVALID_TICKET"
  | "WRONG_JOURNEY"
  | "CANCELLED"
  | "CANCELLED_TICKET"
  | "TICKET_CANCELLED"
  | "CROSS_GROUP_DENIED"
  | "BUS_FULL"
  | "CAPACITY_EXCEEDED"
  | "UNVERIFIED_VEHICLE_CAPACITY"
  | "JOURNEY_NOT_BOARDING"
  | "BOARDING_CLOSED"
  | "JOURNEY_CLOSED"
  | "EXCEPTION_REASON_REQUIRED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SERVER_ERROR";

async function getActiveBoardingActorProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, admin_role, is_active")
    .eq("id", userId)
    .single();
  return profile;
}

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
    const trimmedReason = exceptionReason?.trim() || null;
    if (boardingMethod === "manual_override" && (!trimmedReason || trimmedReason.length < 5)) {
      return {
        success: false,
        code: "EXCEPTION_REASON_REQUIRED",
        message: "Manual boarding override requires an exception reason of at least 5 characters.",
      };
    }

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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (!actorProfile || actorProfile.is_active === false) {
      return {
        success: false,
        code: "UNAUTHORIZED",
        message: "Your account is deactivated. Contact a CosmoRide administrator.",
      };
    }

    const { data, error } = await supabase.rpc("verify_and_board_passenger", {
      p_ticket_token: ticketToken.trim(),
      p_officer_id: user.id,
      p_journey_id: journeyId,
      p_boarding_method: boardingMethod,
      p_exception_reason: trimmedReason,
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
      boardedSeatedCount:
        (result?.seated_count as number | undefined) ??
        (result?.boarded_seated_count as number | undefined),
      boardedStandingCount:
        (result?.standing_count as number | undefined) ??
        (result?.boarded_standing_count as number | undefined),
      seatedLimit: result?.seated_limit as number | undefined,
      standingLimit: result?.standing_limit as number | undefined,
      capacity:
        (result?.total_capacity as number | undefined) ??
        (result?.capacity as number | undefined),
      totalCapacity: result?.total_capacity as number | undefined,
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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated.", code: "ACCOUNT_INACTIVE" };
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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated.", code: "ACCOUNT_INACTIVE" };
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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated.", code: "ACCOUNT_INACTIVE" };
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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated.", code: "ACCOUNT_INACTIVE" };
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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (
      !actorProfile ||
      actorProfile.is_active === false ||
      actorProfile.role !== "admin" ||
      (actorProfile.admin_role !== "super_admin" && actorProfile.admin_role !== "bus_manager")
    ) {
      return {
        success: false,
        error: "Permission denied: Only active Super Administrators or Bus Managers may confirm Stage 7 rolling dispatch.",
        code: "FORBIDDEN",
      };
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
    revalidatePath("/admin/dispatch");
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
 * Marks a single passenger as no-show via audited RPC (enforces active rep/admin authorization,
 * hostel transport group isolation, and blocks invalid state transitions).
 */
export async function markPassengerNoShowAction(
  bookingId: string,
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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated.", code: "ACCOUNT_INACTIVE" };
    }

    const { data, error } = await supabase.rpc("mark_passenger_no_show", {
      p_booking_id: bookingId,
      p_officer_id: user.id,
      p_notes: notes?.trim() || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown> | null;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to mark passenger as no-show.",
        code: result?.code as string | undefined,
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/boarding/boarding");
    revalidatePath("/admin/operations");
    revalidatePath("/student/departures");
    revalidatePath("/student/trips");

    return {
      success: true,
      message: (result.message as string) || "Passenger marked as no-show.",
      data: result,
    };
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
  _vehicleId: string | null,
  category: string,
  severity: "low" | "medium" | "high" | "critical",
  description: string
): Promise<BoardingActionResponse> {
  void _vehicleId;
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

    const actorProfile = await getActiveBoardingActorProfile(supabase, user.id);
    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated.", code: "ACCOUNT_INACTIVE" };
    }

    const { data, error } = await supabase.rpc("report_operational_incident", {
      p_journey_id: journeyId || null,
      p_actor_id: user.id,
      p_category: category.trim(),
      p_severity: severity,
      p_description: description.trim(),
      p_is_assisted: true,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown> | null;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to submit incident report.",
        code: result?.code as string | undefined,
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/admin/incidents");
    return {
      success: true,
      message: (result.message as string) || "Incident logged successfully for administrator review.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to submit incident report.";
    return { success: false, error: message };
  }
}
