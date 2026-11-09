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

export interface LiveStopMilestone {
  id: string;
  stopName: string;
  updateType: "approaching" | "arrived" | "pickup_completed" | "departed";
  timestamp: string;
  notes: string | null;
  reportedByRole: string;
  isAssisted: boolean;
}

export interface LivePassenger {
  id: string;
  studentName: string;
  matricNumber: string | null;
  status: "confirmed" | "boarded" | "cancelled" | "no_show";
  boardingStopName: string;
  boardedAt: string | null;
}

export interface LiveJourneyOperation {
  id: string;
  scheduledDeparture: string;
  actualDeparture: string | null;
  actualArrival: string | null;
  status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
  routeCode: string;
  routeName: string;
  transportGroupName: string;
  vehiclePlate: string | null;
  vehicleName: string | null;
  safeCapacity: number;
  driverName: string | null;
  driverMode: "app" | "assisted" | "unassigned";
  bookedCount: number;
  boardedCount: number;
  safetyCheckStatus: "passed" | "failed_unsafe" | "pending";
  safetyCheckNotes: string | null;
  milestones: LiveStopMilestone[];
  isDelayed: boolean;
  delayMinutes: number;
  delayReason: string | null;
  passengers: LivePassenger[];
}

interface LiveOperationsViewProps {
  initialJourneyId?: string;
  journeys: LiveJourneyOperation[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: "Scheduled", color: "bg-blue-100 text-blue-800" },
  boarding: { label: "Boarding", color: "bg-amber-100 text-amber-800" },
  in_transit: { label: "In Transit", color: "bg-emerald-100 text-emerald-800" },
  completed: { label: "Completed", color: "bg-slate-100 text-slate-700" },
  cancelled: { label: "Cancelled", color: "bg-rose-100 text-rose-800" },
};

