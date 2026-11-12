import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import { StudentHomeView, type AnnouncementItem } from "@/components/student/student-home-view";
import type { DepartureJourney } from "@/components/student/departure-board";
import type { JourneyStatus } from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "Student Hub | CosmoRide",
  description: "Official University Bus Booking and Mobility Platform",
};

export default async function StudentHomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // 1. Fetch user profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, student_id, role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login?error=profile_missing");
  }

  if (!profile.is_active) {
    redirect("/login?error=account_inactive");
  }

  if (profile.role !== "student") {
    if (profile.role === "admin") redirect("/admin");
    if (profile.role === "boarding_officer") redirect("/boarding");
    if (profile.role === "driver") redirect("/driver");
    redirect("/login");
  }

  if (!profile.student_id || profile.student_id.trim() === "") {
    redirect("/register?reason=incomplete_profile");
  }

  const student = {
    id: user.id,
    fullName: profile.full_name || "Student",
    studentId: profile.student_id || null,
  };

  // 2. Fetch the student's next upcoming active booking (sorted by earliest upcoming journey)
  const { data: rawBookings } = await supabase
    .from("bookings")
    .select(`
      id,
      ticket_token,
      status,
      passenger_category,
      booked_at,
      boarding_stop:stops ( name ),
      journey:journeys (
        id,
        scheduled_departure,
        status,
        delay_minutes,
        delay_reason,
        route:routes (
          id,
          name,
          code,
          route_stops (
            stop_order,
            stop:stops ( name )
          )
        ),
        vehicle:vehicles ( name, registration_number )
      )
    `)
    .eq("student_id", user.id)
    .in("status", ["confirmed", "checked_in"])
    .order("booked_at", { ascending: false })
    .limit(20);

  let nextBooking = null;
  if (rawBookings && rawBookings.length > 0) {
    type RawBookingJourney = {
      id: string;
      scheduled_departure: string;
      status: JourneyStatus;
      delay_minutes: number;
      delay_reason: string | null;
      route: {
        id: string;
        name: string;
        code: string;
        route_stops?: { stop_order: number; stop?: { name: string } | null }[];
      } | null;
      vehicle: { name: string | null; registration_number: string } | null;
    };

    const activeCandidates = rawBookings
      .map((b) => {
        const j = (Array.isArray(b.journey) ? b.journey[0] : b.journey) as unknown as RawBookingJourney | null;
        const stop = (Array.isArray(b.boarding_stop) ? b.boarding_stop[0] : b.boarding_stop) as unknown as { name: string } | null;
        return { b, j, stop };
      })
      .filter(
        (entry): entry is { b: (typeof rawBookings)[number]; j: RawBookingJourney; stop: { name: string } | null } =>
          Boolean(entry.j && entry.j.status !== "completed" && entry.j.status !== "cancelled")
      )
      .sort(
        (a, b) =>
          new Date(a.j.scheduled_departure).getTime() -
          new Date(b.j.scheduled_departure).getTime()
      );

    const picked = activeCandidates[0];
    if (picked) {
      const { b, j, stop } = picked;
      const orderedRouteStops = [...(j.route?.route_stops ?? [])].sort(
        (a, c) => a.stop_order - c.stop_order
      );
      const destinationName =
        orderedRouteStops[orderedRouteStops.length - 1]?.stop?.name ||
        j.route?.name ||
        "Destination Stop";

      nextBooking = {
        id: b.id,
        ticketToken: b.ticket_token,
        status: b.status as "confirmed" | "checked_in",
        passengerCategory:
          (b as unknown as { passenger_category?: "seated" | "standing" }).passenger_category || "seated",
        bookedAt: b.booked_at,
        journey: {
          id: j.id,
          scheduledDeparture: j.scheduled_departure,
          status: j.status,
          delayMinutes: j.delay_minutes ?? 0,
          delayReason: j.delay_reason,
          destinationName,
          route: {
            id: j.route?.id || "",
            name: j.route?.name || "Transit Route",
            code: j.route?.code || "CR",
          },
          vehicle: {
            name: j.vehicle?.name ?? null,
            registrationNumber: j.vehicle?.registration_number || "TBD",
          },
          boardingStop: {
            name: stop?.name || "Designated Pickup Stop",
          },
        },
      };
    }
  }

  // 3. Fetch count of active bookings and waitlist entries
  const { count: totalActiveBookings } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("student_id", user.id)
    .in("status", ["confirmed", "checked_in"]);

  const { count: waitlistCount } = await supabase
    .from("waitlists")
    .select("*", { count: "exact", head: true })
    .eq("student_id", user.id)
    .eq("status", "waiting");

  // 4. Fetch upcoming journeys for departure board preview (today and tomorrow)
  const today = getTodayDateString();
  const { data: journeysData } = await supabase
    .from("journeys")
    .select(`
      id,
      journey_date,
      scheduled_departure,
      actual_departure,
      status,
      delay_minutes,
      delay_reason,
      proposed_allocation,
      route:routes (
        id,
        name,
        code,
        gender_group,
        transport_group:transport_groups ( name )
      ),
      vehicle:vehicles (
        name,
        registration_number,
        safe_capacity,
        seated_capacity,
        standing_capacity
      )
    `)
    .gte("journey_date", today)
    .in("status", [
      "scheduled",
      "bus_arrived",
      "boarding",
      "boarding_closed",
      "ready_to_depart",
      "in_transit",
    ])
    .order("scheduled_departure", { ascending: true })
    .limit(8);

  type OccupancyEntry = {
    seated_count: number;
    standing_count: number;
    active_bookings_count: number;
    waitlist_count: number;
    seated_limit: number;
    standing_limit: number;
    effective_capacity: number;
    latest_stop_update: {
      event_type: string;
      stop_name: string;
      created_at: string;
    } | null;
  };

  const previewJourneyIds = (journeysData || []).map((j) => j.id);
  const { data: occResponse } = previewJourneyIds.length
    ? await supabase.rpc("get_student_departure_occupancy", {
        p_journey_ids: previewJourneyIds,
      })
    : { data: null };

  const occupancyMap =
    occResponse &&
    typeof occResponse === "object" &&
    !Array.isArray(occResponse) &&
    "occupancy" in occResponse
      ? ((occResponse as { occupancy?: Record<string, OccupancyEntry> }).occupancy ?? {})
      : {};

  // For each journey, attach non-PII occupancy, route stops, and current student's reservation status
  const upcomingDepartures: DepartureJourney[] = [];

  if (journeysData && journeysData.length > 0) {
    for (const jd of journeysData) {
      const routeInfo = jd.route as unknown as {
        id: string;
        name: string;
        code: string;
        gender_group?: string;
        transport_group?: { name: string } | null;
      } | null;

      const vehicleInfo = jd.vehicle as unknown as {
        name: string | null;
        registration_number: string;
        safe_capacity: number | null;
        seated_capacity: number | null;
        standing_capacity: number | null;
      } | null;

      const occ = occupancyMap[jd.id];

      // Check if current user has a booking
      const { data: userBooking } = await supabase
        .from("bookings")
        .select("id, passenger_category")
        .eq("journey_id", jd.id)
        .eq("student_id", user.id)
        .in("status", ["confirmed", "checked_in"])
        .maybeSingle();

      // Check if current user is on waitlist
      const { data: userWaitlist } = await supabase
        .from("waitlists")
        .select("position")
        .eq("journey_id", jd.id)
        .eq("student_id", user.id)
        .eq("status", "waiting")
        .maybeSingle();

      // Fetch route stops
      const { data: routeStops } = await supabase
        .from("route_stops")
        .select(`
          stop_order,
          estimated_minutes_from_start,
          stop:stops ( id, name )
        `)
        .eq("route_id", routeInfo?.id ?? "")
        .order("stop_order", { ascending: true });

      const stopsList = (routeStops || []).map((rs) => {
        const s = rs.stop as unknown as { id: string; name: string } | null;
        return {
          id: s?.id || rs.stop_order.toString(),
          name: s?.name || `Stop ${rs.stop_order}`,
          order: rs.stop_order,
          estimatedMinutesFromStart: rs.estimated_minutes_from_start,
        };
      });

      const origin = stopsList[0]?.name || "Departure Terminal";
      const destination = stopsList[stopsList.length - 1]?.name || "Destination";

      upcomingDepartures.push({
        id: jd.id,
        journeyDate: jd.journey_date,
        scheduledDeparture: jd.scheduled_departure,
        actualDeparture: jd.actual_departure,
        status: jd.status,
        delayMinutes: jd.delay_minutes ?? 0,
        delayReason: jd.delay_reason,
        proposedAllocation: jd.proposed_allocation,
        safeCapacity: vehicleInfo?.safe_capacity ?? 0,
        bookedCount: occ?.active_bookings_count ?? 0,
        seatedCount: occ?.seated_count ?? 0,
        standingCount: occ?.standing_count ?? 0,
        seatedLimit: occ?.seated_limit ?? vehicleInfo?.seated_capacity ?? undefined,
        standingLimit: occ?.standing_limit ?? vehicleInfo?.standing_capacity ?? undefined,
        effectiveCapacity: occ?.effective_capacity,
        routeId: routeInfo?.id ?? "",
        routeName: routeInfo?.name ?? "Campus Route",
        routeCode: routeInfo?.code ?? "CR",
        originName: origin,
        destinationName: destination,
        transportGroupName: routeInfo?.transport_group?.name,
        genderGroup: routeInfo?.gender_group,
        vehicleRegistration: vehicleInfo?.registration_number ?? "Unassigned",
        vehicleName: vehicleInfo?.name ?? null,
        stops: stopsList,
        userBookingId: userBooking?.id ?? null,
        userPassengerCategory: (userBooking as unknown as { passenger_category?: "seated" | "standing" })?.passenger_category ?? null,
        userWaitlistPosition: userWaitlist?.position ?? null,
        latestStopUpdate: occ?.latest_stop_update
          ? {
              eventType: occ.latest_stop_update.event_type,
              stopName: occ.latest_stop_update.stop_name,
              timestamp: occ.latest_stop_update.created_at,
            }
          : null,
      });
    }
  }

  // 5. Fetch active announcements
  const { data: rawAnnouncements } = await supabase
    .from("announcements")
    .select("id, title, content, created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(2);

  const announcements: AnnouncementItem[] = (rawAnnouncements || []).map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    createdAt: a.created_at,
  }));

  return (
    <StudentHomeView
      student={student}
      nextBooking={nextBooking}
      upcomingDepartures={upcomingDepartures}
      announcements={announcements}
      waitlistCount={waitlistCount ?? 0}
      totalActiveBookings={totalActiveBookings ?? 0}
    />
  );
}
