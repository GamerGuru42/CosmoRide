"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { formatTime } from "@/lib/utils";
import {
  createScheduleTemplateAction,
  generateJourneysFromSchedulesAction,
} from "@/actions/admin";

export interface ScheduleItem {
  id: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  dayOfWeek: number;
  departureTime: string;
  direction: "outbound" | "inbound";
  proposedAllocation: number;
  isActive: boolean;
  notes: string | null;
}

export interface AvailableRouteOption {
  id: string;
  code: string;
  name: string;
}

interface SchedulesManagementProps {
  initialSchedules: ScheduleItem[];
  availableRoutes: AvailableRouteOption[];
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function SchedulesManagement({
  initialSchedules,
  availableRoutes,
}: SchedulesManagementProps) {
  const [schedules, setSchedules] = useState<ScheduleItem[]>(initialSchedules);
  const [dayFilter, setDayFilter] = useState<string>("all");
  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // New schedule form state
  const [routeId, setRouteId] = useState(availableRoutes[0]?.id || "");
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [departureTime, setDepartureTime] = useState("07:30");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [allocation, setAllocation] = useState(30);
  const [notes, setNotes] = useState("");

  // Generator form state
  const todayIso = new Date().toISOString().split("T")[0];
  const [genTargetDate, setGenTargetDate] = useState(todayIso);
  const [genRouteId, setGenRouteId] = useState("");
  const [generatorResult, setGeneratorResult] = useState<Record<string, unknown> | null>(null);

  const filteredSchedules = schedules.filter((s) => {
    const matchesDay = dayFilter === "all" || s.dayOfWeek === Number(dayFilter);
    const matchesRoute = routeFilter === "all" || s.routeId === routeFilter;
    return matchesDay && matchesRoute;
  });

  const handleOpenAdd = () => {
    setRouteId(availableRoutes[0]?.id || "");
    setDayOfWeek(1);
    setDepartureTime("07:30");
    setDirection("outbound");
    setAllocation(30);
    setNotes("");
    setActionError(null);
    setActionSuccess(null);
    setShowAddModal(true);
  };

  const handleOpenGenerator = () => {
    setGenTargetDate(todayIso);
    setGenRouteId("");
    setGeneratorResult(null);
    setActionError(null);
    setActionSuccess(null);
    setShowGeneratorModal(true);
  };

  const handleCreateSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    // Format departure time as HH:MM:00
    const formattedTime = departureTime.length === 5 ? `${departureTime}:00` : departureTime;

    startTransition(async () => {
      const res = await createScheduleTemplateAction({
        routeId,
        dayOfWeek: Number(dayOfWeek),
        departureTime: formattedTime,
        direction,
        proposedAllocation: Number(allocation),
        notes: notes || undefined,
      });

      if (!res.success) {
        setActionError(res.error || "Failed to create schedule template.");
        return;
      }

      setActionSuccess(res.message || "Schedule template created.");
      setTimeout(() => {
        setShowAddModal(false);
        window.location.reload();
      }, 1000);
    });
  };

