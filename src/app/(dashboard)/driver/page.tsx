import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Driver Dashboard",
};

/**
 * Driver Dashboard — view assigned journeys and update journey status.
 * Displays honest empty states when no data exists.
 */
export default function DriverDashboardPage() {
  return (
    <div>
      <PageHeader
        title="Driver Dashboard"
        description="View your assigned journeys and update their status."
      />

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">
            Today&apos;s Journeys
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Completed Today</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Next Journey</p>
          <p className="mt-1 text-sm text-gray-400">No journeys scheduled</p>
        </div>
      </div>

      {/* Assigned Journeys */}
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Your Journeys Today
      </h2>

      <EmptyState
        icon="🚌"
        title="No journeys assigned"
        description="You don't have any journeys assigned for today. Check back later or contact the transport administrator."
      />
    </div>
  );
}

