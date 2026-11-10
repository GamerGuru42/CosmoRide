import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Verify officer role and group
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, assigned_transport_group_id")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "boarding_officer" && profile.role !== "admin")) {
    redirect("/student");
  }

  const todayStr = getTodayDateString();

  // Fetch active journeys (scheduled, bus_arrived, boarding, boarding_closed, ready_to_depart, in_transit) for today
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

  const journeys: ActiveBoardingJourney[] = (rawJourneys || []).map((j) => {
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
      routeCode: route?.code || "ROUTE",
      routeName: route?.name || "University Route",
      vehicleRegistration: vehicle?.registration_number || "UNASSIGNED",
      vehicleName: vehicle?.name || null,
      vehicleId: vehicle?.id || null,
      safeCapacity: vehicle?.safe_capacity ?? j.proposed_allocation ?? 0,
      seatedCapacity: vehicle?.seated_capacity ?? 20,
      standingCapacity: vehicle?.standing_capacity ?? 10,
      proposedAllocation: j.proposed_allocation,
      passengers,
    };
  });

  return (
    <div className="space-y-6">
      <BoardingScannerView journeys={journeys} />
    </div>
  );
}
