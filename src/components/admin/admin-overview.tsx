"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatTime, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  BusIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
} from "@/components/ui/icons";

export interface AdminJourneyOverview {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  actualDeparture: string | null;
  actualArrival: string | null;
  status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
  routeCode: string;
  routeName: string;
  transportGroupName: string;
  vehicleRegistration: string | null;
  vehicleName: string | null;
  safeCapacity: number;
  driverName: string | null;
  driverMode: "app" | "assisted" | "unassigned";
  bookedCount: number;
  boardedCount: number;
  isDelayed: boolean;
  delayMinutes: number;
}

export interface AdminFleetSummary {
  totalVehicles: number;
  availableVehicles: number;
  maintenanceVehicles: number;
  assignedToday: number;
}

export interface AdminIncidentSummary {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "reported" | "investigating" | "resolved" | "dismissed";
  description: string;
  createdAt: string;
  routeCode: string | null;
}

interface AdminOverviewProps {
  date: string;
  journeys: AdminJourneyOverview[];
  fleetSummary: AdminFleetSummary;
  openIncidents: AdminIncidentSummary[];
  registeredStudentsCount: number;
  totalDriversCount: number;
}

const JOURNEY_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: "Scheduled", color: "bg-blue-100 text-blue-800" },
  boarding: { label: "Boarding", color: "bg-amber-100 text-amber-800" },
  in_transit: { label: "In Transit", color: "bg-emerald-100 text-emerald-800" },
  completed: { label: "Completed", color: "bg-slate-100 text-slate-700" },
  cancelled: { label: "Cancelled", color: "bg-rose-100 text-rose-800" },
};

const INCIDENT_SEVERITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: "CRITICAL", color: "bg-red-600 text-white font-bold" },
  high: { label: "HIGH", color: "bg-rose-100 text-rose-800" },
  medium: { label: "MEDIUM", color: "bg-amber-100 text-amber-800" },
  low: { label: "LOW", color: "bg-slate-100 text-slate-700" },
};

