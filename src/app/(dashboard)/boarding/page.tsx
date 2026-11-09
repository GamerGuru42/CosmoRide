import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Boarding Officer Dashboard",
};

/**
 * Boarding Officer Dashboard — manage student check-ins for journeys.
 * Displays honest empty states when no data exists.
 */
export default function BoardingDashboardPage() {
  return (
    <div>
      <PageHeader
        title="Boarding Dashboard"
        description="Check in students and manage boarding for assigned journeys."
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
          <p className="text-sm font-medium text-gray-500">
            Students Checked In
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Pending</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
        </div>
      </div>

      {/* Active Boarding */}
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Active Boarding Sessions
      </h2>

      <EmptyState
        icon="📋"
        title="No active boarding"
        description="There are no journeys currently boarding. Active boarding sessions will appear here when journeys are in boarding status."
      />
    </div>
  );
}

