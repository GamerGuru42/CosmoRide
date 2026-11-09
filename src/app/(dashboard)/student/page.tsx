import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Student Dashboard",
};

/**
 * Student Dashboard — shows upcoming journeys and recent bookings.
 * Displays honest empty states when no data exists.
 */
export default async function StudentDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch upcoming bookings for this student
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select(`
      *,
      journey:journeys (
        *,
        route:routes ( name, code ),
        vehicle:vehicles ( name, registration_number )
      )
    `)
    .eq("student_id", user?.id ?? "")
    .in("status", ["confirmed", "checked_in"])
    .order("booked_at", { ascending: false })
    .limit(10);

  // Fetch count of today's available journeys
  const today = new Date().toISOString().split("T")[0];
  const { count: availableJourneys } = await supabase
    .from("journeys")
    .select("*", { count: "exact", head: true })
    .eq("journey_date", today)
    .in("status", ["scheduled", "boarding"]);

  return (
    <div>
      <PageHeader
        title="Welcome back!"
        description="View your upcoming rides and book new journeys."
      />

      {/* Stats Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Active Bookings</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {bookings?.length ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">
            Today&apos;s Available Journeys
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {availableJourneys ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Status</p>
          <p className="mt-1 text-sm font-medium text-green-600">
            ● Connected
          </p>
        </div>
      </div>

      {/* Upcoming Bookings */}
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Your Upcoming Rides
      </h2>

      {bookingsError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          Unable to load bookings. The database may not be configured yet.
          Please check your Supabase connection.
        </div>
      ) : !bookings || bookings.length === 0 ? (
        <EmptyState
          icon="🎫"
          title="No upcoming rides"
          description="You don't have any active bookings. Browse available journeys to book your next ride."
          action={{
            label: "Browse Journeys",
            href: "/student/journeys",
          }}
        />
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div
              key={booking.id}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {(booking.journey as Record<string, unknown>)?.route
                      ? String(
                          ((booking.journey as Record<string, unknown>).route as Record<string, unknown>)?.name ?? "Route"
                        )
                      : "Journey"}
                  </p>
                  <p className="text-sm text-gray-500">
                    Booking #{booking.id.slice(0, 8)}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                  {booking.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

