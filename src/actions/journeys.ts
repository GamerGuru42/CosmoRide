"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canAccessAdminDomain } from "@/lib/admin-auth";
import { createJourneySchema, updateJourneyStatusSchema } from "@/lib/validators";
import type { ActionResponse } from "./bookings";
import type { JourneyStatus } from "@/lib/supabase/types";

/**
 * Creates a journey instance (Super Admin or Bus Manager only).
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

    // Check admin role & domain authority (Super Admin or Bus Manager)
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, admin_role, is_active")
      .eq("id", user.id)
      .single();

    if (
      profile?.is_active === false ||
      profile?.role !== "admin" ||
      !canAccessAdminDomain(profile?.admin_role, "journey_create")
    ) {
      return {
        success: false,
        error: "Permission denied: Only Super Administrators or Bus Managers can create journeys.",
      };
    }

    // Call atomic journey creation procedure with exclusive vehicle row locking
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "admin_create_journey",
      {
        p_admin_id: user.id,
        p_route_id: parsed.data.routeId,
        p_vehicle_id: parsed.data.vehicleId,
        p_driver_id: parsed.data.driverId ?? null,
        p_driver_record_id: parsed.data.driverRecordId ?? null,
        p_journey_date: parsed.data.journeyDate,
        p_scheduled_departure: parsed.data.scheduledDeparture,
        p_proposed_allocation: parsed.data.proposedAllocation,
        p_schedule_id: parsed.data.scheduleId ?? null,
      }
    );

    const result = rpcResult as {
      success: boolean;
      code?: string;
      journey_id?: string;
      error?: string;
      message?: string;
    } | null;

    if (rpcError || !result?.success) {
      return {
        success: false,
        error: result?.error ?? rpcError?.message ?? "Failed to create journey.",
      };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/journeys");
    revalidatePath("/admin/dispatch");
    revalidatePath("/admin/operations");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: result.message ?? "Journey scheduled successfully.",
      data: { id: result.journey_id },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create journey.";
    return { success: false, error: message };
  }
}

/**
 * Updates journey lifecycle status through audited PostgreSQL stage RPCs.
 * Strictly enforces the 7-stage departure progression.
 */
export async function updateJourneyStatus(
  journeyId: string,
  newStatus: JourneyStatus
): Promise<ActionResponse> {
  try {
    const parsed = updateJourneyStatusSchema.safeParse({ journeyId, status: newStatus });
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

    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .single();

    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated." };
    }

    if (newStatus === "scheduled") {
      return {
        success: false,
        error: "Cannot revert a journey back to scheduled status.",
      };
    }

    if (newStatus === "cancelled") {
      return {
        success: false,
        error: "Please use cancelJourneyAction with an explicit cancellation reason.",
      };
    }

    let rpcResult: unknown = null;
    let rpcError: { message: string } | null = null;

    if (newStatus === "bus_arrived") {
      const res = await supabase.rpc("confirm_bus_arrival", {
        p_journey_id: journeyId,
        p_user_id: user.id,
      });
      rpcResult = res.data;
      rpcError = res.error;
    } else if (newStatus === "boarding") {
      const res = await supabase.rpc("open_journey_boarding", {
        p_journey_id: journeyId,
        p_officer_id: user.id,
      });
      rpcResult = res.data;
      rpcError = res.error;
    } else if (newStatus === "boarding_closed") {
      const res = await supabase.rpc("close_journey_boarding", {
        p_journey_id: journeyId,
        p_officer_id: user.id,
      });
      rpcResult = res.data;
      rpcError = res.error;
    } else if (newStatus === "ready_to_depart") {
      const res = await supabase.rpc("authorise_journey_departure", {
        p_journey_id: journeyId,
        p_officer_id: user.id,
      });
      rpcResult = res.data;
      rpcError = res.error;
    } else if (newStatus === "in_transit") {
      const res = await supabase.rpc("record_journey_departure_safe", {
        p_journey_id: journeyId,
        p_actor_id: user.id,
        p_is_assisted: false,
      });
      rpcResult = res.data;
      rpcError = res.error;
    } else if (newStatus === "completed") {
      const res = await supabase.rpc("record_journey_arrival_safe", {
        p_journey_id: journeyId,
        p_actor_id: user.id,
        p_is_assisted: false,
      });
      rpcResult = res.data;
      rpcError = res.error;
    }

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const parsedRpc = rpcResult as { success?: boolean; error?: string; message?: string } | null;
    if (!parsedRpc?.success) {
      return {
        success: false,
        error: parsedRpc?.error ?? `Failed to transition journey to ${newStatus}.`,
      };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/passengers");
    revalidatePath("/admin/journeys");
    revalidatePath("/admin/operations");
    revalidatePath("/admin/dispatch");
    revalidatePath("/student/departures");
    revalidatePath("/student/trips");

    return {
      success: true,
      message: parsedRpc.message ?? `Journey status updated to ${newStatus}.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update status.";
    return { success: false, error: message };
  }
}

/**
 * Driver or operations staff reports a manual delay update (minutes + reason)
 * via audited atomic RPC that notifies affected confirmed/checked-in passengers.
 */
export async function reportJourneyDelay(
  journeyId: string,
  delayMinutes: number,
  delayReason: string
): Promise<ActionResponse> {
  try {
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1 || delayMinutes > 360) {
      return { success: false, error: "Delay duration must be between 1 and 360 minutes." };
    }

    if (!delayReason || delayReason.trim().length < 3) {
      return { success: false, error: "A valid delay reason (minimum 3 characters) is required." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .single();

    if (!actorProfile || actorProfile.is_active === false) {
      return { success: false, error: "Your account is currently deactivated." };
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "record_journey_delay_with_notifications",
      {
        p_journey_id: journeyId,
        p_user_id: user.id,
        p_delay_minutes: delayMinutes,
        p_delay_reason: delayReason.trim(),
        p_is_assisted: false,
      }
    );

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const parsedRpc = rpcResult as { success?: boolean; error?: string; message?: string } | null;
    if (!parsedRpc?.success) {
      return {
        success: false,
        error: parsedRpc?.error ?? "Failed to report operational delay.",
      };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/boarding");
    revalidatePath("/admin/journeys");
    revalidatePath("/admin/operations");
    revalidatePath("/student");
    revalidatePath("/student/departures");
    revalidatePath("/student/notifications");

    return {
      success: true,
      message:
        parsedRpc.message ??
        `Delay of ${delayMinutes} mins reported. Passengers have been notified.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to report delay.";
    return { success: false, error: message };
  }
}