export function AdminOverview({
  date,
  journeys,
  fleetSummary,
  openIncidents,
  registeredStudentsCount,
  totalDriversCount,
}: AdminOverviewProps) {
  const [corridorFilter, setCorridorFilter] = useState<string>("all");

  const filteredJourneys = journeys.filter((j) => {
    if (corridorFilter === "all") return true;
    return j.transportGroupName.toLowerCase().includes(corridorFilter.toLowerCase());
  });

  // Calculate real metrics
  const totalJourneys = journeys.length;
  const boardingCount = journeys.filter((j) => j.status === "boarding").length;
  const inTransitCount = journeys.filter((j) => j.status === "in_transit").length;
  const completedCount = journeys.filter((j) => j.status === "completed").length;
  const delayedCount = journeys.filter((j) => j.isDelayed).length;
  const cancelledCount = journeys.filter((j) => j.status === "cancelled").length;

  const totalBooked = journeys.reduce((sum, j) => sum + j.bookedCount, 0);
  const totalBoarded = journeys.reduce((sum, j) => sum + j.boardedCount, 0);
  const totalCapacity = journeys.reduce((sum, j) => sum + (j.safeCapacity || 0), 0);
  const seatUtilization = totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Critical Incidents Banner */}
      {openIncidents.filter((i) => i.severity === "critical" || i.severity === "high").length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangleIcon className="h-6 w-6 text-[#D9534F] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-bold text-rose-900">
                Action Required: {openIncidents.filter((i) => i.severity === "critical" || i.severity === "high").length} High-Priority Incident(s)
              </h3>
              <p className="mt-1 text-xs text-rose-700">
                Urgent service disruptions or vehicle issues require transport administrator resolution.
              </p>
              <div className="mt-2 flex gap-3">
                <Link
                  href="/admin/incidents"
                  className="inline-flex items-center text-xs font-semibold text-[#D9534F] underline hover:text-rose-900"
                >
                  Review Incident Desk →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Operational Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Today's Journeys */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
              Today&apos;s Journeys
            </p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700 text-sm">
              🚌
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-[#102D4A]">{totalJourneys}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#526B82]">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span>{inTransitCount} En Route</span>
            <span className="text-slate-300">•</span>
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            <span>{boardingCount} Boarding</span>
            <span className="text-slate-300">•</span>
            <span>{completedCount} Done</span>
          </div>
        </div>

        {/* Fleet Readiness */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
              Fleet Readiness
            </p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 text-sm">
              🚍
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-[#102D4A]">
            {fleetSummary.availableVehicles}{" "}
            <span className="text-base font-normal text-[#526B82]">/ {fleetSummary.totalVehicles}</span>
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#526B82]">
            <span>{fleetSummary.assignedToday} Assigned</span>
            <span className="text-slate-300">•</span>
            <span className={fleetSummary.maintenanceVehicles > 0 ? "font-semibold text-amber-700" : ""}>
              {fleetSummary.maintenanceVehicles} In Maint.
            </span>
          </div>
        </div>

        {/* Passenger Movement & Seat Utilization */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
              Booked Passengers
            </p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-50 text-purple-700 text-sm">
              👥
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-[#102D4A]">{totalBooked}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#526B82]">
            <span className="font-medium text-emerald-700">{totalBoarded} Boarded</span>
            <span className="text-slate-300">•</span>
            <span>{seatUtilization}% Seat Util.</span>
          </div>
        </div>

        {/* Operational Exceptions */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
              Delays & Incidents
            </p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-700 text-sm">
              ⚠️
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-[#102D4A]">
            {openIncidents.length + delayedCount}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#526B82]">
            <span className={delayedCount > 0 ? "font-medium text-amber-700" : ""}>
              {delayedCount} Delayed
            </span>
            <span className="text-slate-300">•</span>
            <span className={openIncidents.length > 0 ? "font-medium text-rose-700" : ""}>
              {openIncidents.length} Open Incidents
            </span>
          </div>
        </div>
      </div>

      {/* Operational Dispatch Controls & Quick Actions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[#102D4A]">Operational Command Actions</h2>
            <p className="text-xs text-[#526B82]">
              Direct shortcuts for daily journey generation, driver assignments, and corridor policies.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/schedules"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#102D4A] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a] transition-colors"
            >
              <span>⚡</span> Generate Journeys
            </Link>
            <Link
              href="/admin/vehicles"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#102D4A] hover:bg-slate-50 transition-colors"
            >
              <span>🚍</span> Add Fleet Bus
            </Link>
            <Link
              href="/admin/drivers"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#102D4A] hover:bg-slate-50 transition-colors"
            >
              <span>👨‍✈️</span> Register Driver
            </Link>
            <Link
              href="/admin/announcements"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#102D4A] hover:bg-slate-50 transition-colors"
            >
              <span>📢</span> Broadcast Notice
            </Link>
          </div>
        </div>
      </div>

      {/* Today's Active Operations Dispatch Board */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="text-base font-bold text-[#102D4A]">
                  Today&apos;s Active Dispatch Board
                </h3>
              </div>
              <p className="mt-0.5 text-xs text-[#526B82]">
                Operating date: <span className="font-semibold text-slate-800">{formatDate(date)}</span> • Showing {filteredJourneys.length} service(s)
              </p>
            </div>

            {/* Corridor Filter Tabs */}
            <div className="flex items-center rounded-lg bg-slate-100 p-1 text-xs">
              <button
                onClick={() => setCorridorFilter("all")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  corridorFilter === "all"
                    ? "bg-white text-[#102D4A] shadow-sm font-semibold"
                    : "text-[#526B82] hover:text-[#102D4A]"
                }`}
              >
                All Corridors
              </button>
              <button
                onClick={() => setCorridorFilter("girls")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  corridorFilter === "girls"
                    ? "bg-white text-[#102D4A] shadow-sm font-semibold"
                    : "text-[#526B82] hover:text-[#102D4A]"
                }`}
              >
                Girls&apos; Fleet
              </button>
              <button
                onClick={() => setCorridorFilter("boys")}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  corridorFilter === "boys"
                    ? "bg-white text-[#102D4A] shadow-sm font-semibold"
                    : "text-[#526B82] hover:text-[#102D4A]"
                }`}
              >
                Boys&apos; Fleet
              </button>
            </div>
          </div>
        </div>

        {filteredJourneys.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
              🚌
            </div>
            <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Journeys Scheduled for Today</h4>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
              There are no active or scheduled bus journeys recorded for {formatDate(date)}. Use the journey generator to dispatch today&apos;s timetable.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/schedules"
                className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a]"
              >
                Generate Journeys from Schedules →
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Departure</th>
                  <th className="px-4 py-3 font-semibold">Route & Corridor</th>
                  <th className="px-4 py-3 font-semibold">Assigned Vehicle</th>
                  <th className="px-4 py-3 font-semibold">Driver & Mode</th>
                  <th className="px-4 py-3 font-semibold text-center">Booked / Safe Cap</th>
                  <th className="px-4 py-3 font-semibold text-center">Boarded</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredJourneys.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-bold text-[#102D4A]">
                      {formatTime(j.scheduledDeparture)}
                      {j.isDelayed && (
                        <span className="block text-[10px] font-sans font-semibold text-amber-700">
                          +{j.delayMinutes} min delay
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#102D4A]">{j.routeCode}</div>
                      <div className="text-[11px] text-[#526B82] truncate max-w-[180px]">
                        {j.routeName}
                      </div>
                      <span className="mt-0.5 inline-block text-[10px] text-slate-500 font-medium">
                        {j.transportGroupName}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {j.vehicleRegistration ? (
                        <div>
                          <span className="font-semibold text-[#102D4A]">{j.vehicleRegistration}</span>
                          <span className="block text-[10px] text-[#526B82]">
                            {j.vehicleName || "Electric Bus"}
                          </span>
                        </div>
                      ) : (
                        <span className="italic text-slate-400">Not assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {j.driverName ? (
                        <div>
                          <span className="font-semibold text-[#102D4A]">{j.driverName}</span>
                          <span className="block text-[10px]">
                            {j.driverMode === "app" ? (
                              <span className="text-emerald-700 font-medium">📱 Mode A (App)</span>
                            ) : (
                              <span className="text-amber-800 font-medium">🤝 Mode B (Assisted)</span>
                            )}
                          </span>
                        </div>
                      ) : (
                        <span className="italic text-slate-400">No driver</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          j.bookedCount >= j.safeCapacity
                            ? "text-[#D9534F]"
                            : j.bookedCount > 0
                            ? "text-[#102D4A]"
                            : "text-slate-400"
                        }`}
                      >
                        {j.bookedCount}
                      </span>
                      <span className="text-slate-400"> / {j.safeCapacity}</span>
                      <div className="w-16 mx-auto bg-slate-100 rounded-full h-1 mt-1 overflow-hidden">
                        <div
                          className={`h-full ${
                            j.bookedCount >= j.safeCapacity ? "bg-[#D9534F]" : "bg-[#20A477]"
                          }`}
                          style={{
                            width: `${Math.min(100, (j.bookedCount / (j.safeCapacity || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="font-bold text-emerald-700">{j.boardedCount}</span>
                      {j.boardedCount > 0 && j.bookedCount > 0 && (
                        <span className="block text-[10px] text-slate-500">
                          {Math.round((j.boardedCount / j.bookedCount) * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={j.status} statusConfig={JOURNEY_STATUS_CONFIG} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/admin/operations?journey=${j.id}`}
                        className="inline-flex items-center text-xs font-semibold text-[#102D4A] hover:underline"
                      >
                        Monitor →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Institutional Architecture & Attributions Footnote */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs text-[#526B82] pt-4 border-t border-slate-200">
        <div>
          <span className="font-semibold text-[#102D4A]">CosmoRide Control Centre</span> • Cosmopolitan University Transport Operations
        </div>
        <div className="mt-1 sm:mt-0">
          Main Campus &amp; Kado Campus Fleet • Powered by NextGen Technologies
        </div>
      </div>
    </div>
  );
}

