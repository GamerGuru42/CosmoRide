import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  VehiclesManagement,
  type VehicleRecord,
} from "@/components/admin/vehicles-management";

export const metadata: Metadata = {
  title: "Fleet & Vehicles — CosmoRide Admin",
  description: "University bus inventory, safe capacities, and vehicle maintenance status.",
};

export const dynamic = "force-dynamic";

export default async function AdminVehiclesPage() {
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

  const { data: vehiclesData } = await supabase
    .from("vehicles")
    .select(`
      id,
      registration_number,
      name,
      safe_capacity,
      vehicle_type,
      ownership_type,
      vehicle_reference,
      status,
      maintenance_notes,
      is_active,
      created_at
    `)
    .order("registration_number", { ascending: true });

  const vehicles: VehicleRecord[] = (vehiclesData ?? []).map((v) => ({
    id: v.id,
    registrationNumber: v.registration_number,
    name: v.name,
    safeCapacity: v.safe_capacity,
    vehicleType: v.vehicle_type,
    ownershipType: v.ownership_type || "university_owned",
    vehicleReference: v.vehicle_reference,
    status: (v.status || "available") as VehicleRecord["status"],
    maintenanceNotes: v.maintenance_notes,
    isActive: v.is_active,
    createdAt: v.created_at,
  }));

  return (
    <div>
      <PageHeader
        title="Fleet & Vehicle Inventory"
        description="Manage Cosmopolitan University bus assets, certified seating capacities, and maintenance schedules."
      />

      <VehiclesManagement initialVehicles={vehicles} />
    </div>
  );
}
