import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  const studentName = profile?.full_name || "Student";
  const studentId = profile?.student_id || null;

  // 1. Fetch all bookings for this student
  const { data: rawBookings } = await supabase
    .from("bookings")
    .select(`
      id,
      ticket_token,
      status,
      booked_at,
      cancelled_at,
      checked_in_at,
      journey:journeys (
        id,
        scheduled_departure,
        status,
        delay_minutes,
        delay_reason,
        route:routes ( name, code ),
        vehicle:vehicles ( name, registration_number ),
        stops:stops ( name )
      )
    `)
    .eq("student_id", user.id)
    .order("booked_at", { ascending: false });

  const upcomingTrips: TripItem[] = [];
  const completedTrips: TripItem[] = [];
  const cancelledTrips: TripItem[] = [];

  if (rawBookings && rawBookings.length > 0) {
    for (const b of rawBookings) {
      const j = b.journey as unknown as {
        id: string;
        scheduled_departure: string;
        status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
        delay_minutes: number;
        delay_reason: string | null;
        route: { name: string; code: string };
        vehicle: { name: string | null; registration_number: string };
        stops?: { name: string };
      } | null;

      if (!j) continue;

      const item: TripItem = {
        id: b.id,
        ticketToken: b.ticket_token,
        status: b.status as "confirmed" | "checked_in" | "no_show" | "cancelled",
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
          route: {
            name: j.route?.name || "Corridor Route",
            code: j.route?.code || "CR",
          },
          vehicle: {
            name: j.vehicle?.name || null,
            registrationNumber: j.vehicle?.registration_number || "TBD",
          },
          boardingStop: {
            name: j.stops?.name || "Terminal Entrance",
          },
        },
      };

      if (b.status === "cancelled") {
        cancelledTrips.push(item);
      } else if (b.status === "checked_in" || j.status === "completed") {
        completedTrips.push(item);
      } else {
        upcomingTrips.push(item);
      }
    }
  }

  // 2. Fetch waitlist items for this student
  const { data: rawWaitlist } = await supabase
    .from("waitlists")
    .select(`
      id,
      position,
      status,
      created_at,
      journey:journeys (
        id,
        scheduled_departure,
        status,
        route:routes ( name, code ),
        vehicle:vehicles ( name, registration_number ),
        stops:stops ( name )
      )
    `)
    .eq("student_id", user.id)
    .eq("status", "waiting")
    .order("created_at", { ascending: false });

  const waitlistItems: WaitlistItem[] = (rawWaitlist || []).map((w) => {
    const j = w.journey as unknown as {
      id: string;
      scheduled_departure: string;
      status: string;
      route: { name: string; code: string };
      vehicle: { name: string | null; registration_number: string };
      stops?: { name: string };
    } | null;

    return {
      id: w.id,
      position: w.position,
      status: w.status,
      createdAt: w.created_at,
      journey: {
        id: j?.id || "",
        scheduledDeparture: j?.scheduled_departure || new Date().toISOString(),
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
          name: j?.stops?.name || "Stop",
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
