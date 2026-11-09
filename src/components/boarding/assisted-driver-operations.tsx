"use client";

import React, { useState, useTransition } from "react";
import { formatTime, formatDate } from "@/lib/utils";
import {
  executeJourneyDepartureAction,
  executeJourneyArrivalAction,
} from "@/actions/driver";
import { startBoardingSession } from "@/actions/boarding";
import { ReadinessModal } from "@/components/driver/readiness-modal";
import { DelayModal } from "@/components/driver/delay-modal";
import { StopMilestones, type RouteStopItem } from "@/components/driver/stop-milestones";
import { IncidentModal } from "@/components/boarding/incident-modal";
import { BusIcon, CheckCircleIcon, AlertTriangleIcon } from "@/components/ui/icons";

export interface AssistedJourneyData {
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
  driverName: string;
  driverReference: string;
  driverPhone: string | null;
  driverHasAppAccess: boolean;
  safeCapacity: number;
  proposedAllocation: number;
  readinessStatus: "pending" | "passed" | "failed_unsafe";
  delayMinutes: number;
  delayReason: string | null;
  boardedCount: number;
  confirmedCount: number;
  stops: RouteStopItem[];
}

interface AssistedDriverOperationsProps {
  officerName: string;
  corridorName: string;
  journeys: AssistedJourneyData[];
}

