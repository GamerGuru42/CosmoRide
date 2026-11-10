import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import {
  VehicleRotationsView,
  type RotationMovementItem,
  type EligibleJourneyItem,
  type VehicleOption,
  type DriverOption,
} from "@/components/admin/vehicle-rotations-view";

export const metadata: Metadata = {
  title: "Vehicle Rotations & Repositioning — CosmoRide",
  description: "Operations Controller console for authorizing electric bus rotation and deadhead ferry return to Main Campus.",
};

export const dynamic = "force-dynamic";

export default async function VehicleRotationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, admin_role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") redirect("/student");

  const todayStr = getTodayDateString();

  // 1. Fetch vehicle movements for today
  const { data: rawMovements } = await supabase
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
      vehicle:vehicles (
        id,
        registration_number,
        name
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
        full_name
      ),
      confirmer:profiles!vehicle_movements_confirmed_by_fkey (
        id,
        full_name
      )
    `)
    .order("initiated_at", { ascending: false });

  const movements: RotationMovementItem[] = (rawMovements || []).map((m) => {
    const v = Array.isArray(m.vehicle) ? m.vehicle[0] : m.vehicle;
    const sj = Array.isArray(m.source_journey) ? m.source_journey[0] : m.source_journey;
    const nj = Array.isArray(m.next_journey) ? m.next_journey[0] : m.next_journey;
    const sRoute = sj?.route ? (Array.isArray(sj.route) ? sj.route[0] : sj.route) : null;
    const nRoute = nj?.route ? (Array.isArray(nj.route) ? nj.route[0] : nj.route) : null;
    const d = Array.isArray(m.driver) ? m.driver[0] : m.driver;
    const init = Array.isArray(m.initiator) ? m.initiator[0] : m.initiator;
    const conf = Array.isArray(m.confirmer) ? m.confirmer[0] : m.confirmer;

    return {
      id: m.id,
      vehicleId: m.vehicle_id,
      vehicleReg: v?.registration_number || "UNKNOWN",
      vehicleName: v?.name || null,
      originName: m.origin_name,
      destinationName: m.destination_name,
      sourceJourneyId: m.source_journey_id,
      sourceRouteName: sRoute?.name || "Outbound Journey",
      sourceDeparture: sj?.scheduled_departure || "",
      nextJourneyId: m.next_journey_id,
      nextRouteName: nRoute?.name || null,
      nextDeparture: nj?.scheduled_departure || null,
      driverName: d?.full_name || null,
      status: m.status as RotationMovementItem["status"],
      initiatedAt: m.initiated_at,
      initiatedByName: init?.full_name || "Operations Controller",
      arrivedAt: m.arrived_at,
      confirmedByName: conf?.full_name || null,
      operationalReason: m.operational_reason,
      cancellationReason: m.cancellation_reason,
      notes: m.notes,
    };
  });

  // 2. Fetch outbound and destination journeys for today
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      status,
      vehicle_id,
      driver_record_id,
      is_rotated_vehicle,
      rotation_campus_return_confirmed_at,
      route:routes (
        id,
        name,
        code,
        transport_groups (
          id,
          name
        )
      ),
      vehicle:vehicles (
        id,
        registration_number
      ),
      driver:drivers (
        id,
        full_name
      )
    `)
    .eq("journey_date", todayStr)
    .order("scheduled_departure", { ascending: true });

  const mappedJourneys: EligibleJourneyItem[] = (journeysData || []).map((j) => {
    const route = Array.isArray(j.route) ? j.route[0] : j.route;
    const v = Array.isArray(j.vehicle) ? j.vehicle[0] : j.vehicle;
    const d = Array.isArray(j.driver) ? j.driver[0] : j.driver;
    const tg = route?.transport_groups;
    const tgName = Array.isArray(tg) ? tg[0]?.name : tg?.name;

    return {
      id: j.id,
      routeName: route?.name || "Route",
      routeCode: route?.code || "CODE",
      transportGroupName: tgName || "General",
      scheduledDeparture: j.scheduled_departure,
      status: j.status,
      vehicleId: j.vehicle_id,
      vehicleReg: v?.registration_number || null,
      driverId: j.driver_record_id,
      driverName: d?.full_name || null,
    };
  });

  // Outbound journeys eligible as source: departed, completed, or scheduled
  const outboundJourneys = mappedJourneys.filter((j) => j.status !== "cancelled");

  // Destination journeys eligible as target: scheduled journeys
  const destinationJourneys = mappedJourneys.filter(
    (j) => j.status === "scheduled" || j.status === "bus_arrived"
  );

  // 3. Fetch active fleet vehicles
  const { data: rawVehicles } = await supabase
    .from("vehicles")
    .select("id, registration_number, name, status, is_active")
    .order("registration_number", { ascending: true });

  const vehicles: VehicleOption[] = (rawVehicles || []).map((v) => ({
    id: v.id,
    registrationNumber: v.registration_number,
    name: v.name,
    status: v.status,
    isActive: v.is_active,
  }));

  // 4. Fetch drivers
  const { data: rawDrivers } = await supabase
    .from("drivers")
    .select("id, full_name, driver_reference")
    .eq("status", "active")
    .order("full_name", { ascending: true });

  const drivers: DriverOption[] = (rawDrivers || []).map((d) => ({
    id: d.id,
    fullName: d.full_name,
    driverReference: d.driver_reference,
  }));

  return (
    <div className="space-y-6">
      <VehicleRotationsView
        currentDate={todayStr}
        currentUser={{
          id: profile.id,
          fullName: profile.full_name,
          adminRole: profile.admin_role,
        }}
        movements={movements}
        outboundJourneys={outboundJourneys}
        destinationJourneys={destinationJourneys}
        vehicles={vehicles}
        drivers={drivers}
      />
    </div>
  );
}