export function LiveOperationsView({
  initialJourneyId,
  journeys,
}: LiveOperationsViewProps) {
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>(
    initialJourneyId || journeys[0]?.id || ""
  );
  const [showManifestModal, setShowManifestModal] = useState(false);

  const selectedJourney =
    journeys.find((j) => j.id === selectedJourneyId) || journeys[0];

  return (
    <div className="space-y-6">
      {/* Top Banner: No Fake GPS Disclaimer */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs text-[#526B82]">
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
          <span className="font-semibold text-[#102D4A]">
            Milestone-Based Telemetry &amp; Operational Provenance:
          </span>
          <span>
            Transit updates are recorded at verified campus milestones by drivers (Mode A) or authorised boarding officers (Mode B).
          </span>
        </div>
      </div>

      {journeys.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
            📡
          </div>
          <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Active Trips Today</h4>
          <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
            There are no bus journeys currently operating or scheduled for today.
          </p>
          <div className="mt-4">
            <Link
              href="/admin/schedules"
              className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white"
            >
              Dispatch Timetable →
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Active Journeys List */}
          <div className="space-y-3 lg:col-span-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#526B82]">
              Live Journey Operations ({journeys.length})
            </h4>

            <div className="space-y-2">
              {journeys.map((j) => {
                const isSelected = j.id === selectedJourney?.id;
                return (
                  <div
                    key={j.id}
                    onClick={() => setSelectedJourneyId(j.id)}
                    className={`cursor-pointer rounded-xl border p-4 transition-all ${
                      isSelected
                        ? "border-[#102D4A] bg-[#102D4A]/5 shadow-sm ring-1 ring-[#102D4A]"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono font-bold text-sm text-[#102D4A]">
                          {formatTime(j.scheduledDeparture)}
                        </span>
                        <div className="font-semibold text-xs text-slate-900 mt-0.5">
                          {j.routeCode}
                        </div>
                      </div>
                      <StatusBadge status={j.status} statusConfig={STATUS_CONFIG} />
                    </div>

                    <div className="mt-2 text-[11px] text-[#526B82] truncate">
                      {j.routeName}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
                      <span className="font-medium text-slate-700">
                        {j.vehiclePlate || "No bus"} • {j.driverName || "No driver"}
                      </span>
                      <span className="font-bold text-[#102D4A]">
                        {j.boardedCount}/{j.bookedCount} boarded
                      </span>
                    </div>

                    {j.isDelayed && (
                      <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
                        ⚠️ +{j.delayMinutes} min delay: {j.delayReason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Detailed Journey Telemetry & Audit Stream */}
          <div className="lg:col-span-2">
            {selectedJourney && (
              <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                {/* Header info */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xl font-bold text-[#102D4A]">
                        {selectedJourney.routeCode}
                      </span>
                      <StatusBadge status={selectedJourney.status} statusConfig={STATUS_CONFIG} />
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 mt-1">
                      {selectedJourney.routeName}
                    </h3>
                    <p className="text-xs text-[#526B82]">
                      Corridor: {selectedJourney.transportGroupName} • Scheduled:{" "}
                      <span className="font-mono font-bold text-[#102D4A]">
                        {formatTime(selectedJourney.scheduledDeparture)}
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowManifestModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#102D4A] hover:bg-slate-50"
                    >
                      <span>👥</span> Passenger Manifest ({selectedJourney.bookedCount})
                    </button>
                  </div>
                </div>

                {/* Hardware & Driver Specs */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#526B82]">
                      Assigned Vehicle
                    </p>
                    <p className="mt-1 font-mono font-bold text-sm text-[#102D4A]">
                      {selectedJourney.vehiclePlate || "Not Assigned"}
                    </p>
                    <p className="text-[11px] text-[#526B82]">
                      Safe Cap: {selectedJourney.safeCapacity} seats
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#526B82]">
                      Assigned Driver
                    </p>
                    <p className="mt-1 font-bold text-sm text-[#102D4A]">
                      {selectedJourney.driverName || "Not Assigned"}
                    </p>
                    <p className="text-[11px] font-medium text-slate-600">
                      {selectedJourney.driverMode === "app" ? (
                        <span className="text-emerald-700">📱 Mode A (Direct App)</span>
                      ) : (
                        <span className="text-amber-800">🤝 Mode B (Assisted Ops)</span>
                      )}
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#526B82]">
                      Safety Readiness Gate
                    </p>
                    <div className="mt-1">
                      {selectedJourney.safetyCheckStatus === "passed" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                          <span>✓</span> Passed Pre-Trip Check
                        </span>
                      ) : selectedJourney.safetyCheckStatus === "failed_unsafe" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#D9534F]">
                          <span>⚠️</span> FAILED (Unsafe to Operate)
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-500">
                          Pending Inspection
                        </span>
                      )}
                    </div>
                    {selectedJourney.safetyCheckNotes && (
                      <p className="mt-0.5 text-[10px] text-slate-600 truncate">
                        {selectedJourney.safetyCheckNotes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Live Milestone Progress */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#526B82] mb-3">
                    Route Progress &amp; Telemetry Stream
                  </h4>

                  {selectedJourney.milestones.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-[#526B82]">
                      No transit milestones logged yet. Waiting for pre-departure checklist and trip commencement.
                    </div>
                  ) : (
                    <div className="relative border-l-2 border-slate-200 ml-4 space-y-4">
                      {selectedJourney.milestones.map((m) => (
                        <div key={m.id} className="relative pl-6">
                          <div className="absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-[#102D4A] bg-white flex items-center justify-center">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#102D4A]" />
                          </div>

                          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900 capitalize">
                                {m.updateType.replace("_", " ")} — {m.stopName}
                              </span>
                              <span className="font-mono text-[11px] text-[#526B82]">
                                {formatTime(m.timestamp)}
                              </span>
                            </div>

                            <div className="mt-1 flex items-center gap-2 text-[10px]">
                              <span className="font-semibold text-slate-600">
                                Logged by: {m.reportedByRole}
                              </span>
                              <span>•</span>
                              <span
                                className={`font-semibold ${
                                  m.isAssisted ? "text-amber-800" : "text-emerald-700"
                                }`}
                              >
                                {m.isAssisted
                                  ? "🤝 Boarding Officer Recorded (Assisted)"
                                  : "📱 Driver Reported (Smartphone)"}
                              </span>
                            </div>

                            {m.notes && (
                              <p className="mt-1 text-[11px] text-slate-700 italic">
                                &quot;{m.notes}&quot;
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manifest Modal */}
      {showManifestModal && selectedJourney && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#102D4A]">
                  Passenger Manifest: {selectedJourney.routeCode}
                </h3>
                <p className="text-xs text-[#526B82]">
                  {selectedJourney.bookedCount} Confirmed • {selectedJourney.boardedCount} Boarded • Max Safe Cap: {selectedJourney.safeCapacity}
                </p>
              </div>
              <button
                onClick={() => setShowManifestModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 max-h-96 overflow-y-auto">
              {selectedJourney.passengers.length === 0 ? (
                <p className="p-8 text-center text-xs text-[#526B82]">
                  No passenger bookings found for this trip.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Student Name</th>
                      <th className="px-3 py-2 font-semibold">Matric No</th>
                      <th className="px-3 py-2 font-semibold">Pickup Stop</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Boarded At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedJourney.passengers.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-semibold text-[#102D4A]">
                          {p.studentName}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600">
                          {p.matricNumber || "N/A"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{p.boardingStopName}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              p.status === "boarded"
                                ? "bg-emerald-100 text-emerald-800"
                                : p.status === "confirmed"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {p.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                          {p.boardedAt ? formatTime(p.boardedAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-5 flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowManifestModal(false)}
                className="rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c233a]"
              >
                Close Manifest
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
