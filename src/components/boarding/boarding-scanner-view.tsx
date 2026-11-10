"use client";

import React, { useState, useEffect, useTransition } from "react";
import { formatTime, formatDate } from "@/lib/utils";
import {
  verifyAndBoardPassAction,
  confirmBusArrivalAction,
  openBoardingSessionAction,
  closeBoardingSessionAction,
  authoriseDepartureAction,
  confirmDispatchAction,
  markPassengerNoShowAction,
  type BoardingStatusCode,
} from "@/actions/boarding";
import {
  BusIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  QrCodeIcon,
  UserIcon,
  ClockIcon,
} from "@/components/ui/icons";
import { CameraScanner } from "./camera-scanner";
import { ScanResultModal, type ScanResultPayload } from "./scan-result-modal";
import { IncidentModal } from "./incident-modal";
import { ManualBoardModal } from "./manual-board-modal";

export interface BoardingPassenger {
  bookingId: string;
  studentId: string;
  studentName: string;
  studentMatric: string | null;
  boardingStopName: string;
  status: "confirmed" | "checked_in" | "no_show" | "cancelled";
  passengerCategory?: "seated" | "standing";
  checkedInAt: string | null;
  ticketToken: string | null;
}

export interface ActiveBoardingJourney {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  latestPermittedDeparture?: string | null;
  actualDeparture?: string | null;
  busArrivedAt?: string | null;
  boardingOpenedAt?: string | null;
  boardingWindowMinutes?: number;
  boardingClosedAt?: string | null;
  departureAuthorisedAt?: string | null;
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
  vehicleRegistration: string;
  vehicleName: string | null;
  vehicleId?: string | null;
  safeCapacity: number;
  seatedCapacity?: number;
  standingCapacity?: number;
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

  // Modal states
  const [scanResult, setScanResult] = useState<ScanResultPayload | null>(null);
  const [isScannerPaused, setIsScannerPaused] = useState<boolean>(false);
  const [incidentModalOpen, setIncidentModalOpen] = useState<boolean>(false);
  const [manualOverrideBooking, setManualOverrideBooking] = useState<BoardingPassenger | null>(null);

  // View modes: camera scanner vs manifest
  const [activeTab, setActiveTab] = useState<"camera" | "manifest">("camera");

  // Configurable boarding window state (default 10)
  const [boardingWindowInput, setBoardingWindowInput] = useState<number>(10);
  const [closureNotes, setClosureNotes] = useState<string>("");
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Transition state
  const [isPending, startTransition] = useTransition();

  const currentJourney = journeys.find((j) => j.id === selectedJourneyId) || journeys[0];

