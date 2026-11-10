"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatTime, formatDate } from "@/lib/utils";
import {
  BusIcon,
  CheckCircleIcon,
  ClockIcon,
  AlertTriangleIcon,
  UserIcon,
} from "@/components/ui/icons";

export interface OversightJourneyItem {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  latestPermittedDeparture?: string | null;
  actualDeparture: string | null;
  busArrivedAt: string | null;
  busArrivedBy: string | null;
  boardingOpenedAt: string | null;
  boardingOpenedBy: string | null;
  boardingClosedAt: string | null;
  boardingClosedBy: string | null;
  departureAuthorisedAt: string | null;
  departureAuthorisedBy: string | null;
  departureConfirmedBy: string | null;
  status:
    | "scheduled"
    | "bus_arrived"
    | "boarding"
    | "boarding_closed"
    | "ready_to_depart"
    | "in_transit"
    | "completed"
    | "cancelled";
  routeCode: string;
  routeName: string;
  transportGroupName: string;
  vehicleRegistration: string;
  driverName: string | null;
  bookedCount: number;
  boardedCount: number;
  seatedBoarded: number;
  standingBoarded: number;
  safeCapacity: number;
  isOverdue: boolean;
  delayMinutes: number;
  delayReason: string | null;
}

export interface OversightIncidentItem {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  status: string;
  createdAt: string;
  reportedByName: string;
}

export interface OversightAuditItem {
  id: string;
  action: string;
  userName: string;
  entityType: string;
  createdAt: string;
  details: Record<string, unknown>;
}

interface HostelManagerOversightViewProps {
  currentDate: string;
  hostelManagerName: string;
  journeys: OversightJourneyItem[];
  incidents: OversightIncidentItem[];
  recentAudits: OversightAuditItem[];
}

