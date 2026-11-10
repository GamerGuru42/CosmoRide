"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { formatTime, formatDate } from "@/lib/utils";
import { cancelJourneyAction } from "@/actions/admin";
import { StatusBadge } from "@/components/ui/status-badge";
import { BusIcon, AlertTriangleIcon } from "@/components/ui/icons";

export interface JourneyListItem {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  latestPermittedDeparture?: string | null;
  actualDeparture: string | null;
  actualArrival: string | null;
  status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
  proposedAllocation: number;
  safeCapacity: number;
  routeCode: string;
  routeName: string;
  transportGroupName: string;
  vehicleRegistration: string | null;
  vehicleName: string | null;
  driverName: string | null;
  driverReference: string | null;
  driverMode: "app" | "assisted" | "unassigned";
  bookedCount: number;
  seatedCount?: number;
  standingCount?: number;
  boardedCount: number;
  isDelayed: boolean;
  delayMinutes: number;
  cancellationReason: string | null;
}

interface JourneysManagementProps {
  initialDate: string;
  journeys: JourneyListItem[];
}

const JOURNEY_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: "Scheduled", color: "bg-blue-100 text-blue-800" },
  boarding: { label: "Boarding", color: "bg-amber-100 text-amber-800" },
  in_transit: { label: "In Transit", color: "bg-emerald-100 text-emerald-800" },
  completed: { label: "Completed", color: "bg-slate-100 text-slate-700" },
  cancelled: { label: "Cancelled", color: "bg-rose-100 text-rose-800" },
};

