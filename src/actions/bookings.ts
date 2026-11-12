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

async function ensureActiveStudentAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("student_id, role, is_active")
    .eq("id", userId)
    .single();

  if (!profile || profile.is_active === false) {
    return "Your account is currently deactivated. Please contact a CosmoRide administrator.";
  }

  if (profile.role !== "student") {
    return "Only active student accounts may perform student booking operations.";
  }

  if (!profile.student_id || profile.student_id.trim() === "") {
    return "Your student profile is incomplete. Please complete your registration with your matriculation number before booking.";
  }

  return null;
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

    // Verify active student profile completeness
    const profileError = await ensureActiveStudentAccount(supabase, user.id);
    if (profileError) {
      return {
        success: false,
        error: profileError,
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

    const profileError = await ensureActiveStudentAccount(supabase, user.id);
    if (profileError) {
      return { success: false, error: profileError };
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

    const profileError = await ensureActiveStudentAccount(supabase, user.id);
    if (profileError) {
      return { success: false, error: profileError };
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
