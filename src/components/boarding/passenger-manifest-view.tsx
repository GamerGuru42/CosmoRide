"use client";

import React, { useState, useTransition, useMemo } from "react";
import { formatTime, formatDate } from "@/lib/utils";
import {
  markPassengerNoShowAction,
  startBoardingSession,
} from "@/actions/boarding";
import { ManualBoardModal } from "./manual-board-modal";
import { BusIcon, CheckCircleIcon, UserIcon, AlertTriangleIcon } from "@/components/ui/icons";
import type { BoardingPassenger } from "./boarding-scanner-view";

export interface ManifestJourney {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
  routeCode: string;
  routeName: string;
  vehicleRegistration: string;
  driverName: string;
  proposedAllocation: number;
  safeCapacity: number;
  passengers: ManifestPassenger[];
  waitlist: ManifestWaitlistEntry[];
}

export interface ManifestPassenger {
  bookingId: string;
  studentId: string;
  studentName: string;
  studentMatric: string | null;
  studentEmail: string | null;
  boardingStopName: string;
  status: "confirmed" | "checked_in" | "no_show" | "cancelled";
  checkedInAt: string | null;
  boardingMethod: string | null;
  ticketToken: string | null;
  bookingCreatedAt: string;
}

export interface ManifestWaitlistEntry {
  id: string;
  studentId: string;
  studentName: string;
  studentMatric: string | null;
  pickupStopName: string;
  position: number;
  status: string;
  createdAt: string;
}

interface PassengerManifestViewProps {
  journeys: ManifestJourney[];
  initialJourneyId?: string;
  officerGroupName: string;
}

