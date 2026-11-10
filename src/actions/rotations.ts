"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { VehicleMovementStatus } from "@/lib/supabase/types";

export interface RotationActionResponse<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

/**
 * Verifies caller has an active admin profile.
 */
async function verifyAdminCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Authentication required.");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, admin_role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    throw new Error("Permission denied: Only transport administrators can perform this action.");
  }

  return { supabase, user, profile };
}

/**
 * Authorize an optional vehicle rotation after an outbound trip has departed.
 * Strictly gated to Operations Controller.
 */
export async function authorizeVehicleRotationAction({
  sourceJourneyId,
  nextJourneyId,
  vehicleId,
  driverRecordId,
  operationalReason,
  originName,
  destinationName,
}: {
  sourceJourneyId: string;
  nextJourneyId: string;
  vehicleId: string;
  driverRecordId?: string | null;
  operationalReason: string;
  originName?: string;
  destinationName?: string;
}): Promise<RotationActionResponse<{ movementId: string; movementStatus?: string }>> {
  try {
    const { supabase, profile } = await verifyAdminCaller();

    if (profile.admin_role !== "operations_controller") {
      return {
        success: false,
        error: "Permission denied: Vehicle rotation can only be authorized by an Operations Controller.",
      };
    }

    if (!sourceJourneyId || !nextJourneyId || !vehicleId) {
      return {
        success: false,
        error: "Source journey, next destination journey, and physical vehicle are mandatory.",
      };
    }

    if (!operationalReason || operationalReason.trim().length < 5) {
      return {
        success: false,
        error: "A valid operational reason explaining the vehicle rotation is mandatory.",
      };
    }

    const { data, error } = await supabase.rpc("authorize_vehicle_rotation", {
      p_source_journey_id: sourceJourneyId,
      p_next_journey_id: nextJourneyId,
      p_vehicle_id: vehicleId,
      p_driver_record_id: driverRecordId || null,
      p_operational_reason: operationalReason.trim(),
      p_origin_name: originName?.trim() || null,
      p_destination_name: destinationName?.trim() || "Main Campus Central Bus Park",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as {
      success: boolean;
      code: string;
      error?: string;
      movement_id?: string;
      movement_status?: string;
      message?: string;
    };

    if (!result.success) {
      return { success: false, error: result.error || "Failed to authorize vehicle rotation." };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/rotations");
    revalidatePath("/admin/dispatch");
    revalidatePath("/admin/journeys");

    return {
      success: true,
      message: result.message || "Vehicle rotation authorized successfully.",
      data: {
        movementId: result.movement_id!,
        movementStatus: result.movement_status,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to authorize vehicle rotation.";
    return { success: false, error: message };
  }
}

/**
 * Transition an empty repositioning movement from 'planned' to 'returning'
 * once the source passenger journey has completed and all passengers have alighted.
 */
export async function startVehicleRepositioningAction({
  movementId,
}: {
  movementId: string;
}): Promise<RotationActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    if (!movementId) {
      return { success: false, error: "Movement ID is required." };
    }

    const { data, error } = await supabase.rpc("start_vehicle_repositioning", {
      p_movement_id: movementId,
      p_staff_id: user.id,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as {
      success: boolean;
      code: string;
      error?: string;
      message?: string;
    };

    if (!result.success) {
      return { success: false, error: result.error || "Failed to start vehicle repositioning." };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/rotations");
    revalidatePath("/admin/dispatch");
    revalidatePath("/admin/journeys");

    return {
      success: true,
      message: result.message || "Empty repositioning movement started. Bus is returning to Main Campus.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start vehicle repositioning.";
    return { success: false, error: message };
  }
}

/**
 * Confirm the physical arrival of a rotated bus back at Main Campus Central Bus Park.
 * Bus Manager or Operations Controller can physically inspect and confirm return.
 * This unlocks the next journey for boarding.
 */
export async function confirmRotatedBusReturnAction({
  movementId,
  notes,
}: {
  movementId: string;
  notes?: string;
}): Promise<RotationActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    if (!movementId) {
      return { success: false, error: "Vehicle movement ID is required." };
    }

    const { data, error } = await supabase.rpc("confirm_rotated_bus_campus_arrival", {
      p_movement_id: movementId,
      p_staff_id: user.id,
      p_notes: notes?.trim() || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as {
      success: boolean;
      code: string;
      error?: string;
      message?: string;
    };

    if (!result.success) {
      return { success: false, error: result.error || "Failed to confirm campus arrival." };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/rotations");
    revalidatePath("/admin/dispatch");
    revalidatePath("/admin/journeys");

    return {
      success: true,
      message: result.message || "Physical campus return confirmed. Next journey boarding lock released.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to confirm campus return.";
    return { success: false, error: message };
  }
}

/**
 * Cancel an active vehicle rotation.
 * Operations Controller only.
 */
export async function cancelVehicleRotationAction({
  movementId,
  reason,
}: {
  movementId: string;
  reason?: string;
}): Promise<RotationActionResponse> {
  try {
    const { supabase, profile } = await verifyAdminCaller();

    if (profile.admin_role !== "operations_controller") {
      return {
        success: false,
        error: "Permission denied: Only an Operations Controller can cancel an active vehicle rotation.",
      };
    }

    if (!movementId) {
      return { success: false, error: "Movement ID is required." };
    }

    const { data, error } = await supabase.rpc("cancel_vehicle_rotation", {
      p_movement_id: movementId,
      p_cancellation_reason: reason?.trim() || "Operational adjustment by Operations Controller",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as {
      success: boolean;
      code: string;
      error?: string;
      message?: string;
    };

    if (!result.success) {
      return { success: false, error: result.error || "Failed to cancel vehicle rotation." };
    }

    revalidatePath("/admin");
    revalidatePath("/admin/rotations");
    revalidatePath("/admin/dispatch");
    revalidatePath("/admin/journeys");

    return {
      success: true,
      message: result.message || "Vehicle rotation cancelled successfully.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel vehicle rotation.";
    return { success: false, error: message };
  }
}

/**
 * Fetch all active or recent vehicle movements.
 */
export async function getVehicleMovementsAction(statusFilter?: VehicleMovementStatus) {
  try {
    const { supabase } = await verifyAdminCaller();

    let query = supabase
      .from("vehicle_movements")
      .select(`
        id,
        vehicle_id,
        movement_type,
        origin_name,
        destination_name,
        source_journey_id,
        next_journey_id,
        driver_record_id,
        status,
        initiated_by,
        initiated_at,
        arrived_at,
        confirmed_by,
        cancelled_at,
        cancellation_reason,
        operational_reason,
        notes,
        created_at,
        vehicle:vehicles (
          id,
          registration_number,
          name,
          safe_capacity,
          status
        ),
        source_journey:journeys!vehicle_movements_source_journey_id_fkey (
          id,
          scheduled_departure,
          status,
          route:routes (
            id,
            name,
            code
          )
        ),
        next_journey:journeys!vehicle_movements_next_journey_id_fkey (
          id,
          scheduled_departure,
          status,
          is_rotated_vehicle,
          rotation_campus_return_confirmed_at,
          route:routes (
            id,
            name,
            code
          )
        ),
        driver:drivers (
          id,
          full_name,
          driver_reference
        ),
        initiator:profiles!vehicle_movements_initiated_by_fkey (
          id,
          full_name,
          email,
          admin_role
        ),
        confirmer:profiles!vehicle_movements_confirmed_by_fkey (
          id,
          full_name,
          email,
          admin_role
        )
      `)
      .order("initiated_at", { ascending: false });

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    return { success: true, data: data || [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch vehicle movements.";
    return { success: false, error: message, data: [] };
  }
}
