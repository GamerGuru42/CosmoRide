import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTodayDateString } from "@/lib/utils";
import { StudentHomeView, type AnnouncementItem } from "@/components/student/student-home-view";
import type { DepartureJourney } from "@/components/student/departure-board";

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
    .select("id, full_name, student_id, role")
    .eq("id", user.id)
    .single();

  const student = {
    id: user.id,
    fullName: profile?.full_name || "Student",
    studentId: profile?.student_id || null,
  };

  // 2. Fetch the student's next upcoming active booking
  const nowIso = new Date(Date.now() - 3600 * 1000).toISOString(); // within last hour or future
  const { data: rawBookings } = await supabase
    .from("bookings")
    .select(`
      id,
      ticket_token,
      status,
      passenger_category,
      booked_at,
      journey:journeys (
        id,
        scheduled_departure,
        status,
        delay_minutes,
        delay_reason,
        route:routes ( id, name, code ),
        vehicle:vehicles ( name, registration_number ),
        stops:stops ( name )
      )
    `)
    .eq("student_id", user.id)
    .in("status", ["confirmed", "checked_in"])
    .order("booked_at", { ascending: false })
    .limit(1);

  let nextBooking = null;
  if (rawBookings && rawBookings.length > 0) {
    const b = rawBookings[0];
    const j = b.journey as unknown as {
      id: string;
      scheduled_departure: string;
      status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
      delay_minutes: number;
      delay_reason: string | null;
      route: { id: string; name: string; code: string };
      vehicle: { name: string | null; registration_number: string };
      stops?: { name: string };
    } | null;

    if (j) {
      nextBooking = {
        id: b.id,
        ticketToken: b.ticket_token,
        status: b.status as "confirmed" | "checked_in",
        passengerCategory: (b as unknown as { passenger_category?: "seated" | "standing" }).passenger_category || "seated",
        bookedAt: b.booked_at,
        journey: {
          id: j.id,
          scheduledDeparture: j.scheduled_departure,
          status: j.status,
          delayMinutes: j.delay_minutes ?? 0,
          delayReason: j.delay_reason,
          route: {
            id: j.route.id,
            name: j.route.name,
            code: j.route.code,
          },
          vehicle: {
            name: j.vehicle.name,
            registrationNumber: j.vehicle.registration_number,
          },
          boardingStop: {
            name: j.stops?.name || "Terminal Entrance",
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
        safe_capacity
      )
    `)
    .gte("journey_date", today)
    .in("status", ["scheduled", "boarding", "in_transit"])
    .order("scheduled_departure", { ascending: true })
    .limit(8);

  // For each journey, fetch route stops, booking counts, and user's reservation status
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
        safe_capacity: number;
      } | null;

      // Count booked seats and category distribution
      const { count: bookedCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("journey_id", jd.id)
        .in("status", ["confirmed", "checked_in"]);

      const { count: seatedCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("journey_id", jd.id)
        .eq("passenger_category", "seated")
        .in("status", ["confirmed", "checked_in"]);

      const { count: standingCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("journey_id", jd.id)
        .eq("passenger_category", "standing")
        .in("status", ["confirmed", "checked_in"]);

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

      const origin = stopsList[0]?.name || "Main Terminal";
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
        safeCapacity: vehicleInfo?.safe_capacity ?? 30,
        bookedCount: bookedCount ?? 0,
        seatedCount: seatedCount ?? 0,
        standingCount: standingCount ?? 0,
        routeId: routeInfo?.id ?? "",
        routeName: routeInfo?.name ?? "Campus Route",
        routeCode: routeInfo?.code ?? "CR",
        originName: origin,
        destinationName: destination,
        transportGroupName: routeInfo?.transport_group?.name,
        genderGroup: routeInfo?.gender_group,
        vehicleRegistration: vehicleInfo?.registration_number ?? "TBD",
        vehicleName: vehicleInfo?.name ?? null,
        stops: stopsList,
        userBookingId: userBooking?.id ?? null,
        userPassengerCategory: (userBooking as unknown as { passenger_category?: "seated" | "standing" })?.passenger_category ?? null,
        userWaitlistPosition: userWaitlist?.position ?? null,
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
