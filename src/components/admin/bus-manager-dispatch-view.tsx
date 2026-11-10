"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { formatTime, formatDate } from "@/lib/utils";
import {
  confirmBusArrivalAction,
  confirmDispatchAction,
} from "@/actions/boarding";
import {
  BusIcon,
  CheckCircleIcon,
  ClockIcon,
  AlertTriangleIcon,
} from "@/components/ui/icons";

export interface DispatchJourneyItem {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  latestPermittedDeparture?: string | null;
  actualDeparture: string | null;
  busArrivedAt: string | null;
  boardingOpenedAt: string | null;
  boardingClosedAt: string | null;
  departureAuthorisedAt: string | null;
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
  vehicleName: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverHasAppAccess: boolean;
  safeCapacity: number;
  seatedCapacity: number;
  standingCapacity: number;
  readinessStatus: "pending" | "passed" | "failed_unsafe";
  delayMinutes: number;
  delayReason: string | null;
  bookedCount: number;
  boardedCount: number;
  seatedBoarded: number;
  standingBoarded: number;
  isOverdue: boolean;
}

interface BusManagerDispatchViewProps {
  journeys: DispatchJourneyItem[];
  currentDate: string;
}

export function BusManagerDispatchView({
  journeys,
  currentDate,
}: BusManagerDispatchViewProps) {
  const [filterFleet, setFilterFleet] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Filter journeys
  const filteredJourneys = journeys.filter((j) => {
    if (filterFleet === "boys" && !j.transportGroupName.toLowerCase().includes("boy")) return false;
    if (filterFleet === "girls" && !j.transportGroupName.toLowerCase().includes("girl")) return false;

    if (statusFilter === "ready" && j.status !== "ready_to_depart") return false;
    if (statusFilter === "boarding" && j.status !== "boarding" && j.status !== "bus_arrived") return false;
    if (statusFilter === "scheduled" && j.status !== "scheduled") return false;
    if (statusFilter === "departed" && j.status !== "in_transit") return false;

    return true;
  });

  const readyForDispatchCount = journeys.filter((j) => j.status === "ready_to_depart").length;
  const inBoardingCount = journeys.filter((j) => j.status === "boarding" || j.status === "bus_arrived").length;
  const departedCount = journeys.filter((j) => j.status === "in_transit" || j.status === "completed").length;
  const overdueCount = journeys.filter((j) => j.isOverdue).length;

  function handleConfirmArrival(journeyId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await confirmBusArrivalAction(journeyId, "Bus arrival verified by Bus Manager");
      if (res.success) {
        setFeedback({ type: "success", text: res.message || "Bus arrival confirmed at terminal." });
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to confirm bus arrival." });
      }
    });
  }

  function handleConfirmDispatch(journeyId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await confirmDispatchAction(journeyId, "Rolling dispatch executed by Bus Manager");
      if (res.success) {
        setFeedback({ type: "success", text: res.message || "Journey rolling dispatch executed. Students notified." });
      } else {
        setFeedback({ type: "error", text: res.error || "Failed to record departure." });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Top Banner: Dispatch Command Header */}
      <div className="rounded-2xl bg-[#102D4A] p-6 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              BUS MANAGER DISPATCH CONSOLE
            </span>
            <span className="text-xs text-slate-300 font-mono">
              {formatDate(currentDate)}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Transport Dispatch &amp; Driver Coordination
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Coordinates drivers, tracks vehicle readiness, confirms bus arrival, and executes authorized dispatch for scheduled departures.
          </p>
        </div>

        {/* Action Shortcuts */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Link
            href="/admin/drivers"
            className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
          >
            <span>👨‍✈️</span>
            <span>Driver Roster</span>
          </Link>
          <Link
            href="/admin/vehicles"
            className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-colors"
          >
            <span>🚍</span>
            <span>Fleet Buses</span>
          </Link>
          <Link
            href="/admin/incidents"
            className="flex items-center gap-1.5 rounded-xl bg-rose-500/20 px-3.5 py-2.5 text-xs font-bold text-rose-200 hover:bg-rose-500/30 transition-colors"
          >
            <span>⚠️</span>
            <span>Incidents</span>
          </Link>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`rounded-xl p-3.5 text-xs font-semibold flex items-center justify-between border ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-rose-50 text-rose-900 border-rose-200"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs font-bold opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Operational Dispatch KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          onClick={() => setStatusFilter("ready")}
          className={`cursor-pointer rounded-xl border p-4 shadow-2xs transition-all ${
            statusFilter === "ready"
              ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
            <span>Awaiting Dispatch</span>
            <span>🚀</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-emerald-700 font-mono">
            {readyForDispatchCount}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Boarding complete &amp; authorised
          </p>
        </div>

        <div
          onClick={() => setStatusFilter("boarding")}
          className={`cursor-pointer rounded-xl border p-4 shadow-2xs transition-all ${
            statusFilter === "boarding"
              ? "border-amber-500 bg-amber-50/50 ring-2 ring-amber-500"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-amber-800">
            <span>Boarding in Progress</span>
            <span>⏳</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-amber-700 font-mono">
            {inBoardingCount}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Representative active at gate
          </p>
        </div>

        <div
          onClick={() => setStatusFilter("departed")}
          className={`cursor-pointer rounded-xl border p-4 shadow-2xs transition-all ${
            statusFilter === "departed"
              ? "border-blue-500 bg-blue-50/50 ring-2 ring-blue-500"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-bold text-[#102D4A]">
            <span>Departed Today</span>
            <span>🚌</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-[#102D4A] font-mono">
            {departedCount}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Dispatched into transit
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-[#D9534F]">
            <span>Overdue / Attention</span>
            <span>⚠️</span>
          </div>
          <p className="mt-2 text-2xl font-extrabold text-[#D9534F] font-mono">
            {overdueCount}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Past latest departure window
          </p>
        </div>
      </div>

      {/* Filter and Coordination Tabs */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-[#526B82] uppercase mr-1">Fleet:</span>
          <button
            onClick={() => setFilterFleet("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filterFleet === "all"
                ? "bg-[#102D4A] text-white"
                : "bg-slate-100 text-[#526B82] hover:bg-slate-200"
            }`}
          >
            All Fleets
          </button>
          <button
            onClick={() => setFilterFleet("boys")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filterFleet === "boys"
                ? "bg-[#102D4A] text-white"
                : "bg-slate-100 text-[#526B82] hover:bg-slate-200"
            }`}
          >
            Boys&apos; Fleet
          </button>
          <button
            onClick={() => setFilterFleet("girls")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filterFleet === "girls"
                ? "bg-[#102D4A] text-white"
                : "bg-slate-100 text-[#526B82] hover:bg-slate-200"
            }`}
          >
            Girls&apos; Fleet
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#526B82] uppercase mr-1">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#102D4A] focus:outline-none"
          >
            <option value="all">All Statuses ({journeys.length})</option>
            <option value="ready">Ready to Depart ({readyForDispatchCount})</option>
            <option value="boarding">In Boarding ({inBoardingCount})</option>
            <option value="scheduled">Scheduled</option>
            <option value="departed">Departed ({departedCount})</option>
          </select>
        </div>
      </div>

      {/* Journeys List for Bus Manager */}
      <div className="space-y-4">
        {filteredJourneys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-xs text-[#526B82]">
            No scheduled departures found matching current filter criteria.
          </div>
        ) : (
          filteredJourneys.map((j) => (
            <div
              key={j.id}
              className={`rounded-2xl border bg-white p-5 shadow-xs transition-all ${
                j.status === "ready_to_depart"
                  ? "border-emerald-400 ring-2 ring-emerald-400/30"
                  : j.isOverdue
                  ? "border-rose-300"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Journey & Route Header */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold uppercase text-[#102D4A] bg-slate-100 px-2.5 py-0.5 rounded">
                      {j.routeCode}
                    </span>
                    <span className="text-xs text-[#526B82] font-semibold">
                      {j.transportGroupName}
                    </span>
                    {j.status === "ready_to_depart" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                        READY FOR DISPATCH
                      </span>
                    )}
                    {j.isOverdue && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                        OVERDUE
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-extrabold text-[#102D4A]">
                    {j.routeName}
                  </h3>

                  <div className="flex items-center gap-4 text-xs text-[#526B82] flex-wrap">
                    <span>
                      Planned: <strong className="text-slate-900 font-mono">{formatTime(j.scheduledDeparture)}</strong>
                      {j.latestPermittedDeparture && (
                        <span className="text-[11px] text-[#526B82] ml-1">
                          (Window: {formatTime(j.latestPermittedDeparture)})
                        </span>
                      )}
                    </span>
                    <span>
                      Bus: <strong className="text-slate-900">{j.vehicleRegistration}</strong>
                      {j.vehicleName && <span className="ml-1 text-[#526B82]">({j.vehicleName})</span>}
                    </span>
                    <span>
                      Capacity: <strong className="text-slate-900">{j.safeCapacity} max</strong> (20 seated + 12 standing)
                    </span>
                  </div>
                </div>

                {/* Driver Coordination Card */}
                <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3 min-w-[240px] text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#102D4A]">
                      👨‍✈️ {j.driverName || "Driver Unassigned"}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        j.driverHasAppAccess
                          ? "bg-blue-100 text-blue-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {j.driverHasAppAccess ? "Mode A (App)" : "Mode B (Assisted)"}
                    </span>
                  </div>

                  <div className="text-[11px] text-[#526B82]">
                    Phone: <span className="font-mono text-slate-800">{j.driverPhone || "Not configured"}</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200">
                    <span>Safety Inspection:</span>
                    <span
                      className={`font-bold ${
                        j.readinessStatus === "passed"
                          ? "text-emerald-700"
                          : j.readinessStatus === "failed_unsafe"
                          ? "text-rose-700"
                          : "text-amber-700"
                      }`}
                    >
                      {j.readinessStatus === "passed"
                        ? "✓ Verified Safe"
                        : j.readinessStatus === "failed_unsafe"
                        ? "✕ Unsafe Flagged"
                        : "Pending Check"}
                    </span>
                  </div>
                </div>

                {/* Passenger Breakdown & Actions */}
                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
                  <div className="text-right text-xs">
                    <div className="font-bold text-[#102D4A]">
                      {j.boardedCount} / {j.safeCapacity || 32} Boarded
                    </div>
                    <div className="text-[11px] text-[#526B82]">
                      {j.seatedBoarded}/20 Seated • {j.standingBoarded}/{j.standingCapacity || 12} Standing
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {j.bookedCount} total reserved
                    </div>
                  </div>

                  {/* Operational Action Buttons */}
                  <div className="flex items-center gap-2">
                    {j.status === "scheduled" && (
                      <button
                        onClick={() => handleConfirmArrival(j.id)}
                        disabled={isPending}
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shadow-2xs flex items-center gap-1.5"
                      >
                        <BusIcon className="w-3.5 h-3.5" />
                        <span>Confirm Bus Arrival</span>
                      </button>
                    )}

                    {j.status === "ready_to_depart" && (
                      <button
                        onClick={() => handleConfirmDispatch(j.id)}
                        disabled={isPending}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-1.5"
                      >
                        <BusIcon className="w-4 h-4" />
                        <span>Confirm Rolling Dispatch</span>
                      </button>
                    )}

                    {j.status === "in_transit" && (
                      <span className="px-3 py-1.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl font-mono">
                        DEPARTED {j.actualDeparture ? formatTime(j.actualDeparture) : ""}
                      </span>
                    )}

                    <Link
                      href={`/admin/operations?journey=${j.id}`}
                      className="px-3 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
                    >
                      Telemetry →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

