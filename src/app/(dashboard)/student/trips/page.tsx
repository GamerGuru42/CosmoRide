import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { JourneyStatus } from "@/lib/supabase/types";
import { StudentTripsView, type TripItem, type WaitlistItem } from "@/components/student/student-trips-view";

export const metadata: Metadata = {
  title: "My Trips & Boarding Passes | CosmoRide",
  description: "View and manage your active bus reservations and tickets",
};

export default async function StudentTripsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch student profile info
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, student_id")
    .eq("id", user.id)
    .single();

  if (!profile?.student_id || profile.student_id.trim() === "") {
    redirect("/register?reason=incomplete_profile");
  }

  const studentName = profile?.full_name || "Student";
  const studentId = profile?.student_id || null;

  // 1. Fetch all bookings for this student (join boarding_stop directly on bookings)
  const { data: rawBookings } = await supabase
    .from("bookings")
    .select(`
      id,
      ticket_token,
      status,
      passenger_category,
      booked_at,
      cancelled_at,
      checked_in_at,
      boarding_stop:stops ( name ),
      journey:journeys (
        id,
        scheduled_departure,
        status,
        delay_minutes,
        delay_reason,
        route:routes (
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
    .order("booked_at", { ascending: false });

  const upcomingTrips: TripItem[] = [];
  const completedTrips: TripItem[] = [];
  const cancelledTrips: TripItem[] = [];

  if (rawBookings && rawBookings.length > 0) {
    for (const b of rawBookings) {
      const j = (Array.isArray(b.journey) ? b.journey[0] : b.journey) as unknown as {
        id: string;
        scheduled_departure: string;
        status: JourneyStatus;
        delay_minutes: number;
        delay_reason: string | null;
        route: {
          name: string;
          code: string;
          route_stops?: { stop_order: number; stop?: { name: string } | null }[];
        } | null;
        vehicle: { name: string | null; registration_number: string } | null;
      } | null;

      if (!j) continue;

      const boardingStop = (Array.isArray(b.boarding_stop)
        ? b.boarding_stop[0]
        : b.boarding_stop) as unknown as { name: string } | null;

      const orderedStops = [...(j.route?.route_stops ?? [])].sort(
        (a, c) => a.stop_order - c.stop_order
      );
      const destinationName =
        orderedStops[orderedStops.length - 1]?.stop?.name ||
        j.route?.name ||
        "Destination Stop";

      const item: TripItem = {
        id: b.id,
        ticketToken: b.ticket_token,
        status: b.status as "confirmed" | "checked_in" | "no_show" | "cancelled",
        passengerCategory:
          (b as unknown as { passenger_category?: "seated" | "standing" }).passenger_category || "seated",
        bookedAt: b.booked_at,
        cancelledAt: b.cancelled_at,
        checkedInAt: b.checked_in_at,
        studentName,
        studentId,
        journey: {
          id: j.id,
          scheduledDeparture: j.scheduled_departure,
          status: j.status,
          delayMinutes: j.delay_minutes ?? 0,
          delayReason: j.delay_reason,
          destinationName,
          route: {
            name: j.route?.name || "Transit Route",
            code: j.route?.code || "CR",
          },
          vehicle: {
            name: j.vehicle?.name || null,
            registrationNumber: j.vehicle?.registration_number || "TBD",
          },
          boardingStop: {
            name: boardingStop?.name || "Designated Pickup Stop",
          },
        },
      };

      if (b.status === "cancelled" || j.status === "cancelled") {
        cancelledTrips.push(item);
      } else if (j.status === "completed" || b.status === "no_show") {
        completedTrips.push(item);
      } else {
        upcomingTrips.push(item);
      }
    }
  }

  upcomingTrips.sort(
    (a, b) =>
      new Date(a.journey.scheduledDeparture).getTime() -
      new Date(b.journey.scheduledDeparture).getTime()
  );

  // 2. Fetch waitlist items for this student (join boarding_stop directly on waitlists)
  const { data: rawWaitlist } = await supabase
    .from("waitlists")
    .select(`
      id,
      position,
      status,
      created_at,
      boarding_stop:stops ( name ),
      journey:journeys (
        id,
        scheduled_departure,
        status,
        route:routes ( name, code ),
        vehicle:vehicles ( name, registration_number )
      )
    `)
    .eq("student_id", user.id)
    .eq("status", "waiting")
    .order("created_at", { ascending: false });

  const waitlistItems: WaitlistItem[] = (rawWaitlist || []).map((w) => {
    const j = (Array.isArray(w.journey) ? w.journey[0] : w.journey) as unknown as {
      id: string;
      scheduled_departure: string;
      status: string;
      route: { name: string; code: string } | null;
      vehicle: { name: string | null; registration_number: string } | null;
    } | null;
    const boardingStop = (Array.isArray(w.boarding_stop)
      ? w.boarding_stop[0]
      : w.boarding_stop) as unknown as { name: string } | null;

    return {
      id: w.id,
      position: w.position,
      status: w.status,
      createdAt: w.created_at,
      journey: {
        id: j?.id || "",
        scheduledDeparture: j?.scheduled_departure || w.created_at,
        status: j?.status || "scheduled",
        route: {
          name: j?.route?.name || "Route",
          code: j?.route?.code || "CR",
        },
        vehicle: {
          name: j?.vehicle?.name || null,
          registrationNumber: j?.vehicle?.registration_number || "TBD",
        },
        boardingStop: {
          name: boardingStop?.name || "Designated Pickup Stop",
        },
      },
    };
  });

  return (
    <StudentTripsView
      upcomingTrips={upcomingTrips}
      completedTrips={completedTrips}
      cancelledTrips={cancelledTrips}
      waitlistItems={waitlistItems}
    />
  );
}

