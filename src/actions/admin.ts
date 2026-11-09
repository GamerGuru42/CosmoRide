"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

export interface AdminActionResponse<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

/**
 * Helper to verify caller is an authorized administrator.
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
    .select("id, role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    throw new Error("Permission denied: Only transport administrators can perform this action.");
  }

  return { supabase, user, profile };
}

// ============================================================
// 1. FLEET & VEHICLE MANAGEMENT
// ============================================================

export async function createVehicleAction({
  registrationNumber,
  name,
  safeCapacity,
  vehicleType = "electric_bus",
  ownershipType = "university_owned",
  vehicleReference,
  status = "available",
  maintenanceNotes,
}: {
  registrationNumber: string;
  name: string;
  safeCapacity: number;
  vehicleType?: string;
  ownershipType?: string;
  vehicleReference?: string;
  status?: string;
  maintenanceNotes?: string;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    if (!registrationNumber || registrationNumber.trim().length < 3) {
      return { success: false, error: "Valid vehicle registration number is required." };
    }
    if (safeCapacity < 1 || safeCapacity > 100) {
      return { success: false, error: "Approved safe capacity must be between 1 and 100 seats." };
    }

    const { data: vehicle, error } = await supabase
      .from("vehicles")
      .insert({
        registration_number: registrationNumber.trim().toUpperCase(),
        name: name.trim(),
        safe_capacity: safeCapacity,
        vehicle_type: vehicleType,
        ownership_type: ownershipType,
        vehicle_reference: vehicleReference?.trim() || null,
        status,
        maintenance_notes: maintenanceNotes?.trim() || null,
        is_active: status !== "retired" && status !== "unavailable",
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "VEHICLE_REGISTERED",
      entity_type: "vehicle",
      entity_id: vehicle.id,
      details: {
        registration_number: registrationNumber,
        safe_capacity: safeCapacity,
        status,
      },
    });

    revalidatePath("/admin/vehicles");
    revalidatePath("/admin");
    return { success: true, message: `Vehicle ${registrationNumber} registered successfully.` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to register vehicle.";
    return { success: false, error: message };
  }
}

export async function updateVehicleAction({
  id,
  registrationNumber,
  name,
  safeCapacity,
  vehicleType,
  ownershipType,
  vehicleReference,
  status,
  maintenanceNotes,
}: {
  id: string;
  registrationNumber?: string;
  name?: string;
  safeCapacity?: number;
  vehicleType?: string;
  ownershipType?: string;
  vehicleReference?: string;
  status?: string;
  maintenanceNotes?: string;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    const updateData: Database["public"]["Tables"]["vehicles"]["Update"] = {};
    if (registrationNumber) updateData.registration_number = registrationNumber.trim().toUpperCase();
    if (name) updateData.name = name.trim();
    if (safeCapacity !== undefined) {
      if (safeCapacity < 1) return { success: false, error: "Capacity must be positive." };
      updateData.safe_capacity = safeCapacity;
    }
    if (vehicleType) updateData.vehicle_type = vehicleType;
    if (ownershipType) updateData.ownership_type = ownershipType;
    if (vehicleReference !== undefined) updateData.vehicle_reference = vehicleReference?.trim() || null;
    if (status) {
      updateData.status = status;
      updateData.is_active = status !== "retired" && status !== "unavailable";
    }
    if (maintenanceNotes !== undefined) updateData.maintenance_notes = maintenanceNotes?.trim() || null;

    const { error } = await supabase.from("vehicles").update(updateData).eq("id", id);
    if (error) return { success: false, error: error.message };

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "VEHICLE_UPDATED",
      entity_type: "vehicle",
      entity_id: id,
      details: updateData as unknown as Json,
    });

    revalidatePath("/admin/vehicles");
    revalidatePath("/admin");
    return { success: true, message: "Vehicle details updated successfully." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update vehicle.";
    return { success: false, error: message };
  }
}

// ============================================================
// 2. DRIVER MANAGEMENT (MODE A & MODE B)
// ============================================================

export async function createDriverRecordAction({
  fullName,
  phone,
  driverReference,
  licenseNumber,
  licenseExpiry,
  assignedVehicleId,
  status = "active",
  hasAppAccess = false,
  notes,
}: {
  fullName: string;
  phone?: string;
  driverReference: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  assignedVehicleId?: string;
  status?: "active" | "on_leave" | "suspended" | "inactive";
  hasAppAccess?: boolean;
  notes?: string;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    if (!fullName || fullName.trim().length < 3) {
      return { success: false, error: "Full driver name is required." };
    }
    if (!driverReference || driverReference.trim().length < 3) {
      return { success: false, error: "Institutional driver reference (e.g. DRV-CU-01) is required." };
    }

    const { data: driver, error } = await supabase
      .from("drivers")
      .insert({
        full_name: fullName.trim(),
        phone: phone?.trim() || null,
        driver_reference: driverReference.trim().toUpperCase(),
        license_number: licenseNumber?.trim() || null,
        license_expiry: licenseExpiry || null,
        assigned_vehicle_id: assignedVehicleId || null,
        status,
        has_app_access: hasAppAccess,
        notes: notes?.trim() || null,
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "DRIVER_CREATED",
      entity_type: "driver",
      entity_id: driver.id,
      details: {
        driver_reference: driverReference,
        full_name: fullName,
        status,
        has_app_access: hasAppAccess,
      },
    });

    revalidatePath("/admin/drivers");
    revalidatePath("/admin/users");
    return { success: true, message: `Driver ${fullName} (${driverReference}) registered successfully.` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to register driver.";
    return { success: false, error: message };
  }
}

export async function updateDriverRecordAction({
  id,
  fullName,
  phone,
  driverReference,
  licenseNumber,
  licenseExpiry,
  assignedVehicleId,
  status,
  hasAppAccess,
  notes,
}: {
  id: string;
  fullName?: string;
  phone?: string;
  driverReference?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  assignedVehicleId?: string | null;
  status?: "active" | "on_leave" | "suspended" | "inactive";
  hasAppAccess?: boolean;
  notes?: string;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    const updateData: Database["public"]["Tables"]["drivers"]["Update"] = {};
    if (fullName) updateData.full_name = fullName.trim();
    if (phone !== undefined) updateData.phone = phone?.trim() || null;
    if (driverReference) updateData.driver_reference = driverReference.trim().toUpperCase();
    if (licenseNumber !== undefined) updateData.license_number = licenseNumber?.trim() || null;
    if (licenseExpiry !== undefined) updateData.license_expiry = licenseExpiry || null;
    if (assignedVehicleId !== undefined) updateData.assigned_vehicle_id = assignedVehicleId || null;
    if (status) updateData.status = status;
    if (hasAppAccess !== undefined) updateData.has_app_access = hasAppAccess;
    if (notes !== undefined) updateData.notes = notes?.trim() || null;

    const { error } = await supabase.from("drivers").update(updateData).eq("id", id);
    if (error) return { success: false, error: error.message };

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "DRIVER_UPDATED",
      entity_type: "driver",
      entity_id: id,
      details: updateData as unknown as Json,
    });

    revalidatePath("/admin/drivers");
    revalidatePath("/admin/users");
    return { success: true, message: "Driver details updated successfully." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update driver record.";
    return { success: false, error: message };
  }
}

// ============================================================
// 3. ROUTE AND STOP CONFIGURATION
// ============================================================

export async function createRouteAction({
  code,
  name,
  description,
  genderGroup = "mixed",
  transportGroupId,
}: {
  code: string;
  name: string;
  description: string;
  genderGroup?: "male" | "female" | "mixed";
  transportGroupId: string;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    if (!code || code.trim().length < 2) return { success: false, error: "Route code is required." };
    if (!name || name.trim().length < 3) return { success: false, error: "Route name is required." };

    const { data: route, error } = await supabase
      .from("routes")
      .insert({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim(),
        gender_group: genderGroup,
        transport_group_id: transportGroupId,
        is_active: true,
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "ROUTE_CREATED",
      entity_type: "route",
      entity_id: route.id,
      details: { code, name, transport_group_id: transportGroupId },
    });

    revalidatePath("/admin/routes");
    return { success: true, message: `Route ${code} (${name}) created successfully.` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create route.";
    return { success: false, error: message };
  }
}

export async function addStopToRouteAction({
  routeId,
  stopId,
  stopOrder,
  estimatedMinutesFromStart,
}: {
  routeId: string;
  stopId: string;
  stopOrder: number;
  estimatedMinutesFromStart: number;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    const { error } = await supabase.from("route_stops").upsert({
      route_id: routeId,
      stop_id: stopId,
      stop_order: stopOrder,
      estimated_minutes_from_start: Math.max(0, estimatedMinutesFromStart),
    });

    if (error) return { success: false, error: error.message };

    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "ROUTE_STOP_CONFIGURED",
      entity_type: "route",
      entity_id: routeId,
      details: { stop_id: stopId, stop_order: stopOrder, estimated_minutes: estimatedMinutesFromStart },
    });

    revalidatePath("/admin/routes");
    return { success: true, message: "Stop configured for route." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to configure stop.";
    return { success: false, error: message };
  }
}

export async function removeStopFromRouteAction(
  routeId: string,
  stopId: string
): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    const { error } = await supabase
      .from("route_stops")
      .delete()
      .eq("route_id", routeId)
      .eq("stop_id", stopId);

    if (error) return { success: false, error: error.message };

    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "ROUTE_STOP_REMOVED",
      entity_type: "route",
      entity_id: routeId,
      details: { stop_id: stopId },
    });

    revalidatePath("/admin/routes");
    return { success: true, message: "Stop removed from route." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to remove stop.";
    return { success: false, error: message };
  }
}

// ============================================================
// 4. SCHEDULES & BULK JOURNEY GENERATION
// ============================================================

export async function createScheduleTemplateAction({
  routeId,
  dayOfWeek,
  departureTime,
  direction = "outbound",
  proposedAllocation = 30,
  notes,
}: {
  routeId: string;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  departureTime: string; // HH:MI:SS
  direction?: "outbound" | "inbound";
  proposedAllocation?: number;
  notes?: string;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    const { data: sched, error } = await supabase
      .from("schedules")
      .insert({
        route_id: routeId,
        day_of_week: dayOfWeek,
        departure_time: departureTime,
        direction,
        proposed_allocation: proposedAllocation,
        notes: notes?.trim() || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "SCHEDULE_TEMPLATE_CREATED",
      entity_type: "schedule",
      entity_id: sched.id,
      details: { route_id: routeId, day_of_week: dayOfWeek, departure_time: departureTime },
    });

    revalidatePath("/admin/schedules");
    return { success: true, message: "Recurring schedule template created." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create schedule.";
    return { success: false, error: message };
  }
}

export async function generateJourneysFromSchedulesAction(
  targetDate: string,
  routeId?: string
): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    const { data, error } = await supabase.rpc("admin_generate_journeys_from_schedules", {
      p_admin_id: user.id,
      p_target_date: targetDate,
      p_route_id: routeId || null,
    });

    if (error) return { success: false, error: error.message };

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return { success: false, error: (result?.error as string) || "Failed to generate journeys." };
    }

    revalidatePath("/admin/journeys");
    revalidatePath("/admin");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Journeys generated successfully.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to run journey generator.";
    return { success: false, error: message };
  }
}

export async function cancelJourneyAction(
  journeyId: string,
  cancellationReason: string
): Promise<AdminActionResponse> {
  try {
    if (!cancellationReason || cancellationReason.trim().length < 5) {
      return { success: false, error: "Please enter a valid cancellation justification (min 5 characters)." };
    }

    const { supabase, user } = await verifyAdminCaller();

    const { data, error } = await supabase.rpc("admin_cancel_journey", {
      p_admin_id: user.id,
      p_journey_id: journeyId,
      p_cancellation_reason: cancellationReason.trim(),
    });

    if (error) return { success: false, error: error.message };

    const result = data as Record<string, unknown>;
    if (!result?.success) {
      return { success: false, error: (result?.error as string) || "Failed to cancel journey." };
    }

    revalidatePath("/admin/journeys");
    revalidatePath("/admin");
    revalidatePath("/student/departures");

    return {
      success: true,
      message: (result.message as string) || "Journey cancelled successfully.",
      data: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel journey.";
    return { success: false, error: message };
  }
}

// ============================================================
// 5. INCIDENT MANAGEMENT
// ============================================================

export async function updateIncidentStatusAction({
  incidentId,
  status,
  resolutionNotes,
}: {
  incidentId: string;
  status: "reported" | "investigating" | "resolved" | "dismissed";
  resolutionNotes: string;
}): Promise<AdminActionResponse> {
  try {
    if (!resolutionNotes || resolutionNotes.trim().length < 5) {
      return { success: false, error: "Resolution notes are required (min 5 characters)." };
    }

    const { supabase, user } = await verifyAdminCaller();

    const { data, error } = await supabase.rpc("admin_update_incident_status", {
      p_admin_id: user.id,
      p_incident_id: incidentId,
      p_status: status,
      p_resolution_notes: resolutionNotes.trim(),
    });

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin/incidents");
    revalidatePath("/admin");
    return { success: true, message: `Incident updated to ${status}.` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update incident.";
    return { success: false, error: message };
  }
}

// ============================================================
// 6. ANNOUNCEMENT MANAGEMENT
// ============================================================

export async function createAnnouncementAction({
  title,
  content,
  targetRole,
  routeId,
  transportGroupId,
  campusId,
  expiresAt,
}: {
  title: string;
  content: string;
  targetRole?: "student" | "boarding_officer" | "driver" | "admin" | null;
  routeId?: string | null;
  transportGroupId?: string | null;
  campusId?: string | null;
  expiresAt?: string | null;
}): Promise<AdminActionResponse> {
  try {
    if (!title || title.trim().length < 4) return { success: false, error: "Title must be at least 4 characters." };
    if (!content || content.trim().length < 10) return { success: false, error: "Content must be at least 10 characters." };

    const { supabase, user } = await verifyAdminCaller();

    const { data: announcement, error } = await supabase
      .from("announcements")
      .insert({
        title: title.trim(),
        content: content.trim(),
        target_role: targetRole || null,
        route_id: routeId || null,
        transport_group_id: transportGroupId || null,
        campus_id: campusId || null,
        created_by: user.id,
        is_active: true,
        expires_at: expiresAt || null,
      })
      .select()
      .single();

    if (error) return { success: false, error: error.message };

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "ANNOUNCEMENT_PUBLISHED",
      entity_type: "announcement",
      entity_id: announcement.id,
      details: { title, target_role: targetRole, transport_group_id: transportGroupId },
    });

    revalidatePath("/admin/announcements");
    revalidatePath("/student");
    revalidatePath("/student/notifications");
    return { success: true, message: "Announcement published successfully." };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to publish announcement.";
    return { success: false, error: message };
  }
}

// ============================================================
// 7. BOOKING POLICIES / SYSTEM SETTINGS
// ============================================================

export async function updateSystemSettingAction(
  key: string,
  value: Json,
  description?: string
): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    const { data, error } = await supabase.rpc("admin_update_system_setting", {
      p_admin_id: user.id,
      p_key: key,
      p_value: value,
      p_description: description || null,
    });

    if (error) return { success: false, error: error.message };

    revalidatePath("/admin/settings");
    revalidatePath("/admin");
    return { success: true, message: `Policy setting ${key} updated successfully.` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update setting.";
    return { success: false, error: message };
  }
}

// ============================================================
// 8. USER ROSTER & ROLE ASSIGNMENTS
// ============================================================

export async function updateUserRoleAndCorridorAction({
  userId,
  role,
  assignedTransportGroupId,
  hostelId,
}: {
  userId: string;
  role: "student" | "boarding_officer" | "driver" | "admin";
  assignedTransportGroupId?: string | null;
  hostelId?: string | null;
}): Promise<AdminActionResponse> {
  try {
    const { supabase, user } = await verifyAdminCaller();

    // Check target user
    const { data: targetUser, error: fetchErr } = await supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", userId)
      .single();

    if (fetchErr || !targetUser) return { success: false, error: "Target user not found." };

    const { error: updateErr } = await supabase
      .from("profiles")
      .update({
        role,
        assigned_transport_group_id: assignedTransportGroupId || null,
        hostel_id: hostelId || null,
      })
      .eq("id", userId);

    if (updateErr) return { success: false, error: updateErr.message };

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "USER_ROLE_ASSIGNED",
      entity_type: "profile",
      entity_id: userId,
      details: {
        previous_role: targetUser.role,
        new_role: role,
        transport_group: assignedTransportGroupId,
      },
    });

    revalidatePath("/admin/users");
    return { success: true, message: `Updated ${targetUser.full_name} to role ${role}.` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update user role.";
    return { success: false, error: message };
  }
}