export function PassengerManifestView({
  journeys,
  initialJourneyId,
  officerGroupName,
}: PassengerManifestViewProps) {
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>(
    initialJourneyId || journeys[0]?.id || ""
  );

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "confirmed" | "checked_in" | "no_show" | "cancelled" | "waitlist"
  >("all");

  const [manualOverridePassenger, setManualOverridePassenger] = useState<BoardingPassenger | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const currentJourney = journeys.find((j) => j.id === selectedJourneyId) || journeys[0];

  const passengers = currentJourney?.passengers || [];
  const waitlist = currentJourney?.waitlist || [];

  // Filter passengers based on status and search query
  const filteredPassengers = useMemo(() => {
    return passengers.filter((p) => {
      // Status filter
      if (statusFilter !== "all" && statusFilter !== "waitlist" && p.status !== statusFilter) {
        return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = p.studentName.toLowerCase().includes(q);
        const matricMatch = p.studentMatric?.toLowerCase().includes(q);
        const stopMatch = p.boardingStopName.toLowerCase().includes(q);
        const tokenMatch = p.ticketToken?.toLowerCase().includes(q);
        return nameMatch || matricMatch || stopMatch || tokenMatch;
      }

      return true;
    });
  }, [passengers, statusFilter, searchQuery]);

  // Filter waitlist based on search query
  const filteredWaitlist = useMemo(() => {
    if (!searchQuery.trim()) return waitlist;
    const q = searchQuery.toLowerCase();
    return waitlist.filter((w) => {
      return (
        w.studentName.toLowerCase().includes(q) ||
        w.studentMatric?.toLowerCase().includes(q) ||
        w.pickupStopName.toLowerCase().includes(q)
      );
    });
  }, [waitlist, searchQuery]);

  const boardedCount = passengers.filter((p) => p.status === "checked_in").length;
  const pendingCount = passengers.filter((p) => p.status === "confirmed").length;
  const noShowCount = passengers.filter((p) => p.status === "no_show").length;
  const cancelledCount = passengers.filter((p) => p.status === "cancelled").length;
  const waitlistCount = waitlist.length;

  const capacityCeiling = currentJourney
    ? Math.min(currentJourney.proposedAllocation, currentJourney.safeCapacity)
    : 30;

  function handleMarkNoShow(bookingId: string, studentName: string) {
    if (confirm(`Mark ${studentName} as a No-Show for this departure?`)) {
      startTransition(async () => {
        const res = await markPassengerNoShowAction(bookingId);
        if (res.success) {
          setSuccessBanner(`Marked ${studentName} as No-Show.`);
          setTimeout(() => setSuccessBanner(null), 3000);
        } else {
          alert(res.error || "Failed to update status.");
        }
      });
    }
  }

  function handlePrint() {
    window.print();
  }

  if (!currentJourney) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <span className="text-4xl block mb-2">📋</span>
        <h3 className="text-base font-bold text-[#102D4A]">
          No Journeys Available
        </h3>
        <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
          There are no scheduled journeys assigned to your corridor. Manifests will appear when trips are scheduled.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Print-only Header (visible on paper/PDF export) */}
      <div className="hidden print:block mb-6 text-center border-b pb-4">
        <h1 className="text-xl font-bold text-black uppercase tracking-wider">
          Cosmopolitan University, Nigeria
        </h1>
        <h2 className="text-sm font-semibold text-gray-700">
          Official Passenger Manifest & Boarding Gate Record
        </h2>
        <div className="grid grid-cols-4 gap-2 text-xs text-gray-600 mt-3 text-left">
          <div>Route: {currentJourney.routeCode} - {currentJourney.routeName}</div>
          <div>Bus: {currentJourney.vehicleRegistration}</div>
          <div>Driver: {currentJourney.driverName}</div>
          <div>Departure: {formatTime(currentJourney.scheduledDeparture)}</div>
        </div>
      </div>

      {/* Screen Controls Header */}
      <div className="print:hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#102D4A]">
            Passenger Manifest & Roster
          </h2>
          <p className="text-xs text-[#526B82]">
            Corridor: <span className="font-semibold text-[#102D4A]">{officerGroupName}</span> • Real-time passenger boarding registry
          </p>
        </div>

        {/* Print / Export Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-[#102D4A] hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <span>🖨️</span>
            <span>Print Manifest</span>
          </button>
        </div>
      </div>

      {/* Journey Selector Bar */}
      <div className="print:hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1">
          <label
            htmlFor="manifest-journey-select"
            className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block mb-1"
          >
            SELECT SCHEDULED DEPARTURE
          </label>
          <select
            id="manifest-journey-select"
            value={selectedJourneyId}
            onChange={(e) => setSelectedJourneyId(e.target.value)}
            className="w-full md:w-auto text-sm font-bold bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
          >
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.routeCode} • {formatTime(j.scheduledDeparture)} — {j.vehicleRegistration} ({j.passengers.length} Booked)
              </option>
            ))}
          </select>
        </div>

        {/* Departure Summary Pill */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-[#526B82] block">
              Driver Assigned
            </span>
            <span className="text-xs font-bold text-[#102D4A]">
              {currentJourney.driverName}
            </span>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-[#526B82] block">
              Vehicle Capacity
            </span>
            <span className="text-xs font-bold text-[#20A477] font-mono">
              {boardedCount} / {capacityCeiling} Max
            </span>
          </div>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successBanner && (
        <div className="print:hidden rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <span>✓</span>
          <span>{successBanner}</span>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="print:hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Bar */}
          <div className="relative flex-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by student name, matric number, or pickup point..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-[#F6F8FA] border border-slate-300 rounded-xl text-[#102D4A] placeholder-slate-400 focus:outline-none focus:border-[#102D4A]"
            />
            <span className="absolute left-3 top-2.5 text-xs text-[#526B82]">
              🔍
            </span>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === "all"
                ? "bg-[#102D4A] text-white shadow-2xs"
                : "bg-slate-100 text-[#526B82] hover:bg-slate-200"
            }`}
          >
            All Manifest ({passengers.length})
          </button>

          <button
            onClick={() => setStatusFilter("checked_in")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === "checked_in"
                ? "bg-[#20A477] text-white shadow-2xs"
                : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            }`}
          >
            Boarded ({boardedCount})
          </button>

          <button
            onClick={() => setStatusFilter("confirmed")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === "confirmed"
                ? "bg-[#E5A13B] text-white shadow-2xs"
                : "bg-amber-50 text-amber-800 hover:bg-amber-100"
            }`}
          >
            Awaiting ({pendingCount})
          </button>

          <button
            onClick={() => setStatusFilter("no_show")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === "no_show"
                ? "bg-[#D9534F] text-white shadow-2xs"
                : "bg-rose-50 text-rose-800 hover:bg-rose-100"
            }`}
          >
            No-Show ({noShowCount})
          </button>

          <button
            onClick={() => setStatusFilter("cancelled")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === "cancelled"
                ? "bg-slate-600 text-white shadow-2xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Cancelled ({cancelledCount})
          </button>

          <button
            onClick={() => setStatusFilter("waitlist")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              statusFilter === "waitlist"
                ? "bg-purple-700 text-white shadow-2xs"
                : "bg-purple-50 text-purple-800 hover:bg-purple-100"
            }`}
          >
            Waiting List ({waitlistCount})
          </button>
        </div>
      </div>

      {/* Manifest Table */}
      {statusFilter === "waitlist" ? (
        /* Waiting List Roster */
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="p-4 border-b border-slate-200 bg-[#F6F8FA]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#102D4A]">
              Waiting List Queue for this Departure ({filteredWaitlist.length})
            </h3>
          </div>

          {filteredWaitlist.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#526B82]">
              No students on the waiting list for this departure.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredWaitlist.map((w) => (
                <div
                  key={w.id}
                  className="p-4 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-purple-800 font-bold font-mono text-[11px]">
                      #{w.position}
                    </span>
                    <div>
                      <p className="font-bold text-[#102D4A]">{w.studentName}</p>
                      {w.studentMatric && (
                        <p className="text-[11px] font-mono text-[#526B82]">
                          {w.studentMatric}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[11px] text-[#526B82] block">
                      Requested: {w.pickupStopName}
                    </span>
                    <span className="text-[10px] font-mono text-purple-700 font-semibold uppercase">
                      Status: {w.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Passenger Roster */
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F6F8FA] border-b border-slate-200 text-[10px] font-bold text-[#526B82] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">Student Name & ID</th>
                  <th className="py-3 px-4">Pickup Point</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Boarding Detail</th>
                  <th className="py-3 px-4 text-right print:hidden">Operations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredPassengers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-[#526B82]">
                      No passengers found matching the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredPassengers.map((p, index) => (
                    <tr key={p.bookingId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-[#526B82] text-[11px]">
                        {index + 1}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#102D4A]">
                          {p.studentName}
                        </div>
                        {p.studentMatric && (
                          <div className="text-[10px] font-mono text-[#526B82]">
                            {p.studentMatric}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium text-[#102D4A]">
                        {p.boardingStopName}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                            p.status === "checked_in"
                              ? "bg-emerald-100 text-[#20A477]"
                              : p.status === "no_show"
                              ? "bg-rose-100 text-[#D9534F]"
                              : p.status === "cancelled"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-amber-100 text-[#E5A13B]"
                          }`}
                        >
                          {p.status === "checked_in"
                            ? "BOARDED"
                            : p.status === "no_show"
                            ? "NO-SHOW"
                            : p.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[11px] text-[#526B82]">
                        {p.checkedInAt ? (
                          <div>
                            <span className="font-mono text-[#102D4A]">
                              {formatTime(p.checkedInAt)}
                            </span>
                            <span className="block text-[9px] uppercase text-slate-400">
                              {p.boardingMethod === "manual_override" ? "Manual Override" : "QR Scan"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right print:hidden">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.status === "confirmed" && (
                            <>
                              <button
                                onClick={() =>
                                  setManualOverridePassenger({
                                    bookingId: p.bookingId,
                                    studentId: p.studentId,
                                    studentName: p.studentName,
                                    studentMatric: p.studentMatric,
                                    boardingStopName: p.boardingStopName,
                                    status: p.status,
                                    checkedInAt: p.checkedInAt,
                                    ticketToken: p.ticketToken,
                                  })
                                }
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#102D4A] transition-colors"
                              >
                                Manual Board
                              </button>
                              <button
                                onClick={() => handleMarkNoShow(p.bookingId, p.studentName)}
                                className="px-2 py-1 text-[11px] font-semibold text-[#D9534F] hover:bg-rose-50 rounded-lg transition-colors"
                              >
                                No-Show
                              </button>
                            </>
                          )}
                          {p.status === "checked_in" && (
                            <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
                              <span>✓</span>
                              <span>Boarded</span>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Boarding Exception Modal */}
      <ManualBoardModal
        passenger={manualOverridePassenger}
        journeyId={currentJourney.id}
        isOpen={Boolean(manualOverridePassenger)}
        onClose={() => setManualOverridePassenger(null)}
        onSuccess={(name) => {
          setSuccessBanner(`Manual boarding exception recorded for ${name}.`);
          setTimeout(() => setSuccessBanner(null), 3500);
        }}
      />
    </div>
  );
}
