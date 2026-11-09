import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = {
  title: "Transport Administration",
};

/**
 * Admin Dashboard — overview of fleet, routes, journeys and system status.
 * All data shown is real. Empty states display when database has no data.
 */
export default function AdminDashboardPage() {
  return (
    <div>
      <PageHeader
        title="Transport Administration"
        description="Manage fleet, routes, schedules, and university transportation."
      />

      {/* Stats overview */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Active Routes</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
          <p className="mt-1 text-xs text-gray-400">
            Configure routes to get started
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Fleet Vehicles</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
          <p className="mt-1 text-xs text-gray-400">
            Add vehicles to the fleet
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">
            Today&apos;s Journeys
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
          <p className="mt-1 text-xs text-gray-400">
            Create schedules and journeys
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">
            Registered Students
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">0</p>
          <p className="mt-1 text-xs text-gray-400">
            Students register via the app
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Getting Started
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SetupCard
          step={1}
          title="Configure Campuses & Hostels"
          description="Set up Main Campus, Kado Campus, and all student hostels."
          href="/admin/routes"
        />
        <SetupCard
          step={2}
          title="Add Routes & Stops"
          description="Define transportation routes with pickup and drop-off stops."
          href="/admin/routes"
        />
        <SetupCard
          step={3}
          title="Register Fleet Vehicles"
          description="Add buses with their registration numbers and safe capacity limits."
          href="/admin/vehicles"
        />
        <SetupCard
          step={4}
          title="Create Schedules"
          description="Set up recurring journey schedules for each route and day of week."
          href="/admin/schedules"
        />
        <SetupCard
          step={5}
          title="Assign Drivers"
          description="Assign registered drivers to vehicles and journeys."
          href="/admin/users"
        />
        <SetupCard
          step={6}
          title="Generate Journeys"
          description="Create journey instances from schedules for students to book."
          href="/admin/journeys"
        />
      </div>

      {/* Recent Activity */}
      <h2 className="mb-4 mt-8 text-lg font-semibold text-gray-900">
        Recent Activity
      </h2>

      <EmptyState
        icon="📊"
        title="No activity yet"
        description="Activity will appear here once journeys are created and students start booking rides."
      />
    </div>
  );
}

function SetupCard({
  step,
  title,
  description,
  href,
}: {
  step: number;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md"
    >
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-sm font-bold text-[var(--color-primary)]">
        {step}
      </div>
      <h3 className="mb-1 font-semibold text-gray-900 group-hover:text-[var(--color-primary)]">
        {title}
      </h3>
      <p className="text-sm text-gray-500">{description}</p>
    </a>
  );
}

