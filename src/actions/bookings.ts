"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ActionResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

interface BookRpcResult {
  success: boolean;
  error?: string;
  message?: string;
  status?: "confirmed" | "waitlisted";
  booking_id?: string;
  ticket_token?: string;
  waitlist_position?: number;
  seats_remaining?: number;
  passenger_category?: "seated" | "standing";
}

interface CancelRpcResult {
  success: boolean;
  error?: string;
  message?: string;
  promoted_student_id?: string;
}

interface BoardingRpcResult {
  success: boolean;
  error?: string;
  message?: string;
  passenger_name?: string;
  student_id?: string;
  boarded_count?: number;
  capacity?: number;
}

/**
 * Books a seat on a journey for the authenticated student.
 * Uses atomic PostgreSQL stored procedure `book_journey_seat` with row-level locks
 * to eliminate race conditions for final seat reservations.
 * If capacity is exhausted, the student is safely placed on the waiting list.
 */
export async function bookSeat(
  journeyId: string,
  boardingStopId: string
): Promise<ActionResponse<BookRpcResult>> {
  try {
    if (!boardingStopId || boardingStopId.trim() === "") {
      return {
        success: false,
        error: "Please select a valid boarding pickup stop for this route.",
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required to book a seat." };
    }

    // Verify student profile completeness
    const { data: profile } = await supabase
      .from("profiles")
      .select("student_id")
      .eq("id", user.id)
      .single();

    if (!profile?.student_id || profile.student_id.trim() === "") {
      return {
        success: false,
        error:
          "Your student profile is incomplete. Please complete your registration with your matriculation number before booking.",
      };
    }

    // Call atomic stored procedure
    const { data, error } = await supabase.rpc("book_journey_seat", {
      p_journey_id: journeyId,
      p_student_id: user.id,
      p_boarding_stop_id: boardingStopId,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as unknown as BookRpcResult;
    if (!result || !result.success) {
      return {
        success: false,
        error:
          result?.message ??
          result?.error ??
          "Failed to reserve seat. Capacity may be full.",
      };
    }

    revalidatePath("/student");
    revalidatePath("/student/departures");
    revalidatePath("/student/trips");
    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/admin/operations");

    return {
      success: true,
      message: result.message ?? "Seat reserved successfully.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to book seat.";
    return { success: false, error: message };
  }
}

/**
 * Cancels an active booking for the authenticated student.
 * Uses atomic stored procedure `cancel_booking_and_promote` to safely reclaim capacity
 * and immediately promote the top waiting list student if one is present.
 */
export async function cancelBooking(bookingId: string): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    // Call atomic stored procedure
    const { data, error } = await supabase.rpc("cancel_booking_and_promote", {
      p_booking_id: bookingId,
      p_student_id: user.id,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as unknown as CancelRpcResult;
    if (!result || !result.success) {
      return {
        success: false,
        error: result?.error ?? "Failed to cancel booking.",
      };
    }

    revalidatePath("/student");
    revalidatePath("/student/departures");
    revalidatePath("/student/trips");
    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/admin/operations");

    return {
      success: true,
      message: result.message ?? "Booking cancelled successfully.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel booking.";
    return { success: false, error: message };
  }
}

/**
 * Removes a student from an active waitlist entry cleanly via atomic RPC.
 */
export async function cancelWaitlistAction(waitlistId: string): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("cancel_waitlist_entry", {
      p_waitlist_id: waitlistId,
      p_student_id: user.id,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as unknown as CancelRpcResult;
    if (!result || !result.success) {
      return {
        success: false,
        error: result?.error ?? "Failed to leave waitlist.",
      };
    }

    revalidatePath("/student");
    revalidatePath("/student/departures");
    revalidatePath("/student/trips");
    revalidatePath("/admin/operations");

    return {
      success: true,
      message: result.message ?? "Waitlist reservation cancelled.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to leave waitlist.";
    return { success: false, error: message };
  }
}

/**
 * Validates a boarding pass token and boards a passenger.
 * Uses atomic procedure `verify_and_board_passenger` to ensure:
 * 1. Opaque ticket token verification (no sensitive data exposed in QR).
 * 2. Correct journey and vehicle match.
 * 3. Cancelled booking rejection.
 * 4. Duplicate scan prevention.
 * 5. Safe capacity ceiling enforcement.
 * 6. Auditable logging of manual exceptions.
 */
export async function verifyAndBoardPass(
  ticketToken: string,
  journeyId: string,
  boardingMethod: "qr_scan" | "manual_override" = "qr_scan",
  exceptionReason?: string
): Promise<ActionResponse<BoardingRpcResult>> {
  try {
    const trimmedReason = exceptionReason?.trim() || null;
    if (boardingMethod === "manual_override" && (!trimmedReason || trimmedReason.length < 5)) {
      return {
        success: false,
        error: "Manual boarding override requires an exception reason of at least 5 characters.",
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("verify_and_board_passenger", {
      p_ticket_token: ticketToken,
      p_officer_id: user.id,
      p_journey_id: journeyId,
      p_boarding_method: boardingMethod,
      p_exception_reason: trimmedReason,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as unknown as BoardingRpcResult;
    if (!result || !result.success) {
      return {
        success: false,
        error: result?.error ?? "Boarding verification failed.",
      };
    }

    revalidatePath("/boarding");
    revalidatePath("/boarding/sessions");
    revalidatePath("/driver");

    return {
      success: true,
      message: result.message ?? "Passenger boarded.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to verify boarding pass.";
    return { success: false, error: message };
  }
}
