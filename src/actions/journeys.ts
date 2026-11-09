"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createJourneySchema, updateJourneyStatusSchema } from "@/lib/validators";
import type { ActionResponse } from "./bookings";
import type { JourneyStatus } from "@/lib/supabase/types";

/**
 * Creates a journey instance (Admin only).
 * Enforces rule: Proposed allocation must not override vehicle safe capacity.
 */
export async function createJourney(formData: unknown): Promise<ActionResponse> {
  try {
    const parsed = createJourneySchema.safeParse(formData);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    // Check admin role
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return { success: false, error: "Only administrators can create journeys." };
    }

    // Verify vehicle and safe capacity
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("safe_capacity, is_active")
      .eq("id", parsed.data.vehicleId)
      .single();

    if (vehicleError || !vehicle) {
      return { success: false, error: "Selected vehicle does not exist." };
    }

    if (!vehicle.is_active) {
      return { success: false, error: "Selected vehicle is currently marked inactive." };
    }

    // Strict safety check: Proposed allocation must never exceed vehicle's safe approved capacity
    const effectiveAllocation = Math.min(
      parsed.data.proposedAllocation,
      vehicle.safe_capacity
    );

    const { error: insertError } = await supabase.from("journeys").insert({
      route_id: parsed.data.routeId,
      vehicle_id: parsed.data.vehicleId,
      driver_id: parsed.data.driverId,
      journey_date: parsed.data.journeyDate,
      scheduled_departure: parsed.data.scheduledDeparture,
      proposed_allocation: effectiveAllocation,
      schedule_id: parsed.data.scheduleId ?? null,
      status: "scheduled",
      created_by: user.id,
    });

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/journeys");
    revalidatePath("/student/journeys");

    return { success: true, message: "Journey scheduled successfully." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create journey.";
    return { success: false, error: message };
  }
}

/**
 * Updates journey status (Driver assigned to the journey, or Admin).
 * Transitions: scheduled -> boarding -> in_transit -> completed (or cancelled)
 */
export async function updateJourneyStatus(
  journeyId: string,
  newStatus: JourneyStatus
): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    // Fetch journey and check permissions
    const { data: journey, error: journeyError } = await supabase
      .from("journeys")
      .select("driver_id, status")
      .eq("id", journeyId)
      .single();

    if (journeyError || !journey) {
      return { success: false, error: "Journey not found." };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const isDriver = journey.driver_id === user.id;
    const isAdmin = profile?.role === "admin";

    if (!isDriver && !isAdmin) {
      return {
        success: false,
        error: "Permission denied. Only the assigned driver or an administrator can update journey status.",
      };
    }

    const updatePayload: {
      status: JourneyStatus;
      actual_departure?: string;
    } = {
      status: newStatus,
    };

    if (newStatus === "in_transit") {
      updatePayload.actual_departure = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("journeys")
      .update(updatePayload)
      .eq("id", journeyId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/admin/journeys");
    revalidatePath("/student/journeys");

    return {
      success: true,
      message: `Journey status updated to ${newStatus}.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update status.";
    return { success: false, error: message };
  }
}

/**
 * Driver reports a manual delay update (minutes + optional reason).
 * Fulfills operating rule: No live GPS; drivers post manual delay updates.
 */
export async function reportJourneyDelay(
  journeyId: string,
  delayMinutes: number,
  delayReason: string
): Promise<ActionResponse> {
  try {
    if (delayMinutes < 0) {
      return { success: false, error: "Delay minutes cannot be negative." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data: journey } = await supabase
      .from("journeys")
      .select("driver_id")
      .eq("id", journeyId)
      .single();

    if (!journey) {
      return { success: false, error: "Journey not found." };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (journey.driver_id !== user.id && profile?.role !== "admin") {
      return {
        success: false,
        error: "Only the assigned driver or an administrator can post delay updates.",
      };
    }

    const { error: updateError } = await supabase
      .from("journeys")
      .update({
        delay_minutes: delayMinutes,
        delay_reason: delayReason.trim() || null,
      })
      .eq("id", journeyId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/student");
    revalidatePath("/student/journeys");

    return {
      success: true,
      message: `Delay of ${delayMinutes} mins reported. Passengers will see the updated departure notice.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to report delay.";
    return { success: false, error: message };
  }
}
