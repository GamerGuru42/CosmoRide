"use client";

import React, { useState, useTransition } from "react";
import { formatTime, formatDate } from "@/lib/utils";
import {
  verifyAndBoardPassAction,
  startBoardingSession,
  markPassengerNoShowAction,
  type BoardingStatusCode,
} from "@/actions/boarding";
import {
  BusIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  QrCodeIcon,
  UserIcon,
} from "@/components/ui/icons";
import { CameraScanner } from "./camera-scanner";
import { ScanResultModal, type ScanResultPayload } from "./scan-result-modal";
import { JourneyClosureModal } from "./journey-closure-modal";
import { IncidentModal } from "./incident-modal";
import { ManualBoardModal } from "./manual-board-modal";

export interface BoardingPassenger {
  bookingId: string;
  studentId: string;
  studentName: string;
  studentMatric: string | null;
  boardingStopName: string;
  status: "confirmed" | "checked_in" | "no_show" | "cancelled";
  checkedInAt: string | null;
  ticketToken: string | null;
}

export interface ActiveBoardingJourney {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
  routeCode: string;
  routeName: string;
  vehicleRegistration: string;
  vehicleName: string | null;
  vehicleId?: string | null;
  safeCapacity: number;
  proposedAllocation: number;
  passengers: BoardingPassenger[];
}

interface BoardingScannerViewProps {
  journeys: ActiveBoardingJourney[];
}