  const handleRunGenerator = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);
    setGeneratorResult(null);

    startTransition(async () => {
      const res = await generateJourneysFromSchedulesAction(
        genTargetDate,
        genRouteId || undefined
      );

      if (!res.success) {
        setActionError(res.error || "Failed to generate journeys.");
        return;
      }

      setGeneratorResult(res.data as Record<string, unknown>);
      setActionSuccess(res.message || "Journeys generated successfully.");
    });
  };

  return (
    <div className="space-y-6">
      {/* Top action and filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <select
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Days of the Week</option>
            {DAY_NAMES.map((name, idx) => (
              <option key={idx} value={idx}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Routes</option>
            {availableRoutes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} - {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenGenerator}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#20A477] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1a8560] transition-colors"
          >
            <span>⚡</span> Bulk Journey Generator
          </button>
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#102D4A] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a] transition-colors"
          >
            <span>+</span> Add Recurring Schedule
          </button>
        </div>
      </div>

      {/* Schedules Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-[#102D4A]">
            Timetable Schedule Templates ({filteredSchedules.length})
          </h3>
          <p className="mt-0.5 text-xs text-[#526B82]">
            Permanent recurring departure templates used by the Bulk Journey Generator to produce daily student trips.
          </p>
        </div>

        {filteredSchedules.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
              📅
            </div>
            <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Schedules Found</h4>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
              {dayFilter !== "all" || routeFilter !== "all"
                ? "No schedule templates matched your filter selection."
                : "No recurring schedule templates have been created yet."}
            </p>
            <div className="mt-4">
              <button
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white"
              >
                + Add Schedule Template
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Operating Day</th>
                  <th className="px-4 py-3 font-semibold">Scheduled Departure</th>
                  <th className="px-4 py-3 font-semibold">Route Code &amp; Name</th>
                  <th className="px-4 py-3 font-semibold">Direction</th>
                  <th className="px-4 py-3 font-semibold text-center">Proposed Allocation</th>
                  <th className="px-4 py-3 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredSchedules.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-semibold text-slate-900">
                      {DAY_NAMES[s.dayOfWeek]}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-bold text-[#102D4A]">
                      {formatTime(s.departureTime)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-[#102D4A]">{s.routeCode}</span>
                      <span className="block text-[11px] text-[#526B82] truncate max-w-[240px]">
                        {s.routeName}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap capitalize text-slate-600">
                      {s.direction}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 font-mono font-bold text-blue-900 text-xs">
                        {s.proposedAllocation} seats
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#526B82]">
                      {s.notes || <span className="italic text-slate-400">Regular service</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Bulk Journey Generator */}
      {showGeneratorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚡</span>
              <h3 className="text-base font-bold text-[#102D4A]">
                Bulk Journey Generator
              </h3>
            </div>
            <p className="mt-1 text-xs text-[#526B82]">
              Automatically instantiate daily student bus journeys from active schedule templates for a target operating date.
            </p>

            {actionError && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-[#D9534F] border border-rose-200">
                {actionError}
              </div>
            )}
            {actionSuccess && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                {actionSuccess}
              </div>
            )}

            {generatorResult && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-950">
                <h4 className="font-bold text-emerald-900">Execution Summary:</h4>
                <ul className="mt-2 space-y-1 list-disc list-inside">
                  <li>
                    Generated Journeys: <strong>{String(generatorResult.generated_count || 0)}</strong>
                  </li>
                  <li>
                    Skipped (Existing / Duplicate): <strong>{String(generatorResult.skipped_count || 0)}</strong>
                  </li>
                  <li>
                    Target Date: <strong>{String(generatorResult.target_date || genTargetDate)}</strong>
                  </li>
                </ul>
                <div className="mt-3">
                  <Link
                    href={`/admin/journeys?date=${genTargetDate}`}
                    className="inline-flex items-center font-bold text-emerald-800 underline hover:text-emerald-950"
                  >
                    View Dispatched Journeys on Journeys Desk →
                  </Link>
                </div>
              </div>
            )}

            <form onSubmit={handleRunGenerator} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Operating Target Date *
                </label>
                <input
                  type="date"
                  required
                  value={genTargetDate}
                  onChange={(e) => setGenTargetDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
                <p className="mt-0.5 text-[10px] text-[#526B82]">
                  Templates matching this day of the week ({DAY_NAMES[new Date(genTargetDate).getDay()]}) will be instantiated.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Route Scope (Optional)
                </label>
                <select
                  value={genRouteId}
                  onChange={(e) => setGenRouteId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="">-- All Matching Routes for this Day --</option>
                  {availableRoutes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} - {r.name}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-[10px] text-[#526B82]">
                  Leave unselected to generate all routes simultaneously.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                <p className="font-semibold text-slate-800">Capacity &amp; Integrity Guarantee:</p>
                <p className="mt-1">
                  Journeys will automatically enforce vehicle safe seating capacities and avoid duplicate journey instances for the same route, date, and departure window.
                </p>
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowGeneratorModal(false)}
                  disabled={isPending}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-[#20A477] px-4 py-2 font-semibold text-white hover:bg-[#1a8560] disabled:opacity-50"
                >
                  {isPending ? "Generating..." : "Generate Journeys"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Schedule Template */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">Create Schedule Template</h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Set up a recurring weekly departure for university bus routes.
            </p>

            {actionError && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-[#D9534F] border border-rose-200">
                {actionError}
              </div>
            )}
            {actionSuccess && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                {actionSuccess}
              </div>
            )}

            <form onSubmit={handleCreateSchedule} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Route *</label>
                <select
                  value={routeId}
                  onChange={(e) => setRouteId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  {availableRoutes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} - {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Day of the Week *
                  </label>
                  <select
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    {DAY_NAMES.map((name, idx) => (
                      <option key={idx} value={idx}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Departure Time *
                  </label>
                  <input
                    type="time"
                    required
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Direction</label>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="outbound">Outbound</option>
                    <option value="inbound">Inbound</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Proposed Allocation *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    required
                    value={allocation}
                    onChange={(e) => setAllocation(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Girls' Fleet Bus 1, peak morning run..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={isPending}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-[#102D4A] px-4 py-2 font-semibold text-white hover:bg-[#0c233a] disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save Schedule Template"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
