import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireOperationalStaffPageAccess } from "@/lib/admin-auth";
import { getTodayDateString } from "@/lib/utils";
import {
  PassengerManifestView,
  type ManifestJourney,
  type ManifestPassenger,
  type ManifestWaitlistEntry,
} from "@/components/boarding/passenger-manifest-view";

export const metadata: Metadata = {
  title: "Passenger Manifest — CosmoRide",
  description: "Official passenger manifests and boarding records for Cosmopolitan University bus operations.",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ journeyId?: string }>;
}

export default async function BoardingPassengersPage({ searchParams }: PageProps) {
  const { journeyId } = await searchParams;
  const { profile } = await requireOperationalStaffPageAccess("boarding_officer");
  const supabase = await createClient();

  const isUnassignedBoardingOfficer =
    profile.role === "boarding_officer" && !profile.assigned_transport_group_id;

  // Fetch transport group name
  let transportGroupName =
    profile.role === "admin"
      ? "All Transport Operations (Supervisory)"
      : "Unassigned Hostel Operation";
  if (profile.assigned_transport_group_id) {
    const { data: tg } = await supabase
      .from("transport_groups")
      .select("name")
      .eq("id", profile.assigned_transport_group_id)
      .single();

    if (tg) transportGroupName = tg.name;
  }

  const todayStr = getTodayDateString();

  // Query journeys for today
  let journeys: ManifestJourney[] = [];

  if (!isUnassignedBoardingOfficer) {
    let journeysQuery = supabase
      .from("journeys")
      .select(`
      id,
      journey_date,
      scheduled_departure,
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
        safe_capacity
      ),
      driver_record:drivers!journeys_driver_record_id_fkey (
        id,
        full_name
      ),
      driver:profiles!journeys_driver_id_fkey (
        id,
        full_name
      ),
      bookings (
        id,
        status,
        passenger_category,
        checked_in_at,
        ticket_token,
        booked_at,
        profiles!bookings_student_id_fkey (
          id,
          full_name,
          student_id
        ),
        pickup_stop:stops!bookings_boarding_stop_id_fkey (
          name
        ),
        boarding_records (
          boarding_method,
          scanned_at
        )
      ),
      waitlists (
        id,
        position,
        status,
        created_at,
        profiles!waitlists_student_id_fkey (
          id,
          full_name,
          student_id
        ),
        pickup_stop:stops!waitlists_boarding_stop_id_fkey (
          name
        )
      )
    `)
      .eq("journey_date", todayStr)
      .order("scheduled_departure", { ascending: true });

    // Enforce transport group isolation
    if (profile.role === "boarding_officer" && profile.assigned_transport_group_id) {
      journeysQuery = journeysQuery.eq("routes.transport_group_id", profile.assigned_transport_group_id);
    }

    const { data: rawJourneys } = await journeysQuery;

    journeys = (rawJourneys || []).map((j) => {
      const route = Array.isArray(j.routes) ? j.routes[0] : j.routes;
      const vehicle = Array.isArray(j.vehicles) ? j.vehicles[0] : j.vehicles;
      const driverRec = Array.isArray(j.driver_record) ? j.driver_record[0] : j.driver_record;
      const driver = Array.isArray(j.driver) ? j.driver[0] : j.driver;
      const driverName = driverRec?.full_name || driver?.full_name || "Assigned Driver";
      const rawBookings = j.bookings || [];
      const rawWaitlists = j.waitlists || [];

      const passengers: ManifestPassenger[] = rawBookings.map((b) => {
        const student = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles;
        const pickup = Array.isArray(b.pickup_stop) ? b.pickup_stop[0] : b.pickup_stop;
        const boardingRec = Array.isArray(b.boarding_records) ? b.boarding_records[0] : b.boarding_records;

        return {
          bookingId: b.id,
          studentId: student?.id || "",
          studentName: student?.full_name || "Student Passenger",
          studentMatric: student?.student_id || null,
          studentEmail: null,
          boardingStopName: pickup?.name || "Designated Stop",
          status: b.status as ManifestPassenger["status"],
          passengerCategory: (b.passenger_category as "seated" | "standing") || "seated",
          checkedInAt: b.checked_in_at,
          boardingMethod: boardingRec?.boarding_method || null,
          ticketToken: b.ticket_token,
          bookingCreatedAt: b.booked_at,
        };
      });

      const waitlist: ManifestWaitlistEntry[] = rawWaitlists.map((w) => {
        const student = Array.isArray(w.profiles) ? w.profiles[0] : w.profiles;
        const pickup = Array.isArray(w.pickup_stop) ? w.pickup_stop[0] : w.pickup_stop;

        return {
          id: w.id,
          studentId: student?.id || "",
          studentName: student?.full_name || "Student",
          studentMatric: student?.student_id || null,
          pickupStopName: pickup?.name || "Designated Stop",
          position: w.position,
          status: w.status,
          createdAt: w.created_at,
        };
      });

      return {
        id: j.id,
        journeyDate: j.journey_date,
        scheduledDeparture: j.scheduled_departure,
        status: j.status as ManifestJourney["status"],
        routeCode: route?.code || "ROUTE",
        routeName: route?.name || "University Route",
        vehicleRegistration: vehicle?.registration_number || "Unassigned",
        driverName,
        proposedAllocation: j.proposed_allocation,
        safeCapacity: vehicle?.safe_capacity ?? j.proposed_allocation ?? 0,
        passengers,
        waitlist,
      };
    });
  }

  return (
    <div className="space-y-6">
      {isUnassignedBoardingOfficer && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 space-y-1"
        >
          <p className="font-bold text-rose-950">
            Transport Group Assignment Required — Manifest Access Blocked
          </p>
          <p className="leading-relaxed">
            Your boarding officer account has no assigned hostel transport group. Passenger manifests are
            unavailable until a Super Administrator assigns your transport group.
          </p>
        </div>
      )}
      <PassengerManifestView
        journeys={journeys}
        initialJourneyId={journeyId}
        officerGroupName={transportGroupName}
      />
    </div>
  );
}