  // Live countdown timer for active boarding sessions
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!currentJourney || currentJourney.status !== "boarding" || !currentJourney.boardingOpenedAt) {
      setTimeLeftSeconds(null);
      return;
    }

    const windowMinutes = currentJourney.boardingWindowMinutes || 10;
    const openedTime = new Date(currentJourney.boardingOpenedAt).getTime();
    const expiryTime = openedTime + windowMinutes * 60 * 1000;

    const updateTimer = () => {
      const now = Date.now();
      const diffSecs = Math.max(0, Math.floor((expiryTime - now) / 1000));
      setTimeLeftSeconds(diffSecs);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [currentJourney?.id, currentJourney?.status, currentJourney?.boardingOpenedAt, currentJourney?.boardingWindowMinutes]);

  // Derived passenger metrics
  const activePassengers = currentJourney?.passengers || [];
  const bookedCount = activePassengers.filter((p) => p.status === "confirmed" || p.status === "checked_in").length;
  const boardedCount = activePassengers.filter((p) => p.status === "checked_in").length;
  const yetToBoardCount = activePassengers.filter((p) => p.status === "confirmed").length;
  const noShowCount = activePassengers.filter((p) => p.status === "no_show").length;

  const seatedBoarded = activePassengers.filter(
    (p) => p.status === "checked_in" && p.passengerCategory === "seated"
  ).length;
  const standingBoarded = activePassengers.filter(
    (p) => p.status === "checked_in" && p.passengerCategory === "standing"
  ).length;

  const seatedLimit = currentJourney?.seatedCapacity ?? 20;
  const standingLimit = currentJourney?.standingCapacity ?? 12;
  const totalSafeCapacity = Math.min(32, currentJourney?.safeCapacity || 32);

  // Handler for QR scan
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

  // Stage 2: Confirm Bus Arrival
  function handleConfirmArrival() {
    if (!currentJourney) return;
    setFeedbackMessage(null);
    startTransition(async () => {
      const res = await confirmBusArrivalAction(currentJourney.id);
      if (res.success) {
        setFeedbackMessage({ type: "success", text: res.message || "Bus arrival confirmed at terminal." });
      } else {
        setFeedbackMessage({ type: "error", text: res.error || "Failed to confirm bus arrival." });
      }
    });
  }

  // Stage 3: Open Boarding Session
  function handleOpenBoarding() {
    if (!currentJourney) return;
    setFeedbackMessage(null);
    startTransition(async () => {
      const res = await openBoardingSessionAction(currentJourney.id, boardingWindowInput);
      if (res.success) {
        setFeedbackMessage({ type: "success", text: res.message || "Boarding opened with countdown." });
      } else {
        setFeedbackMessage({ type: "error", text: res.error || "Failed to open boarding." });
      }
    });
  }

  // Stage 5: Close Boarding Session
  function handleCloseBoarding() {
    if (!currentJourney) return;
    setFeedbackMessage(null);
    startTransition(async () => {
      const res = await closeBoardingSessionAction(currentJourney.id, closureNotes || undefined);
      if (res.success) {
        setFeedbackMessage({ type: "success", text: res.message || "Boarding closed. Manifest ready for review." });
      } else {
        setFeedbackMessage({ type: "error", text: res.error || "Failed to close boarding." });
      }
    });
  }

  // Stage 6: Authorise Departure
  function handleAuthoriseDeparture() {
    if (!currentJourney) return;
    setFeedbackMessage(null);
    startTransition(async () => {
      const res = await authoriseDepartureAction(currentJourney.id, closureNotes || undefined);
      if (res.success) {
        setFeedbackMessage({
          type: "success",
          text: res.message || "Departure authorised. Driver instructed to close doors.",
        });
      } else {
        setFeedbackMessage({ type: "error", text: res.error || "Failed to authorise departure." });
      }
    });
  }

  // Stage 7: Confirm Dispatch / Actual Departure
  function handleConfirmDispatch() {
    if (!currentJourney) return;
    setFeedbackMessage(null);
    startTransition(async () => {
      const res = await confirmDispatchAction(currentJourney.id);
      if (res.success) {
        setFeedbackMessage({ type: "success", text: res.message || "Bus departed terminal." });
      } else {
        setFeedbackMessage({ type: "error", text: res.error || "Failed to record departure." });
      }
    });
  }

  // Mark single passenger as no-show
  function handleMarkNoShow(bookingId: string) {
    if (confirm("Mark this student as an authorised no-show?")) {
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
          There are no scheduled journeys assigned for boarding in your hostel operation today. Once departures are scheduled, they will appear here.
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
            Hostel Representative Boarding Console
          </h2>
          <p className="text-xs text-[#526B82]">
            Controls arrival, boarding countdown, QR verification, manifest review, and departure authorisation.
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

      {/* Action Feedback Banner */}
      {feedbackMessage && (
        <div
          className={`rounded-xl p-3.5 text-xs font-semibold flex items-center justify-between border ${
            feedbackMessage.type === "success"
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-rose-50 text-rose-900 border-rose-200"
          }`}
        >
          <span>{feedbackMessage.text}</span>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-xs font-bold opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Journey Selector Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1">
          <label
            htmlFor="journey-select"
            className="text-[10px] font-bold text-[#526B82] uppercase tracking-wider block mb-1"
          >
            ACTIVE TRANSIT ROUTE &amp; DEPARTURE
          </label>
          <select
            id="journey-select"
            value={selectedJourneyId}
            onChange={(e) => {
              setSelectedJourneyId(e.target.value);
              setScanResult(null);
              setFeedbackMessage(null);
            }}
            className="w-full md:w-auto text-sm font-bold bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
          >
            {journeys.map((j) => (
              <option key={j.id} value={j.id}>
                {j.routeCode} • {formatTime(j.scheduledDeparture)} — Bus {j.vehicleRegistration} ({j.status.toUpperCase().replace("_", " ")})
              </option>
            ))}
          </select>
        </div>

        {/* Current State Indicator Badge */}
        <div className="flex items-center gap-2">
          {currentJourney.status === "scheduled" && (
            <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-[#526B82] text-xs font-bold border border-slate-200">
              STAGE 1: SCHEDULED
            </span>
          )}
          {currentJourney.status === "bus_arrived" && (
            <span className="px-3 py-1.5 rounded-xl bg-blue-100 text-blue-900 text-xs font-bold border border-blue-200">
              STAGE 2: BUS ARRIVED (DOORS CLOSED)
            </span>
          )}
          {currentJourney.status === "boarding" && (
            <span className="px-3 py-1.5 rounded-xl bg-amber-100 text-amber-900 text-xs font-bold border border-amber-300 animate-pulse">
              STAGE 4: BOARDING IN PROGRESS
            </span>
          )}
          {currentJourney.status === "boarding_closed" && (
            <span className="px-3 py-1.5 rounded-xl bg-purple-100 text-purple-900 text-xs font-bold border border-purple-200">
              STAGE 5: BOARDING CLOSED (REVIEW MANIFEST)
            </span>
          )}
          {currentJourney.status === "ready_to_depart" && (
            <span className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 text-xs font-bold border border-emerald-300">
              STAGE 6: READY TO DEPART (DISPATCH AUTHORISED)
            </span>
          )}
          {currentJourney.status === "in_transit" && (
            <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-[#102D4A] text-xs font-bold font-mono">
              STAGE 7: DEPARTED (IN TRANSIT)
            </span>
          )}
        </div>
      </div>

      {/* Stage-Driven Operational Action Panel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-[#102D4A]">
              Controlled Boarding &amp; Dispatch Sequence
            </h3>
            <p className="text-xs text-[#526B82]">
              The Hostel Representative controls boarding gate timing and authorises bus departure.
            </p>
          </div>

          {/* Countdown timer badge if boarding is open */}
          {currentJourney.status === "boarding" && timeLeftSeconds !== null && (
            <div
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-mono font-bold ${
                timeLeftSeconds === 0
                  ? "bg-rose-100 text-rose-800 border-rose-300"
                  : timeLeftSeconds < 180
                  ? "bg-amber-100 text-amber-800 border-amber-300 animate-pulse"
                  : "bg-emerald-100 text-emerald-800 border-emerald-300"
              }`}
            >
              <ClockIcon className="w-4 h-4" />
              <span>
                {timeLeftSeconds === 0
                  ? "BOARDING WINDOW EXPIRED — CLOSE BOARDING"
                  : `WINDOW: ${Math.floor(timeLeftSeconds / 60)
                      .toString()
                      .padStart(2, "0")}:${(timeLeftSeconds % 60).toString().padStart(2, "0")}`}
              </span>
            </div>
          )}
        </div>

        {/* Action Controls for Active Journey */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Stage 1 -> Stage 2: Confirm Bus Arrival */}
          {currentJourney.status === "scheduled" && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleConfirmArrival}
                disabled={isPending}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-2"
              >
                <BusIcon className="w-4 h-4" />
                <span>Confirm Bus Arrival at Pickup</span>
              </button>
              <span className="text-xs text-[#526B82]">
                (Driver keeps doors closed while queue forms; arrival does not auto-open boarding)
              </span>
            </div>
          )}

          {/* Stage 2 -> Stage 3: Open Boarding */}
          {(currentJourney.status === "scheduled" || currentJourney.status === "bus_arrived") && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-slate-700">
                <label htmlFor="window-input" className="font-semibold">
                  Boarding Window:
                </label>
                <select
                  id="window-input"
                  value={boardingWindowInput}
                  onChange={(e) => setBoardingWindowInput(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-[#102D4A] focus:outline-none"
                >
                  <option value={5}>5 mins</option>
                  <option value={10}>10 mins (Standard)</option>
                  <option value={15}>15 mins</option>
                  <option value={20}>20 mins</option>
                </select>
              </div>

              <button
                onClick={handleOpenBoarding}
                disabled={isPending}
                className="px-4 py-2.5 bg-[#20A477] hover:bg-[#1a8560] text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-2"
              >
                <span>🚪</span>
                <span>Instruct Driver to Open Doors &amp; Start Boarding</span>
              </button>
            </div>
          )}

          {/* Stage 4 -> Stage 5: Close Boarding Gate */}
          {currentJourney.status === "boarding" && (
            <div className="flex items-center gap-3 flex-wrap w-full">
              <button
                onClick={handleCloseBoarding}
                disabled={isPending}
                className="px-4 py-2.5 bg-[#E5A13B] hover:bg-[#c9892c] text-[#102D4A] text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-2"
              >
                <span>🔒</span>
                <span>Close Boarding Gate &amp; Review Manifest</span>
              </button>
              <span className="text-xs text-[#526B82]">
                Halts scanning. Preserves unboarded passengers without auto-marking no-shows.
              </span>
            </div>
          )}

          {/* Stage 5 -> Stage 6: Authorise Departure */}
          {currentJourney.status === "boarding_closed" && (
            <div className="flex items-center gap-3 flex-wrap w-full">
              <button
                onClick={handleAuthoriseDeparture}
                disabled={isPending}
                className="px-5 py-2.5 bg-[#102D4A] hover:bg-[#0c233a] text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-2"
              >
                <span>✅</span>
                <span>Confirm Boarding Completion &amp; Authorise Departure</span>
              </button>
              <span className="text-xs text-[#526B82]">
                Signals Bus Manager and Driver that doors may be closed for dispatch.
              </span>
            </div>
          )}

          {/* Stage 6 -> Stage 7: Confirm Dispatch */}
          {currentJourney.status === "ready_to_depart" && (
            <div className="flex items-center gap-3 flex-wrap w-full">
              <button
                onClick={handleConfirmDispatch}
                disabled={isPending}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-2"
              >
                <BusIcon className="w-4 h-4" />
                <span>Confirm Rolling Dispatch / Bus Departed</span>
              </button>
              <span className="text-xs text-emerald-800 font-semibold">
                Bus is authorized for departure. Doors closed. Rolling out of terminal.
              </span>
            </div>
          )}

          {/* Stage 7: In Transit */}
          {currentJourney.status === "in_transit" && (
            <div className="text-xs text-slate-700">
              <span className="font-bold text-[#102D4A]">Departure confirmed at: </span>
              <span className="font-mono text-emerald-700 font-bold">
                {currentJourney.actualDeparture
                  ? formatTime(currentJourney.actualDeparture)
                  : "Recorded"}
              </span>
              <span className="ml-2 text-slate-500">
                (Bus is currently en route to destination)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Live Capacity Gauge Bar (20 Seated + 12 Standing = 32 Maximum) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                currentJourney.status === "boarding"
                  ? "bg-[#20A477] animate-pulse"
                  : currentJourney.status === "ready_to_depart"
                  ? "bg-emerald-500"
                  : "bg-[#526B82]"
              }`}
            />
            <span className="text-[#102D4A] uppercase tracking-wider font-mono">
              ELECTRIC BUS CAPACITY BREAKDOWN
            </span>
          </div>
          <span className="font-mono text-sm text-[#102D4A]">
            {boardedCount} Boarded / {totalSafeCapacity} Capacity (Max 32)
          </span>
        </div>

        {/* Detailed 4-Metric Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] font-bold text-[#526B82] uppercase block">
              Seated Boarded
            </span>
            <span className="text-xl font-extrabold text-[#102D4A] font-mono">
              {seatedBoarded} <span className="text-xs font-normal text-[#526B82]">/ {seatedLimit}</span>
            </span>
            <span className="text-[10px] text-emerald-700 block font-medium">
              Priority Seating (Max 20)
            </span>
          </div>

          <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] font-bold text-[#526B82] uppercase block">
              Standing Boarded
            </span>
            <span className="text-xl font-extrabold text-amber-700 font-mono">
              {standingBoarded} <span className="text-xs font-normal text-[#526B82]">/ {standingLimit}</span>
            </span>
            <span className="text-[10px] text-amber-700 block font-medium">
              Standing Area (Max 12)
            </span>
          </div>

          <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] font-bold text-[#526B82] uppercase block">
              Yet to Board
            </span>
            <span className="text-xl font-extrabold text-[#526B82] font-mono">
              {yetToBoardCount}
            </span>
            <span className="text-[10px] text-[#526B82] block">
              Confirmed Reservations
            </span>
          </div>

          <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3">
            <span className="text-[10px] font-bold text-[#526B82] uppercase block">
              Total Passengers
            </span>
            <span
              className={`text-xl font-extrabold font-mono ${
                boardedCount >= totalSafeCapacity ? "text-rose-600" : "text-[#20A477]"
              }`}
            >
              {boardedCount} / {totalSafeCapacity}
            </span>
            <span className="text-[10px] text-[#526B82] block">
              {Math.max(0, totalSafeCapacity - boardedCount)} places remaining
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              boardedCount >= totalSafeCapacity
                ? "bg-[#D9534F]"
                : boardedCount >= 20
                ? "bg-[#E5A13B]"
                : "bg-[#20A477]"
            }`}
            style={{ width: `${Math.min(100, Math.round((boardedCount / totalSafeCapacity) * 100))}%` }}
          />
        </div>
      </div>

      {/* Tabs: Camera Scanner vs Passenger Manifest */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("camera")}
          className={`flex items-center gap-2 py-3 px-5 text-xs font-bold border-b-2 transition-colors ${
            activeTab === "camera"
              ? "border-[#102D4A] text-[#102D4A]"
              : "border-transparent text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          <QrCodeIcon className="w-4 h-4" />
          <span>Camera Scanner</span>
        </button>

        <button
          onClick={() => setActiveTab("manifest")}
          className={`flex items-center gap-2 py-3 px-5 text-xs font-bold border-b-2 transition-colors ${
            activeTab === "manifest"
              ? "border-[#102D4A] text-[#102D4A]"
              : "border-transparent text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          <UserIcon className="w-4 h-4" />
          <span>Passenger Manifest ({activePassengers.length})</span>
        </button>
      </div>

      {/* Tab 1: Camera Scanner */}
      {activeTab === "camera" && (
        <div className="space-y-4">
          {currentJourney.status !== "boarding" && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 flex items-center gap-2 font-medium">
              <AlertTriangleIcon className="w-5 h-5 text-amber-600 shrink-0" />
              <span>
                Scanner is paused: Journey status is <strong>{currentJourney.status.toUpperCase().replace("_", " ")}</strong>. Please click &ldquo;Instruct Driver to Open Doors &amp; Start Boarding&rdquo; to begin scanning passenger tickets.
              </span>
            </div>
          )}

          <CameraScanner
            onScan={handleScan}
            isPaused={isScannerPaused || isPending || currentJourney.status !== "boarding"}
          />
        </div>
      )}

      {/* Tab 2: Passenger Manifest */}
      {activeTab === "manifest" && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h4 className="text-xs font-bold text-[#102D4A] uppercase tracking-wider">
              Manifest for {currentJourney.routeCode} ({formatTime(currentJourney.scheduledDeparture)})
            </h4>
            <span className="text-xs text-[#526B82]">
              {boardedCount} Boarded • {yetToBoardCount} Pending
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] text-[#526B82] uppercase border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Student</th>
                  <th className="py-2.5 px-4 font-semibold">Matric ID</th>
                  <th className="py-2.5 px-4 font-semibold">Pickup Stop</th>
                  <th className="py-2.5 px-4 font-semibold">Category</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activePassengers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                      No passengers booked for this departure.
                    </td>
                  </tr>
                ) : (
                  activePassengers.map((p) => (
                    <tr key={p.bookingId} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-[#102D4A]">
                        {p.studentName}
                      </td>
                      <td className="py-3 px-4 font-mono text-[#526B82]">
                        {p.studentMatric || "—"}
                      </td>
                      <td className="py-3 px-4 text-[#526B82]">
                        {p.boardingStopName}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            p.passengerCategory === "seated"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}
                        >
                          {p.passengerCategory || "seated"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {p.status === "checked_in" && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircleIcon className="w-3.5 h-3.5" />
                            <span>Boarded</span>
                          </span>
                        )}
                        {p.status === "confirmed" && (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                            <ClockIcon className="w-3.5 h-3.5" />
                            <span>Pending</span>
                          </span>
                        )}
                        {p.status === "no_show" && (
                          <span className="text-rose-700 font-bold">No-Show</span>
                        )}
                        {p.status === "cancelled" && (
                          <span className="text-slate-400 line-through">Cancelled</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {p.status === "confirmed" && (
                          <>
                            <button
                              onClick={() => setManualOverrideBooking(p)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#102D4A] bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                              Manual Check-in
                            </button>
                            <button
                              onClick={() => handleMarkNoShow(p.bookingId)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                            >
                              Mark No-Show
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {scanResult && (
        <ScanResultModal
          result={scanResult}
          onClose={handleCloseScanModal}
        />
      )}

      {manualOverrideBooking && (
        <ManualBoardModal
          isOpen={Boolean(manualOverrideBooking)}
          passenger={manualOverrideBooking}
          journeyId={currentJourney.id}
          onClose={() => setManualOverrideBooking(null)}
          onSuccess={() => setManualOverrideBooking(null)}
        />
      )}

      {incidentModalOpen && (
        <IncidentModal
          isOpen={incidentModalOpen}
          journeyId={currentJourney.id}
          vehicleId={currentJourney.vehicleId || null}
          onClose={() => setIncidentModalOpen(false)}
        />
      )}
    </div>
  );
}