export function HostelManagerOversightView({
  currentDate,
  hostelManagerName,
  journeys,
  incidents,
  recentAudits,
}: HostelManagerOversightViewProps) {
  const [fleetFilter, setFleetFilter] = useState<"all" | "boys" | "girls">("all");

  const filteredJourneys = journeys.filter((j) => {
    if (fleetFilter === "boys") return j.transportGroupName.toLowerCase().includes("boy");
    if (fleetFilter === "girls") return j.transportGroupName.toLowerCase().includes("girl");
    return true;
  });

  // Cross-hostel aggregated metrics
  const totalDepartures = journeys.length;
  const boysDepartures = journeys.filter((j) => j.transportGroupName.toLowerCase().includes("boy")).length;
  const girlsDepartures = journeys.filter((j) => j.transportGroupName.toLowerCase().includes("girl")).length;

  const totalBoarded = journeys.reduce((sum, j) => sum + j.boardedCount, 0);
  const totalSeated = journeys.reduce((sum, j) => sum + j.seatedBoarded, 0);
  const totalStanding = journeys.reduce((sum, j) => sum + j.standingBoarded, 0);
  const totalBooked = journeys.reduce((sum, j) => sum + j.bookedCount, 0);

  const activeBoardingCount = journeys.filter((j) => j.status === "boarding").length;
  const readyForDispatchCount = journeys.filter((j) => j.status === "ready_to_depart").length;
  const inTransitCount = journeys.filter((j) => j.status === "in_transit").length;
  const completedCount = journeys.filter((j) => j.status === "completed").length;
  const overdueCount = journeys.filter((j) => j.isOverdue).length;

  return (
    <div className="space-y-6">
      {/* Top Banner: Supervisory Header */}
      <div className="rounded-2xl bg-[#102D4A] p-6 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/20 px-2.5 py-0.5 text-[11px] font-bold text-purple-300">
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              HOSTEL MANAGER SUPERVISORY CONTROL
            </span>
            <span className="text-xs text-slate-300 font-mono">
              {formatDate(currentDate)}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Hostel Operations &amp; Dispatch Oversight
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Overall supervisor: <span className="text-white font-semibold">{hostelManagerName}</span>. Supervises both Hostel Representatives and the Bus Manager across Boys&apos; and Girls&apos; transport operations.
          </p>
        </div>

        {/* Oversight Quick Links */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Link
            href="/admin/dispatch"
            className="flex items-center gap-1.5 rounded-xl bg-emerald-500/20 px-3.5 py-2.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 transition-colors"
          >
            <span>🚀</span>
            <span>Bus Manager Console</span>
          </Link>
          <Link
            href="/admin/operations"
            className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
          >
            <span>📡</span>
            <span>Live Telemetry</span>
          </Link>
          <Link
            href="/admin/audit"
            className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
          >
            <span>📜</span>
            <span>Audit Trail</span>
          </Link>
        </div>
      </div>

      {/* Supervisory Aggregated KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-[#526B82]">
            <span>Both Operations</span>
            <span>🚌</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-[#102D4A] font-mono">
            {totalDepartures}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            {boysDepartures} Boys&apos; • {girlsDepartures} Girls&apos;
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-700">
            <span>Verified Boarded</span>
            <span>✓</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-emerald-600 font-mono">
            {totalBoarded}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            {totalSeated} Seated • {totalStanding} Standing
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-amber-700">
            <span>Active Gates</span>
            <span>⏳</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-amber-600 font-mono">
            {activeBoardingCount + readyForDispatchCount}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            {activeBoardingCount} Boarding • {readyForDispatchCount} Ready
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-rose-700">
            <span>Exceptions &amp; Overdue</span>
            <span>⚠️</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-rose-600 font-mono">
            {overdueCount + incidents.filter((i) => i.status !== "resolved").length}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            {overdueCount} Overdue • {incidents.length} Incidents
          </p>
        </div>
      </div>

      {/* Fleet Filter Tabs */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#526B82] uppercase mr-1">Oversight Scope:</span>
          <button
            onClick={() => setFleetFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              fleetFilter === "all"
                ? "bg-[#102D4A] text-white"
                : "bg-slate-100 text-[#526B82] hover:bg-slate-200"
            }`}
          >
            All Operations ({totalDepartures})
          </button>
          <button
            onClick={() => setFleetFilter("boys")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              fleetFilter === "boys"
                ? "bg-[#102D4A] text-white"
                : "bg-slate-100 text-[#526B82] hover:bg-slate-200"
            }`}
          >
            Boys&apos; Operation ({boysDepartures})
          </button>
          <button
            onClick={() => setFleetFilter("girls")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              fleetFilter === "girls"
                ? "bg-[#102D4A] text-white"
                : "bg-slate-100 text-[#526B82] hover:bg-slate-200"
            }`}
          >
            Girls&apos; Operation ({girlsDepartures})
          </button>
        </div>

        <span className="text-xs text-[#526B82] font-mono">
          Showing {filteredJourneys.length} of {totalDepartures} services
        </span>
      </div>

      {/* Cross-Operation Journeys Oversight Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xs font-bold text-[#102D4A] uppercase tracking-wider">
            Daily Departures Audit &amp; State Provenance
          </h3>
          <span className="text-xs text-[#526B82]">
            {inTransitCount} In Transit • {completedCount} Completed
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] text-[#526B82] uppercase border-b border-slate-100">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Service / Route</th>
                <th className="py-2.5 px-4 font-semibold">Operation</th>
                <th className="py-2.5 px-4 font-semibold">Planned Time</th>
                <th className="py-2.5 px-4 font-semibold">Vehicle &amp; Driver</th>
                <th className="py-2.5 px-4 font-semibold">Status</th>
                <th className="py-2.5 px-4 font-semibold text-center">Boarded</th>
                <th className="py-2.5 px-4 font-semibold">Workflow Timestamps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredJourneys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                    No departures recorded for selected operation.
                  </td>
                </tr>
              ) : (
                filteredJourneys.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-bold text-[#102D4A]">
                      <span className="block font-mono text-[10px] text-[#526B82]">
                        {j.routeCode}
                      </span>
                      {j.routeName}
                    </td>

                    <td className="py-3 px-4 text-[#526B82]">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          j.transportGroupName.toLowerCase().includes("boy")
                            ? "bg-blue-50 text-blue-800"
                            : "bg-purple-50 text-purple-800"
                        }`}
                      >
                        {j.transportGroupName}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-mono">
                      <span className="font-bold text-slate-900">
                        {formatTime(j.scheduledDeparture)}
                      </span>
                      {j.isOverdue && (
                        <span className="block text-[10px] font-bold text-rose-600">
                          OVERDUE
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-[#526B82]">
                      <span className="font-bold text-slate-900 font-mono block">
                        {j.vehicleRegistration}
                      </span>
                      <span>👨‍✈️ {j.driverName || "Unassigned"}</span>
                    </td>

                    <td className="py-3 px-4">
                      {j.status === "scheduled" && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-bold">
                          Scheduled
                        </span>
                      )}
                      {j.status === "bus_arrived" && (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">
                          Bus Arrived
                        </span>
                      )}
                      {j.status === "boarding" && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold animate-pulse">
                          Boarding
                        </span>
                      )}
                      {j.status === "boarding_closed" && (
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-bold">
                          Gate Closed
                        </span>
                      )}
                      {j.status === "ready_to_depart" && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          Ready to Depart
                        </span>
                      )}
                      {j.status === "in_transit" && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                          In Transit
                        </span>
                      )}
                      {j.status === "completed" && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold">
                          Completed
                        </span>
                      )}
                      {j.status === "cancelled" && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
                          Cancelled
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center font-mono">
                      <span className="font-bold text-[#102D4A] block">
                        {j.boardedCount} / 30
                      </span>
                      <span className="text-[10px] text-[#526B82]">
                        {j.seatedBoarded}S • {j.standingBoarded}St
                      </span>
                    </td>

                    <td className="py-3 px-4 text-[11px] text-[#526B82] space-y-0.5 font-mono">
                      {j.busArrivedAt && (
                        <div>Arrived: {formatTime(j.busArrivedAt)}</div>
                      )}
                      {j.boardingOpenedAt && (
                        <div>Boarding: {formatTime(j.boardingOpenedAt)}</div>
                      )}
                      {j.departureAuthorisedAt && (
                        <div>Authorised: {formatTime(j.departureAuthorisedAt)}</div>
                      )}
                      {j.actualDeparture && (
                        <div className="font-bold text-emerald-700">
                          Departed: {formatTime(j.actualDeparture)}
                        </div>
                      )}
                      {!j.busArrivedAt && !j.boardingOpenedAt && (
                        <div className="text-slate-400 italic">No activity yet</div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two-Column Split: Incidents & Representative Audit Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Unresolved Incidents */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-sm font-bold text-[#102D4A] flex items-center gap-1.5">
              <span>⚠️</span>
              <span>Reported Operational Incidents</span>
            </h3>
            <Link
              href="/admin/incidents"
              className="text-xs font-semibold text-[#102D4A] hover:underline"
            >
              Manage ({incidents.length}) →
            </Link>
          </div>

          {incidents.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 italic">
              No active operational incidents reported.
            </div>
          ) : (
            <div className="space-y-2">
              {incidents.slice(0, 5).map((inc) => (
                <div
                  key={inc.id}
                  className="rounded-xl border border-slate-200 bg-[#F6F8FA] p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#102D4A]">{inc.category}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        inc.severity === "critical"
                          ? "bg-rose-100 text-rose-800"
                          : inc.severity === "high"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {inc.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-slate-700 line-clamp-2">{inc.description}</p>
                  <div className="text-[10px] text-[#526B82] flex items-center justify-between pt-1">
                    <span>By: {inc.reportedByName}</span>
                    <span className="font-mono">{formatTime(inc.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Representative & Dispatch Audit Logs */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-sm font-bold text-[#102D4A] flex items-center gap-1.5">
              <span>📜</span>
              <span>Recent Operational Actions (Audit)</span>
            </h3>
            <Link
              href="/admin/audit"
              className="text-xs font-semibold text-[#102D4A] hover:underline"
            >
              Full Log →
            </Link>
          </div>

          {recentAudits.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 italic">
              No recent audit actions logged.
            </div>
          ) : (
            <div className="space-y-2 font-mono text-xs">
              {recentAudits.slice(0, 5).map((aud) => (
                <div
                  key={aud.id}
                  className="rounded-xl border border-slate-200 bg-[#F6F8FA] p-3 space-y-1 text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#102D4A]">{aud.action}</span>
                    <span className="text-[#526B82]">{formatTime(aud.createdAt)}</span>
                  </div>
                  <div className="text-slate-600">
                    Actor: <strong className="text-slate-900">{aud.userName}</strong> ({aud.entityType})
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