export function BoardingScannerView({ journeys }: BoardingScannerViewProps) {
  const [selectedJourneyId, setSelectedJourneyId] = useState<string>(
    journeys[0]?.id || ""
  );

  // Scanner modal state
  const [scanResult, setScanResult] = useState<ScanResultPayload | null>(null);
  const [isScannerPaused, setIsScannerPaused] = useState<boolean>(false);

  // Other modals
  const [closureModalOpen, setClosureModalOpen] = useState<boolean>(false);
  const [incidentModalOpen, setIncidentModalOpen] = useState<boolean>(false);
  const [manualOverrideBooking, setManualOverrideBooking] = useState<BoardingPassenger | null>(null);

  // View modes: camera scanner vs manifest
  const [activeTab, setActiveTab] = useState<"camera" | "manifest">("camera");

  const [isPending, startTransition] = useTransition();

  const currentJourney = journeys.find((j) => j.id === selectedJourneyId) || journeys[0];

  const boardedCount = currentJourney
    ? currentJourney.passengers.filter((p) => p.status === "checked_in").length
    : 0;
  const confirmedCount = currentJourney
    ? currentJourney.passengers.filter((p) => p.status === "confirmed").length
    : 0;
  const noShowCount = currentJourney
    ? currentJourney.passengers.filter((p) => p.status === "no_show").length
    : 0;

  const capacityCeiling = currentJourney
    ? Math.min(currentJourney.proposedAllocation, currentJourney.safeCapacity)
    : 30;

  const capacityPercentage = Math.min(100, Math.round((boardedCount / capacityCeiling) * 100));

  // Handler for QR scan (from camera or manual input)
  function handleScan(token: string) {
    if (!token || !currentJourney) return;

    setIsScannerPaused(true);

    startTransition(async () => {
      const res = await verifyAndBoardPassAction(
        token,
        currentJourney.id,
        "qr_scan"
      );

      setScanResult({
        code: res.code,
        message: res.message,
        passengerName: res.passengerName,
        studentId: res.studentId,
        passengerCategory: res.passengerCategory,
        boardedCount: res.boardedCount,
        capacity: res.capacity,
        busRegistration: res.busRegistration || currentJourney.vehicleRegistration,
        routeCode: currentJourney.routeCode,
      });
    });
  }

  function handleCloseScanModal() {
    setScanResult(null);
    setIsScannerPaused(false);
  }

  function handleStartBoarding() {
    if (!currentJourney) return;
    startTransition(async () => {
      await startBoardingSession(currentJourney.id);
    });
  }

  function handleMarkNoShow(bookingId: string) {
    if (confirm("Mark this passenger as a no-show?")) {
      startTransition(async () => {
        await markPassengerNoShowAction(bookingId);
      });
    }
  }

  if (!currentJourney) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
        <span className="text-4xl block mb-3">📋</span>
        <h3 className="text-base font-bold text-[#102D4A]">No Active Boarding Journeys</h3>
        <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
          There are no scheduled journeys assigned for boarding in your transport corridor today. Once departures are scheduled, they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Operational Incident Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#102D4A]">
            Boarding Operations Console
          </h2>
          <p className="text-xs text-[#526B82]">
            Verify digital boarding passes, monitor seat capacity, and depart university buses.
          </p>
        </div>

        <button
          onClick={() => setIncidentModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2 text-xs font-bold text-[#D9534F] hover:bg-rose-100 transition-colors shadow-2xs self-start sm:self-auto"
        >
          <span>⚠️</span>
          <span>Report Incident</span>
        </button>
      </div>

      {/* Corridor & Journey Selector Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1">
          <label
            htmlFor="journey-select"
            className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block mb-1"
          >
            ACTIVE BOARDING CORRIDOR
          </label>
          <select
            id="journey-select"
            value={selectedJourneyId}
            onChange={(e) => {
              setSelectedJourneyId(e.target.value);
              setScanResult(null);
            }}
            className="w-full md:w-auto text-sm font-bold bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
          >
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.routeCode} • {formatTime(j.scheduledDeparture)} — {j.vehicleRegistration} ({j.status.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        {/* Boarding Lifecycle Controls */}
        <div className="flex items-center gap-2">
          {currentJourney.status === "scheduled" && (
            <button
              onClick={handleStartBoarding}
              disabled={isPending}
              className="px-4 py-2.5 bg-[#E5A13B] hover:bg-[#d49028] text-[#102D4A] text-xs font-bold rounded-xl transition-colors shadow-xs"
            >
              Start Boarding Session
            </button>
          )}

          {currentJourney.status === "boarding" && (
            <button
              onClick={() => setClosureModalOpen(true)}
              disabled={isPending}
              className="px-4 py-2.5 bg-[#20A477] hover:bg-[#1b8a64] text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-1.5"
            >
              <BusIcon className="w-4 h-4" />
              <span>Close Gate & Depart Bus</span>
            </button>
          )}

          {currentJourney.status === "in_transit" && (
            <span className="px-3.5 py-2 rounded-xl bg-slate-100 text-[#102D4A] text-xs font-bold font-mono">
              BUS DEPARTED (IN TRANSIT)
            </span>
          )}
        </div>
      </div>

      {/* Live Capacity Gauge Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-3">
        <div className="flex items-center justify-between text-xs font-bold">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                currentJourney.status === "boarding" ? "bg-[#20A477] animate-pulse" : "bg-[#526B82]"
              }`}
            />
            <span className="text-[#102D4A] uppercase tracking-wider font-mono">
              BOARDING CAPACITY GAUGE
            </span>
          </div>
          <span className="font-mono text-sm text-[#102D4A]">
            {boardedCount} / {capacityCeiling} Safe Limit ({capacityPercentage}%)
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              capacityPercentage >= 100
                ? "bg-[#D9534F]"
                : capacityPercentage >= 80
                ? "bg-[#E5A13B]"
                : "bg-[#20A477]"
            }`}
            style={{ width: `${capacityPercentage}%` }}
          />
        </div>

        <div className="grid grid-cols-4 gap-2 pt-2 text-center text-xs">
          <div className="p-2.5 rounded-xl bg-[#F6F8FA] border border-slate-100">
            <span className="text-[10px] text-[#526B82] uppercase tracking-wider block">BOARDED</span>
            <span className="text-base font-black text-[#20A477] font-mono">{boardedCount}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-[#F6F8FA] border border-slate-100">
            <span className="text-[10px] text-[#526B82] uppercase tracking-wider block">PENDING</span>
            <span className="text-base font-black text-[#E5A13B] font-mono">{confirmedCount}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-[#F6F8FA] border border-slate-100">
            <span className="text-[10px] text-[#526B82] uppercase tracking-wider block">NO-SHOW</span>
            <span className="text-base font-black text-[#D9534F] font-mono">{noShowCount}</span>
          </div>
          <div className="p-2.5 rounded-xl bg-[#F6F8FA] border border-slate-100">
            <span className="text-[10px] text-[#526B82] uppercase tracking-wider block">APPROVED CAP</span>
            <span className="text-base font-black text-[#102D4A] font-mono">{capacityCeiling}</span>
          </div>
        </div>
      </div>

      {/* Tabs: Camera Scanner vs Passenger Manifest */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("camera")}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold transition-all border-b-2 ${
            activeTab === "camera"
              ? "border-[#102D4A] text-[#102D4A]"
              : "border-transparent text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          <span className="text-base">📷</span>
          <span>Live Camera Scanner</span>
        </button>

        <button
          onClick={() => setActiveTab("manifest")}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-bold transition-all border-b-2 ${
            activeTab === "manifest"
              ? "border-[#102D4A] text-[#102D4A]"
              : "border-transparent text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          <span className="text-base">👥</span>
          <span>Passenger Manifest ({currentJourney.passengers.length})</span>
        </button>
      </div>

      {/* Tab 1: Live Camera Scanner */}
      {activeTab === "camera" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-[#102D4A] uppercase tracking-wider font-mono">
              DIGITAL BOARDING PASS SCANNER
            </h3>
            <p className="text-xs text-[#526B82] mt-0.5">
              Position student QR boarding pass in frame or enter ticket code manually.
            </p>
          </div>

          <CameraScanner
            onScan={handleScan}
            isPaused={isScannerPaused || Boolean(scanResult)}
          />
        </div>
      )}

      {/* Tab 2: Passenger Manifest Table */}
      {activeTab === "manifest" && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#102D4A] uppercase tracking-wider font-mono">
                JOURNEY MANIFEST ({currentJourney.passengers.length} RESERVED)
              </h3>
              <p className="text-xs text-[#526B82]">
                Boarding list for {currentJourney.routeCode} ({formatTime(currentJourney.scheduledDeparture)})
              </p>
            </div>
          </div>

          {currentJourney.passengers.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#526B82]">
              No passengers have booked this departure yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {currentJourney.passengers.map((p) => (
                <div
                  key={p.bookingId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-[#102D4A]">
                        {p.studentName}
                      </span>
                      {p.studentMatric && (
                        <span className="text-[10px] font-mono text-[#526B82] bg-slate-100 px-1 rounded">
                          {p.studentMatric}
                        </span>
                      )}
                      <span
                        className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          p.status === "checked_in"
                            ? "bg-[#20A477]/10 text-[#20A477]"
                            : p.status === "no_show"
                            ? "bg-[#D9534F]/10 text-[#D9534F]"
                            : "bg-[#E5A13B]/10 text-[#E5A13B]"
                        }`}
                      >
                        {p.status === "checked_in" ? "BOARDED" : p.status === "no_show" ? "NO-SHOW" : "PENDING"}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#526B82] mt-0.5">
                      Pickup: {p.boardingStopName}
                      {p.checkedInAt && ` • Boarded at ${formatTime(p.checkedInAt)}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {p.status === "confirmed" && (
                      <>
                        <button
                          onClick={() => setManualOverrideBooking(p)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-[#102D4A] text-xs font-semibold transition-colors"
                        >
                          Manual Exception
                        </button>
                        <button
                          onClick={() => handleMarkNoShow(p.bookingId)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#D9534F] hover:bg-red-50 transition-colors"
                        >
                          No-Show
                        </button>
                      </>
                    )}
                    {p.status === "checked_in" && (
                      <span className="text-xs font-bold text-[#20A477] flex items-center gap-1">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span>On Board</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <ScanResultModal
        result={scanResult}
        onClose={handleCloseScanModal}
        autoAdvance={true}
      />

      <JourneyClosureModal
        journeyId={currentJourney.id}
        routeCode={currentJourney.routeCode}
        routeName={currentJourney.routeName}
        busRegistration={currentJourney.vehicleRegistration}
        boardedCount={boardedCount}
        confirmedCount={confirmedCount}
        capacityCeiling={capacityCeiling}
        isOpen={closureModalOpen}
        onClose={() => setClosureModalOpen(false)}
      />

      <IncidentModal
        journeyId={currentJourney.id}
        vehicleId={currentJourney.vehicleId || null}
        isOpen={incidentModalOpen}
        onClose={() => setIncidentModalOpen(false)}
      />

      <ManualBoardModal
        passenger={manualOverrideBooking}
        journeyId={currentJourney.id}
        isOpen={Boolean(manualOverrideBooking)}
        onClose={() => setManualOverrideBooking(null)}
        onSuccess={(name) => {
          setScanResult({
            code: "VALID",
            message: `Manual boarding exception verified: ${name}`,
            passengerName: name,
            boardedCount: boardedCount + 1,
            capacity: capacityCeiling,
            busRegistration: currentJourney.vehicleRegistration,
          });
        }}
      />
    </div>
  );
}
