import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireOperationalStaffPageAccess } from "@/lib/admin-auth";
import { calculateCapacityBreakdown, getTodayDateString } from "@/lib/utils";
import {
  BoardingScannerView,
  type ActiveBoardingJourney,
  type BoardingPassenger,
} from "@/components/boarding/boarding-scanner-view";

export const metadata: Metadata = {
  title: "Boarding Scanner & Gate Console — CosmoRide",
  description: "Live camera scanner and passenger validation gate for CosmoRide boarding officers.",
};

export const dynamic = "force-dynamic";

export default async function BoardingScannerPage() {
  const { profile } = await requireOperationalStaffPageAccess("boarding_officer");
  const supabase = await createClient();

  const isUnassignedBoardingOfficer =
    profile.role === "boarding_officer" && !profile.assigned_transport_group_id;

  const todayStr = getTodayDateString();

  // Fetch active journeys (scheduled, bus_arrived, boarding, boarding_closed, ready_to_depart, in_transit) for today
  let journeys: ActiveBoardingJourney[] = [];

  if (!isUnassignedBoardingOfficer) {
    let journeysQuery = supabase
      .from("journeys")
      .select(`
      id,
      journey_date,
      scheduled_departure,
      latest_permitted_departure,
      actual_departure,
      bus_arrived_at,
      boarding_opened_at,
      boarding_window_minutes,
      boarding_closed_at,
      departure_authorised_at,
      status,
      readiness_status,
      proposed_allocation,
      routes!inner (
        id,
        code,
        name,
        transport_group_id
      ),
      vehicles (
        id,
        registration_number,
        name,
        safe_capacity,
        seated_capacity,
        standing_capacity
      ),
      bookings (
        id,
        status,
        passenger_category,
        checked_in_at,
        ticket_token,
        profiles!bookings_student_id_fkey (
          id,
          full_name,
          student_id
        ),
        pickup_stop:stops!bookings_boarding_stop_id_fkey (
          name
        )
      )
    `)
      .eq("journey_date", todayStr)
      .in("status", ["scheduled", "bus_arrived", "boarding", "boarding_closed", "ready_to_depart", "in_transit"])
      .order("scheduled_departure", { ascending: true });

    // Enforce transport group isolation
    if (profile.role === "boarding_officer" && profile.assigned_transport_group_id) {
      journeysQuery = journeysQuery.eq("routes.transport_group_id", profile.assigned_transport_group_id);
    }

    const { data: rawJourneys } = await journeysQuery;

    journeys = (rawJourneys || []).map((j) => {
      const route = Array.isArray(j.routes) ? j.routes[0] : j.routes;
      const vehicle = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles;
      const rawBookings = j.bookings || [];

      const passengers: BoardingPassenger[] = rawBookings.map((b) => {
        const student = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles;
        const pickup = Array.isArray(b.pickup_stop) ? b.pickup_stop[0] : b.pickup_stop;

        return {
          bookingId: b.id,
          studentId: student?.id || "",
          studentName: student?.full_name || "Student Passenger",
          studentMatric: student?.student_id || null,
          boardingStopName: pickup?.name || "Designated Stop",
          status: b.status as BoardingPassenger["status"],
          passengerCategory: b.passenger_category as "seated" | "standing" | undefined,
          checkedInAt: b.checked_in_at,
          ticketToken: b.ticket_token,
        };
      });

      const capacityBreakdown = calculateCapacityBreakdown({
        proposedAllocation: j.proposed_allocation,
        safeCapacity: vehicle?.safe_capacity ?? null,
        seatedLimit: vehicle?.seated_capacity ?? null,
        standingLimit: vehicle?.standing_capacity ?? null,
      });

      return {
        id: j.id,
        journeyDate: j.journey_date,
        scheduledDeparture: j.scheduled_departure,
        latestPermittedDeparture: j.latest_permitted_departure,
        actualDeparture: j.actual_departure,
        busArrivedAt: j.bus_arrived_at,
        boardingOpenedAt: j.boarding_opened_at,
        boardingWindowMinutes: j.boarding_window_minutes,
        boardingClosedAt: j.boarding_closed_at,
        departureAuthorisedAt: j.departure_authorised_at,
        status: j.status as ActiveBoardingJourney["status"],
        readinessStatus: (j.readiness_status as ActiveBoardingJourney["readinessStatus"]) || "pending",
        routeCode: route?.code || "ROUTE",
        routeName: route?.name || "University Route",
        vehicleRegistration: vehicle?.registration_number || "UNASSIGNED",
        vehicleName: vehicle?.name || null,
        vehicleId: vehicle?.id || null,
        safeCapacity: capacityBreakdown.effectiveCapacity,
        seatedCapacity: capacityBreakdown.seatedLimit,
        standingCapacity: capacityBreakdown.standingLimit,
        proposedAllocation: j.proposed_allocation,
        passengers,
      };
    });
  }

  return (
    <div className="space-y-6">
      <BoardingScannerView
        journeys={journeys}
        unassignedTransportGroup={isUnassignedBoardingOfficer}
      />
    </div>
  );
}
