"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface DriverActionResponse<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

/**
 * Records pre-departure vehicle readiness checklist.
 * Can be executed directly by an assigned driver (Mode A)
 * or by an authorised hostel representative on the driver's behalf (Mode B).
 * Enforces safety gate: If vehicle is marked unsafe, departure is blocked!
 */
export async function recordVehicleReadinessAction({
  journeyId,
  vehicleAvailable,
  vehicleSafe,
  mechanicalFault,
  faultDescription,
  journeyReviewed,
  batteryLevel,
  tiresAndLights,
  notes,
  isAssisted = false,
}: {
  journeyId: string;
  vehicleAvailable: boolean;
  vehicleSafe: boolean;
  mechanicalFault: boolean;
  faultDescription?: string;
  journeyReviewed: boolean;
  batteryLevel: number;
  tiresAndLights: boolean;
  notes?: string;
  isAssisted?: boolean;
}): Promise<DriverActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required to perform readiness inspection." };
    }

    const { data, error } = await supabase.rpc("record_vehicle_readiness", {
      p_journey_id: journeyId,
      p_user_id: user.id,
      p_vehicle_available: vehicleAvailable,
      p_vehicle_safe: vehicleSafe,
      p_mechanical_fault: mechanicalFault,
      p_fault_description: faultDescription?.trim() || null,
      p_journey_reviewed: journeyReviewed,
      p_battery_level: Math.max(0, Math.min(100, batteryLevel)),
      p_tires_and_lights: tiresAndLights,
      p_notes: notes?.trim() || null,
      p_is_assisted: isAssisted,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to record readiness inspection.",
      };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/boarding");
    revalidatePath("/boarding/assisted");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Vehicle readiness checklist recorded.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record readiness check.";
    return { success: false, error: message };
  }
}

/**
 * Records stop-level milestone updates (Approaching, Arrived, Pickup Completed, Departed Stop).
 * Mode A: Driver reports directly via smartphone.
 * Mode B: Hostel representative records on behalf of driver at the pickup post.
 */
export async function recordStopMilestoneAction({
  journeyId,
  stopId,
  eventType,
  notes,
  isAssisted = false,
}: {
  journeyId: string;
  stopId: string;
  eventType: "approaching" | "arrived" | "pickup_completed" | "departed";
  notes?: string;
  isAssisted?: boolean;
}): Promise<DriverActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc("record_journey_stop_update", {
      p_journey_id: journeyId,
      p_stop_id: stopId,
      p_user_id: user.id,
      p_event_type: eventType,
      p_notes: notes?.trim() || null,
      p_is_assisted: isAssisted,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to record stop milestone.",
      };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/boarding");
    revalidatePath("/boarding/assisted");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Stop milestone update recorded.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record stop update.";
    return { success: false, error: message };
  }
}

/**
 * Reports a journey delay with reasons and automatically dispatches
 * notifications to all confirmed students booked on that departure.
 */
export async function reportOperationalDelayAction({
  journeyId,
  delayMinutes,
  delayReason,
  notes,
  isAssisted = false,
}: {
  journeyId: string;
  delayMinutes: number;
  delayReason: string;
  notes?: string;
  isAssisted?: boolean;
}): Promise<DriverActionResponse> {
  try {
    if (delayMinutes < 1) {
      return { success: false, error: "Delay minutes must be at least 1." };
    }
    if (!delayReason || delayReason.trim().length < 3) {
      return { success: false, error: "Please specify a valid operational delay reason." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const { data, error } = await supabase.rpc(
      "record_journey_delay_with_notifications",
      {
        p_journey_id: journeyId,
        p_user_id: user.id,
        p_delay_minutes: delayMinutes,
        p_delay_reason: delayReason.trim(),
        p_notes: notes?.trim() || null,
        p_is_assisted: isAssisted,
      }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Failed to log operational delay.",
      };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/boarding");
    revalidatePath("/boarding/assisted");
    revalidatePath("/student");
    revalidatePath("/student/departures");
    revalidatePath("/student/notifications");

    return {
      success: true,
      message: (result.message as string) || "Delay reported and passenger notifications dispatched.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to report delay.";
    return { success: false, error: message };
  }
}

/**
 * Secure journey departure execution.
 * Checks vehicle safety, confirms actual boarded count,
 * prevents duplicate departures, and transitions status to 'in_transit'.
 */
export async function executeJourneyDepartureAction({
  journeyId,
  isAssisted = false,
  closureNotes,
}: {
  journeyId: string;
  isAssisted?: boolean;
  closureNotes?: string;
}): Promise<DriverActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required to depart journey." };
    }

    const { data, error } = await supabase.rpc("record_journey_departure_safe", {
      p_journey_id: journeyId,
      p_user_id: user.id,
      p_is_assisted: isAssisted,
      p_closure_notes: closureNotes?.trim() || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Departure blocked.",
      };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/boarding");
    revalidatePath("/boarding/boarding");
    revalidatePath("/boarding/assisted");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Bus marked as departed.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record departure.";
    return { success: false, error: message };
  }
}

/**
 * Secure journey arrival execution.
 * Enforces rule: Arrival can ONLY be recorded after departure ('in_transit' state).
 * Transitions status to 'completed' and records server arrival timestamp.
 */
export async function executeJourneyArrivalAction({
  journeyId,
  isAssisted = false,
  notes,
}: {
  journeyId: string;
  isAssisted?: boolean;
  notes?: string;
}): Promise<DriverActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required to record destination arrival." };
    }

    const { data, error } = await supabase.rpc("record_journey_arrival_safe", {
      p_journey_id: journeyId,
      p_user_id: user.id,
      p_is_assisted: isAssisted,
      p_notes: notes?.trim() || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return {
        success: false,
        error: (result?.error as string) || "Arrival recording failed.",
      };
    }

    revalidatePath("/driver");
    revalidatePath("/driver/journeys");
    revalidatePath("/boarding");
    revalidatePath("/boarding/assisted");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Journey successfully completed upon arrival.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record arrival.";
    return { success: false, error: message };
  }
}

/**
 * Reports operational incidents (Breakdown, Accident, Obstruction, Missed Pickup, Safety).
 * Can be logged directly by driver or assisted by representative.
 */
export async function reportDriverIncidentAction({
  journeyId,
  vehicleId,
  category,
  severity,
  description,
  isAssisted = false,
}: {
  journeyId: string | null;
  vehicleId: string | null;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  isAssisted?: boolean;
}): Promise<DriverActionResponse> {
  try {
    if (!description || description.trim().length < 10) {
      return { success: false, error: "Please enter at least 10 characters describing the incident." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    // Insert incident report
    const { error: incError } = await supabase.from("incident_reports").insert({
      journey_id: journeyId || null,
      vehicle_id: vehicleId || null,
      reported_by: user.id,
      category: category.trim(),
      severity,
      description: description.trim(),
      status: "reported",
    });

    if (incError) {
      return { success: false, error: incError.message };
    }

    // Log to journey_operational_logs if journey is provided
    if (journeyId) {
      await supabase.from("journey_operational_logs").insert({
        journey_id: journeyId,
        recorded_by_user_id: user.id,
        action_type: "INCIDENT_REPORTED",
        operation_mode: isAssisted ? "assisted" : "direct",
        details: {
          category,
          severity,
          description: description.trim(),
        },
      });
    }

    revalidatePath("/driver");
    revalidatePath("/boarding");
    revalidatePath("/boarding/assisted");

    return {
      success: true,
      message: "Incident reported and escalated to transport administration.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to submit incident report.";
    return { success: false, error: message };
  }
}