export function AssistedDriverOperations({
  officerName,
  corridorName,
  journeys,
}: AssistedDriverOperationsProps) {
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>(
    journeys[0]?.id || ""
  );

  // Modals state
  const [readinessModalOpen, setReadinessModalOpen] = useState<boolean>(false);
  const [delayModalOpen, setDelayModalOpen] = useState<boolean>(false);
  const [incidentModalOpen, setIncidentModalOpen] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<"actions" | "stops">("actions");
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
        setActionSuccess("Boarding gate opened.");
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        setActionError(res.error || "Failed to start boarding session.");
      }
    });
  }

  function handleDepart() {
    if (!currentJourney) return;
    setActionError(null);

    if (currentJourney.readinessStatus === "failed_unsafe") {
      setActionError("SAFETY HALT: Vehicle is marked UNSAFE. Departure cannot proceed.");
      return;
    }

    if (
      confirm(
        `Record assisted departure for Bus ${currentJourney.vehicleRegistration} driven by ${currentJourney.driverName}? This action is audited under your officer account.`
      )
    ) {
      startTransition(async () => {
        const res = await executeJourneyDepartureAction({
          journeyId: currentJourney.id,
          isAssisted: true,
          closureNotes: `Assisted departure recorded by Officer ${officerName}`,
        });

        if (res.success) {
          setActionSuccess("Assisted departure recorded. Bus is now In Transit.");
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
        `Confirm arrival at destination for ${currentJourney.routeCode}? Recorded on behalf of driver ${currentJourney.driverName}.`
      )
    ) {
      startTransition(async () => {
        const res = await executeJourneyArrivalAction({
          journeyId: currentJourney.id,
          isAssisted: true,
          notes: `Assisted arrival recorded by Officer ${officerName}`,
        });

        if (res.success) {
          setActionSuccess("Destination reached. Journey completed.");
          setTimeout(() => setActionSuccess(null), 3500);
        } else {
          setActionError(res.error || "Failed to record arrival.");
        }
      });
    }
  }

  if (journeys.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <span className="text-4xl block mb-2">🤝</span>
        <h3 className="text-base font-bold text-[#102D4A]">
          No Assisted Journeys in Corridor
        </h3>
        <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
          There are no scheduled journeys assigned in your corridor today requiring assisted operations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Attribution & Accountability Banner */}
      <div className="rounded-2xl bg-[#102D4A] p-5 text-white shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
              ASSISTED OPERATIONS MODE
            </span>
            <span className="text-xs text-slate-300 font-mono">
              Corridor: {corridorName}
            </span>
          </div>
          <h2 className="text-xl font-bold">
            Representative-Assisted Trip Management
          </h2>
          <p className="text-xs text-slate-300 mt-0.5 max-w-xl">
            Authorized for hostel representatives and station officials operating on behalf of drivers without smartphones. Every action logs your officer identity (<span className="text-white font-semibold">{officerName}</span>).
          </p>
        </div>

        <button
          onClick={() => setIncidentModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-500/20 px-3.5 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/30 transition-colors shrink-0 self-start md:self-auto"
        >
          <span>⚠️</span>
          <span>Report Breakdown / Incident</span>
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

      {/* Journey & Driver Selection Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div>
          <label
            htmlFor="assisted-journey-select"
            className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block mb-1.5"
          >
            SELECT ASSIGNED BUS & DRIVER
          </label>
          <select
            id="assisted-journey-select"
            value={selectedJourneyId}
            onChange={(e) => setSelectedJourneyId(e.target.value)}
            className="w-full text-xs font-bold bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
          >
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.routeCode} • {formatTime(j.scheduledDeparture)} — Bus {j.vehicleRegistration} (Driver: {j.driverName} • {j.driverReference})
              </option>
            ))}
          </select>
        </div>

        {/* Driver Identity Card */}
        <div className="p-4 rounded-xl bg-[#F6F8FA] border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-[10px] font-bold uppercase text-[#526B82] block">
              Assigned Driver
            </span>
            <span className="font-bold text-[#102D4A] text-sm block">
              {currentJourney.driverName}
            </span>
            <span className="text-[11px] font-mono text-[#526B82]">
              Ref: {currentJourney.driverReference}
            </span>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase text-[#526B82] block">
              Driver Phone / Contact
            </span>
            <span className="font-bold text-[#102D4A] font-mono block">
              {currentJourney.driverPhone || "Radio Dispatch"}
            </span>
            <span className="text-[10px] text-[#526B82]">
              {currentJourney.driverHasAppAccess ? "Smartphone App Available" : "No Smartphone (Assisted Mode)"}
            </span>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase text-[#526B82] block">
              Vehicle & Capacity
            </span>
            <span className="font-bold text-[#102D4A] block">
              {currentJourney.vehicleRegistration}
            </span>
            <span className="text-[11px] text-[#20A477] font-semibold">
              {currentJourney.boardedCount} Boarded / {currentJourney.safeCapacity} Cap
            </span>
          </div>
        </div>
      </div>

      {/* Operational Actions Panel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <span className="text-[10px] font-bold font-mono text-[#526B82] uppercase">
              OPERATIONAL CONTROLS
            </span>
            <h3 className="text-base font-bold text-[#102D4A]">
              {currentJourney.routeCode} — {currentJourney.routeName}
            </h3>
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
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

        {/* Readiness Checklist Status */}
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
                  ? "Flagged UNSAFE (Departure Blocked)"
                  : "Inspection Pending"}
              </span>
            </div>
          </div>

          <button
            onClick={() => setReadinessModalOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#102D4A] text-xs font-bold transition-colors shadow-2xs self-start sm:self-auto"
          >
            {currentJourney.readinessStatus === "passed" ? "Review Inspection" : "Perform Checklist (Assisted)"}
          </button>
        </div>

        {/* Delay Notice Banner */}
        {currentJourney.delayMinutes > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-center justify-between">
            <div>
              <span className="font-bold">+{currentJourney.delayMinutes} min Delay Recorded</span>
              <p className="text-[11px] text-amber-800">{currentJourney.delayReason}</p>
            </div>
            <button
              onClick={() => setDelayModalOpen(true)}
              className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-amber-300 bg-white text-amber-900"
            >
              Update Delay
            </button>
          </div>
        )}

        {/* Tabs: Actions vs Stop Milestones */}
        <div className="flex border-b border-slate-200 pt-1">
          <button
            onClick={() => setActiveTab("actions")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold transition-all border-b-2 ${
              activeTab === "actions"
                ? "border-[#102D4A] text-[#102D4A]"
                : "border-transparent text-[#526B82] hover:text-[#102D4A]"
            }`}
          >
            <span>⚡</span>
            <span>Assisted Actions</span>
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
            <span>Pickup Stops & Milestones ({currentJourney.stops.length})</span>
          </button>
        </div>

        {/* Tab 1: Actions */}
        {activeTab === "actions" && (
          <div className="space-y-3 pt-2">
            {currentJourney.status === "scheduled" && (
              <button
                type="button"
                onClick={handleStartBoarding}
                disabled={isPending}
                className="w-full py-3 px-4 rounded-xl text-xs font-bold text-[#102D4A] bg-[#E5A13B] hover:bg-[#d49028] shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <span>📋</span>
                <span>Open Boarding Session (Assisted)</span>
              </button>
            )}

            {currentJourney.status === "boarding" && (
              <button
                type="button"
                onClick={handleDepart}
                disabled={isPending || currentJourney.readinessStatus === "failed_unsafe"}
                className="w-full py-3.5 px-4 rounded-xl text-xs font-bold text-white bg-[#20A477] hover:bg-[#1a8560] shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <BusIcon className="w-4 h-4" />
                <span>Confirm Bus Departure (Driver Departing Now)</span>
              </button>
            )}

            {currentJourney.status === "in_transit" && (
              <button
                type="button"
                onClick={handleArrival}
                disabled={isPending}
                className="w-full py-3.5 px-4 rounded-xl text-xs font-bold text-white bg-[#102D4A] hover:bg-[#0b1f33] shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <span>🏁</span>
                <span>Confirm Bus Arrived at Terminal (Assisted)</span>
              </button>
            )}

            {currentJourney.status === "completed" && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs font-semibold text-[#526B82]">
                ✓ Journey completed.
              </div>
            )}

            {/* Quick Delay and Incident Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDelayModalOpen(true)}
                className="py-2.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-[#102D4A] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>⏱️</span>
                <span>Report Delay for Driver</span>
              </button>

              <button
                type="button"
                onClick={() => setIncidentModalOpen(true)}
                className="py-2.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-[#D9534F] transition-colors flex items-center justify-center gap-1.5"
              >
                <span>⚠️</span>
                <span>Report Breakdown / Incident</span>
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
              isAssisted={true}
            />
          </div>
        )}
      </div>

      {/* Modals with isAssisted=true */}
      <ReadinessModal
        journeyId={currentJourney.id}
        vehicleRegistration={currentJourney.vehicleRegistration}
        routeCode={currentJourney.routeCode}
        isOpen={readinessModalOpen}
        onClose={() => setReadinessModalOpen(false)}
        isAssisted={true}
      />

      <DelayModal
        journeyId={currentJourney.id}
        routeCode={currentJourney.routeCode}
        routeName={currentJourney.routeName}
        isOpen={delayModalOpen}
        onClose={() => setDelayModalOpen(false)}
        isAssisted={true}
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
