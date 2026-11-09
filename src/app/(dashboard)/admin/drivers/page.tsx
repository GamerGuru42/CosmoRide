import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  DriversManagement,
  type DriverItem,
  type AvailableVehicleOption,
} from "@/components/admin/drivers-management";

export const metadata: Metadata = {
  title: "Driver Management — CosmoRide Admin",
  description: "Manage university driver assignments, Mode A smartphone access, and Mode B assisted operations.",
};

export const dynamic = "force-dynamic";

export default async function AdminDriversPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") redirect("/student");

  // Fetch drivers with vehicle and profile
  const { data: driversData } = await supabase
    .from("drivers")
    .select(`
      id,
      driver_reference,
      full_name,
      phone,
      license_number,
      license_expiry,
      status,
      has_app_access,
      notes,
      assigned_vehicle_id,
      profile_id,
      created_at,
      vehicle:vehicles(
        registration_number,
        name
      ),
      profile:profiles(
        full_name
      )
    `)
    .order("driver_reference", { ascending: true });

  const drivers: DriverItem[] = (driversData ?? []).map((d) => {
    const vehicle = Array.isArray(d.vehicle) ? d.vehicle[0] : d.vehicle;
    return {
      id: d.id,
      driverReference: d.driver_reference,
      fullName: d.full_name,
      phone: d.phone,
      licenseNumber: d.license_number,
      licenseExpiry: d.license_expiry,
      status: (d.status || "active") as DriverItem["status"],
      hasAppAccess: d.has_app_access,
      notes: d.notes,
      assignedVehicleId: d.assigned_vehicle_id,
      assignedVehiclePlate: vehicle?.registration_number || null,
      assignedVehicleName: vehicle?.name || null,
      profileId: d.profile_id,
      profileEmail: null,
      createdAt: d.created_at,
    };
  });

  // Fetch available vehicles for default vehicle dropdown
  const { data: vehiclesData } = await supabase
    .from("vehicles")
    .select("id, registration_number, name")
    .eq("is_active", true)
    .order("registration_number", { ascending: true });

  const availableVehicles: AvailableVehicleOption[] = (vehiclesData ?? []).map((v) => ({
    id: v.id,
    registrationNumber: v.registration_number,
    name: v.name,
  }));

  return (
    <div>
      <PageHeader
        title="Driver Management &amp; Assisted Operations"
        description="Roster of authorized drivers with dual support for direct smartphone app access (Mode A) and representative-assisted operations (Mode B)."
      />

      <DriversManagement
        initialDrivers={drivers}
        availableVehicles={availableVehicles}
      />
    </div>
  );
}
