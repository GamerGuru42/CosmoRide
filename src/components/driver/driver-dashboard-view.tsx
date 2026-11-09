"use client";

import React, { useState, useTransition } from "react";
import { formatTime, formatDate } from "@/lib/utils";
import {
  executeJourneyDepartureAction,
  executeJourneyArrivalAction,
} from "@/actions/driver";
import { startBoardingSession } from "@/actions/boarding";
import { BusIcon, CheckCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";
import { ReadinessModal } from "./readiness-modal";
import { DelayModal } from "./delay-modal";
import { StopMilestones, type RouteStopItem } from "./stop-milestones";
import { IncidentModal } from "@/components/boarding/incident-modal";

export interface DriverJourneyData {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  actualDeparture: string | null;
  actualArrival: string | null;
  status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
  routeCode: string;
  routeName: string;
  vehicleRegistration: string;
  vehicleName: string | null;
  vehicleId: string;
  safeCapacity: number;
  proposedAllocation: number;
  readinessStatus: "pending" | "passed" | "failed_unsafe";
  delayMinutes: number;
  delayReason: string | null;
  boardedCount: number;
  confirmedCount: number;
  stops: RouteStopItem[];
}

interface DriverDashboardViewProps {
  driverName: string;
  driverReference: string;
  driverPhone: string | null;
  journeys: DriverJourneyData[];
}

export function DriverDashboardView({
  driverName,
  driverReference,
  driverPhone,
  journeys,
}: DriverDashboardViewProps) {
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>(
    journeys[0]?.id || ""
  );

  // Modals state
  const [readinessModalOpen, setReadinessModalOpen] = useState<boolean>(false);
  const [delayModalOpen, setDelayModalOpen] = useState<boolean>(false);
  const [incidentModalOpen, setIncidentModalOpen] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<"controls" | "stops">("controls");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  const currentJourney = journeys.find((j) => j.id === selectedJourneyId) || journeys[0];

  function handleStartBoarding() {
    if (!currentJourney) return;
    setActionError(null);
    startTransition(async () => {
      const res = await startBoardingSession(currentJourney.id);
      if (res.success) {
        setActionSuccess("Boarding gate opened. Students can now board.");
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        setActionError(res.error || "Failed to start boarding session.");
      }
    });
  }

  function handleDepart() {
    if (!currentJourney) return;
    setActionError(null);

    // Client-side quick safety check
    if (currentJourney.readinessStatus === "failed_unsafe") {
      setActionError("Cannot depart: Vehicle is marked UNSAFE. Rectify with transport administration.");
      return;
    }

    if (
      confirm(
        `Confirm departure for Bus ${currentJourney.vehicleRegistration}? Boarding will close and status will update to In Transit.`
      )
    ) {
      startTransition(async () => {
        const res = await executeJourneyDepartureAction({
          journeyId: currentJourney.id,
          isAssisted: false,
        });

        if (res.success) {
          setActionSuccess("Bus departed. Safe driving!");
          setTimeout(() => setActionSuccess(null), 3500);
        } else {
          setActionError(res.error || "Failed to record departure.");
        }
      });
    }
  }

  function handleArrival() {
    if (!currentJourney) return;
    setActionError(null);

    if (
      confirm(
        `Confirm arrival at destination for ${currentJourney.routeCode}? This marks the journey as completed.`
      )
    ) {
      startTransition(async () => {
        const res = await executeJourneyArrivalAction({
          journeyId: currentJourney.id,
          isAssisted: false,
        });

        if (res.success) {
          setActionSuccess("Destination reached. Trip successfully completed.");
          setTimeout(() => setActionSuccess(null), 3500);
        } else {
          setActionError(res.error || "Failed to record arrival.");
        }
      });
    }
  }

  if (journeys.length === 0) {
    return (
      <div className="space-y-6">
        {/* Driver Identity Card */}
        <div className="rounded-2xl bg-[#102D4A] p-6 text-white shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block mb-1">
              DIRECT SMARTPHONE DRIVER CONSOLE
            </span>
            <h1 className="text-xl font-bold">{driverName}</h1>
            <p className="text-xs text-slate-300 mt-0.5">
              Ref: <span className="font-mono text-white">{driverReference}</span> • Phone: {driverPhone || "Not set"}
            </p>
          </div>
          <span className="text-3xl">🚌</span>
        </div>

        {/* Empty State */}
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <span className="text-4xl block mb-2">📅</span>
          <h3 className="text-base font-bold text-[#102D4A]">
            No Journeys Assigned Today
          </h3>
          <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
            You do not have any scheduled departures assigned to your driver ID today. Check with the university transport dispatcher for fleet roster updates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Driver Identity & Shift Banner */}
      <div className="rounded-2xl bg-[#102D4A] p-5 text-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              DIRECT ACCESS ACTIVE
            </span>
            <span className="text-[11px] text-slate-300 font-mono">
              {driverReference}
            </span>
          </div>
          <h1 className="text-xl font-extrabold">{driverName}</h1>
          <p className="text-xs text-slate-300 mt-0.5">
            Operating Unit: <span className="text-white font-semibold">{currentJourney.vehicleRegistration}</span>
          </p>
        </div>

        {/* Urgent Incident Button */}
        <button
          onClick={() => setIncidentModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-500/20 px-3.5 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/30 transition-colors self-start sm:self-auto"
        >
          <span>⚠️</span>
          <span>Report Fault / Incident</span>
        </button>
      </div>

      {/* Action Messages */}
      {actionError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-rose-900 font-semibold flex items-center gap-2">
          <span>⛔</span>
          <span>{actionError}</span>
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-900 font-semibold flex items-center gap-2">
          <span>✓</span>
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Journey Selector if multiple assignments today */}
      {journeys.length > 1 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <label
            htmlFor="driver-journey-select"
            className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block mb-1.5"
          >
            TODAY&apos;S SHIFT DEPARTURES ({journeys.length} ASSIGNED)
          </label>
          <select
            id="driver-journey-select"
            value={selectedJourneyId}
            onChange={(e) => setSelectedJourneyId(e.target.value)}
            className="w-full text-xs font-bold bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
          >
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.routeCode} • {formatTime(j.scheduledDeparture)} — {j.vehicleRegistration} ({j.status.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Active Trip Operational Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        {/* Route & Vehicle Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-[#526B82]">
              {currentJourney.routeCode}
            </span>
            <h2 className="text-lg font-bold text-[#102D4A]">
              {currentJourney.routeName}
            </h2>
            <p className="text-xs text-[#526B82] mt-0.5">
              Scheduled Departure: <strong className="text-[#102D4A] font-mono">{formatTime(currentJourney.scheduledDeparture)}</strong>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                currentJourney.status === "boarding"
                  ? "bg-emerald-100 text-[#20A477] animate-pulse"
                  : currentJourney.status === "in_transit"
                  ? "bg-blue-100 text-blue-800"
                  : currentJourney.status === "completed"
                  ? "bg-slate-100 text-slate-600"
                  : "bg-amber-100 text-[#E5A13B]"
              }`}
            >
              {currentJourney.status === "in_transit" ? "IN TRANSIT" : currentJourney.status.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Readiness Checklist Status Bar */}
        <div className="rounded-xl bg-[#F6F8FA] border border-slate-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">
              {currentJourney.readinessStatus === "passed"
                ? "✅"
                : currentJourney.readinessStatus === "failed_unsafe"
                ? "⛔"
                : "⏳"}
            </span>
            <div>
              <span className="text-[10px] font-bold text-[#526B82] uppercase block">
                Pre-Trip Safety Inspection
              </span>
              <span className="text-xs font-bold text-[#102D4A]">
                {currentJourney.readinessStatus === "passed"
                  ? "Readiness Checklist Passed"
                  : currentJourney.readinessStatus === "failed_unsafe"
                  ? "Vehicle Marked UNSAFE (Departure Blocked)"
                  : "Inspection Pending"}
              </span>
            </div>
          </div>

          <button
            onClick={() => setReadinessModalOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#102D4A] text-xs font-bold transition-colors shadow-2xs self-start sm:self-auto"
          >
            {currentJourney.readinessStatus === "passed" ? "Review Inspection" : "Complete Checklist"}
          </button>
        </div>

        {/* Passenger Boarding Summary */}
        <div className="grid grid-cols-3 gap-2.5 text-center text-xs">
          <div className="p-3 rounded-xl bg-[#F6F8FA] border border-slate-200">
            <span className="text-[10px] font-bold uppercase text-[#526B82] block">Boarded</span>
            <span className="text-lg font-black text-[#20A477] font-mono">{currentJourney.boardedCount}</span>
          </div>
          <div className="p-3 rounded-xl bg-[#F6F8FA] border border-slate-200">
            <span className="text-[10px] font-bold uppercase text-[#526B82] block">Reserved</span>
            <span className="text-lg font-black text-[#102D4A] font-mono">{currentJourney.confirmedCount}</span>
          </div>
          <div className="p-3 rounded-xl bg-[#F6F8FA] border border-slate-200">
            <span className="text-[10px] font-bold uppercase text-[#526B82] block">Safe Limit</span>
            <span className="text-lg font-black text-[#102D4A] font-mono">{currentJourney.safeCapacity}</span>
          </div>
        </div>

        {/* Delay Alert if any */}
        {currentJourney.delayMinutes > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-center justify-between">
            <div>
              <span className="font-bold">+{currentJourney.delayMinutes} min Delay Reported</span>
              <p className="text-[11px] text-amber-800">{currentJourney.delayReason}</p>
            </div>
            <button
              onClick={() => setDelayModalOpen(true)}
              className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-amber-300 bg-white text-amber-900"
            >
              Update
            </button>
          </div>
        )}

        {/* Tabs: Operational Controls vs Stop Milestones */}
        <div className="flex border-b border-slate-200 pt-1">
          <button
            onClick={() => setActiveTab("controls")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
              activeTab === "controls"
                ? "border-[#102D4A] text-[#102D4A]"
                : "border-transparent text-[#526B82] hover:text-[#102D4A]"
            }`}
          >
            <span>🎮</span>
            <span>Trip Actions</span>
          </button>
          <button
            onClick={() => setActiveTab("stops")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
              activeTab === "stops"
                ? "border-[#102D4A] text-[#102D4A]"
                : "border-transparent text-[#526B82] hover:text-[#102D4A]"
            }`}
          >
            <span>📍</span>
            <span>Stop Milestones ({currentJourney.stops.length})</span>
          </button>
        </div>

        {/* Tab 1: Operational Controls */}
        {activeTab === "controls" && (
          <div className="space-y-3 pt-2">
            {/* Primary Action Buttons */}
            {currentJourney.status === "scheduled" && (
              <button
                type="button"
                onClick={handleStartBoarding}
                disabled={isPending}
                className="w-full py-3.5 px-4 rounded-xl text-sm font-bold text-white bg-[#E5A13B] hover:bg-[#d49028] shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <span>📋</span>
                <span>Open Boarding Gate for Passengers</span>
              </button>
            )}

            {currentJourney.status === "boarding" && (
              <button
                type="button"
                onClick={handleDepart}
                disabled={isPending || currentJourney.readinessStatus === "failed_unsafe"}
                className="w-full py-3.5 px-4 rounded-xl text-sm font-bold text-white bg-[#20A477] hover:bg-[#1a8560] shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <BusIcon className="w-5 h-5" />
                <span>Record Departure (Depart Bus Now)</span>
              </button>
            )}

            {currentJourney.status === "in_transit" && (
              <button
                type="button"
                onClick={handleArrival}
                disabled={isPending}
                className="w-full py-3.5 px-4 rounded-xl text-sm font-bold text-white bg-[#102D4A] hover:bg-[#0b1f33] shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <span>🏁</span>
                <span>Record Arrival at Final Destination</span>
              </button>
            )}

            {currentJourney.status === "completed" && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-semibold text-[#526B82]">
                ✓ Journey completed. Arrival logged at {currentJourney.actualArrival ? formatTime(currentJourney.actualArrival) : "Terminal"}.
              </div>
            )}

            {/* Secondary Operational Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDelayModalOpen(true)}
                className="py-2.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-[#102D4A] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>⏱️</span>
                <span>Report Schedule Delay</span>
              </button>

              <button
                type="button"
                onClick={() => setIncidentModalOpen(true)}
                className="py-2.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-[#D9534F] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>⚠️</span>
                <span>Log Trip Incident</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 2: Stop Milestones */}
        {activeTab === "stops" && (
          <div className="pt-2">
            <StopMilestones
              journeyId={currentJourney.id}
              stops={currentJourney.stops}
              isAssisted={false}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      <ReadinessModal
        journeyId={currentJourney.id}
        vehicleRegistration={currentJourney.vehicleRegistration}
        routeCode={currentJourney.routeCode}
        isOpen={readinessModalOpen}
        onClose={() => setReadinessModalOpen(false)}
        isAssisted={false}
      />

      <DelayModal
        journeyId={currentJourney.id}
        routeCode={currentJourney.routeCode}
        routeName={currentJourney.routeName}
        isOpen={delayModalOpen}
        onClose={() => setDelayModalOpen(false)}
        isAssisted={false}
      />

      <IncidentModal
        journeyId={currentJourney.id}
        vehicleId={currentJourney.vehicleId}
        isOpen={incidentModalOpen}
        onClose={() => setIncidentModalOpen(false)}
      />
    </div>
  );
}