export function JourneysManagement({
  initialDate,
  journeys,
}: JourneysManagementProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [statusFilter, setStatusFilter] = useState("all");
  const [operationFilter, setOperationFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  // Cancel modal state
  const [cancellingJourney, setCancellingJourney] = useState<JourneyListItem | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);

  const filteredJourneys = journeys.filter((j) => {
    const matchesStatus = statusFilter === "all" || j.status === statusFilter;
    const matchesOperation =
      operationFilter === "all" ||
      j.transportGroupName.toLowerCase().includes(operationFilter.toLowerCase());
    return matchesStatus && matchesOperation;
  });

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    window.location.href = `/admin/journeys?date=${newDate}`;
  };

  const handleOpenCancel = (j: JourneyListItem) => {
    setCancellingJourney(j);
    setCancellationReason("");
    setCancelError(null);
    setCancelSuccess(null);
  };

  const handleConfirmCancel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingJourney) return;
    setCancelError(null);
    setCancelSuccess(null);

    startTransition(async () => {
      const res = await cancelJourneyAction(cancellingJourney.id, cancellationReason);
      if (!res.success) {
        setCancelError(res.error || "Failed to cancel journey.");
        return;
      }

      setCancelSuccess(res.message || "Journey cancelled successfully.");
      setTimeout(() => {
        setCancellingJourney(null);
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Date & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-[#102D4A]">Date:</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-[#102D4A] focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="boarding">Boarding</option>
            <option value="in_transit">In Transit</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={operationFilter}
            onChange={(e) => setOperationFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Fleet Operations</option>
            <option value="girls">Girls&apos; Fleet</option>
            <option value="boys">Boys&apos; Fleet</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/schedules"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#20A477] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1a8560] transition-colors"
          >
            <span>⚡</span> Bulk Generate
          </Link>
          <Link
            href="/admin/operations"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#102D4A] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a] transition-colors"
          >
            <span>📡</span> Live Monitor
          </Link>
        </div>
      </div>

      {/* Journeys Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#102D4A]">
              Daily Journeys Dispatch for {formatDate(selectedDate)} ({filteredJourneys.length})
            </h3>
            <p className="mt-0.5 text-xs text-[#526B82]">
              Real active and completed trips with passenger bookings and boarding records.
            </p>
          </div>
        </div>

        {filteredJourneys.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
              🚌
            </div>
            <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Journeys Found for this Date</h4>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
              No journeys are scheduled or recorded for {formatDate(selectedDate)}. Generate journeys from weekly schedule templates.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/schedules"
                className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c233a]"
              >
                Open Bulk Journey Generator →
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Departure</th>
                  <th className="px-4 py-3 font-semibold">Route &amp; Operation</th>
                  <th className="px-4 py-3 font-semibold">Assigned Bus</th>
                  <th className="px-4 py-3 font-semibold">Driver</th>
                  <th className="px-4 py-3 font-semibold text-center">Passengers / Capacity</th>
                  <th className="px-4 py-3 font-semibold text-center">Boarded</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredJourneys.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-bold text-[#102D4A]">
                      {formatTime(j.scheduledDeparture)}
                      {j.isDelayed && (
                        <span className="block text-[10px] font-sans font-semibold text-amber-700">
                          +{j.delayMinutes}m delay
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-[#102D4A]">{j.routeCode}</span>
                      <span className="block text-[11px] text-[#526B82] truncate max-w-[200px]">
                        {j.routeName}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">
                        {j.transportGroupName}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {j.vehicleRegistration ? (
                        <div>
                          <span className="font-semibold text-[#102D4A]">{j.vehicleRegistration}</span>
                          <span className="block text-[10px] text-[#526B82]">
                            {j.vehicleName || "Bus"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {j.driverName ? (
                        <div>
                          <span className="font-semibold text-[#102D4A]">{j.driverName}</span>
                          <span className="block text-[10px]">
                            {j.driverMode === "app" ? (
                              <span className="text-emerald-700 font-medium">📱 Mode A</span>
                            ) : (
                              <span className="text-amber-800 font-medium">🤝 Mode B</span>
                            )}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">No driver</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div
                        className={`font-semibold text-xs ${
                          j.bookedCount >= j.safeCapacity
                            ? "text-[#D9534F]"
                            : "text-[#102D4A]"
                        }`}
                      >
                        Total: {j.bookedCount}/{j.safeCapacity || 30}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Seated: {j.seatedCount ?? 0}/20 · Standing: {j.standingCount ?? 0}/10
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap font-bold text-emerald-700">
                      {j.boardedCount}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={j.status} statusConfig={JOURNEY_STATUS_CONFIG} />
                      {j.status === "cancelled" && j.cancellationReason && (
                        <span className="block text-[10px] text-rose-700 truncate max-w-[140px]">
                          {j.cancellationReason}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/operations?journey=${j.id}`}
                          className="rounded px-2 py-1 text-xs font-semibold text-[#102D4A] hover:bg-slate-100"
                        >
                          Monitor
                        </Link>
                        {j.status !== "completed" && j.status !== "cancelled" && (
                          <button
                            onClick={() => handleOpenCancel(j)}
                            className="rounded px-2 py-1 text-xs font-semibold text-[#D9534F] hover:bg-rose-50"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Cancel Journey */}
      {cancellingJourney && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <h3 className="text-base font-bold text-[#D9534F]">
                Cancel Journey Dispatch
              </h3>
            </div>
            <p className="mt-1 text-xs text-[#526B82]">
              Cancelling <strong>{cancellingJourney.routeCode} ({formatTime(cancellingJourney.scheduledDeparture)})</strong> will notify all {cancellingJourney.bookedCount} booked student(s) and release assigned capacity.
            </p>

            {cancelError && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-[#D9534F] border border-rose-200">
                {cancelError}
              </div>
            )}
            {cancelSuccess && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                {cancelSuccess}
              </div>
            )}

            <form onSubmit={handleConfirmCancel} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-900 mb-1">
                  Justification Reason * (Mandatory for university audit)
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Mechanical breakdown, road blockage between Main and Kado campus, adverse weather..."
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#D9534F] focus:outline-none"
                />
                <p className="mt-0.5 text-[10px] text-[#526B82]">Minimum 5 characters required.</p>
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCancellingJourney(null)}
                  disabled={isPending}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isPending || cancellationReason.trim().length < 5}
                  className="rounded-lg bg-[#D9534F] px-4 py-2 font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {isPending ? "Cancelling..." : "Confirm Journey Cancellation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

