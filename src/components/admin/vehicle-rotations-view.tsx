"use client";

import React, { useState, useTransition } from "react";
import { formatTime, formatDate } from "@/lib/utils";
import {
  authorizeVehicleRotationAction,
  confirmRotatedBusReturnAction,
  cancelVehicleRotationAction,
} from "@/actions/rotations";
import {
  BusIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  ClockIcon,
} from "@/components/ui/icons";

export interface RotationMovementItem {
  id: string;
  vehicleId: string;
  vehicleReg: string;
  vehicleName: string | null;
  originName: string;
  destinationName: string;
  sourceJourneyId: string;
  sourceRouteName: string;
  sourceDeparture: string;
  nextJourneyId: string | null;
  nextRouteName: string | null;
  nextDeparture: string | null;
  driverName: string | null;
  status: "planned" | "returning" | "arrived" | "cancelled";
  initiatedAt: string;
  initiatedByName: string;
  arrivedAt: string | null;
  confirmedByName: string | null;
  operationalReason: string;
  cancellationReason: string | null;
  notes: string | null;
}

export interface EligibleJourneyItem {
  id: string;
  routeName: string;
  routeCode: string;
  transportGroupName: string;
  scheduledDeparture: string;
  status: string;
  vehicleId: string | null;
  vehicleReg: string | null;
  driverId: string | null;
  driverName: string | null;
}

export interface VehicleOption {
  id: string;
  registrationNumber: string;
  name: string | null;
  status: string;
  isActive: boolean;
}

export interface DriverOption {
  id: string;
  fullName: string;
  driverReference: string;
}

interface VehicleRotationsViewProps {
  currentDate: string;
  currentUser: {
    id: string;
    fullName: string;
    adminRole?: string | null;
  };
  movements: RotationMovementItem[];
  outboundJourneys: EligibleJourneyItem[];
  destinationJourneys: EligibleJourneyItem[];
  vehicles: VehicleOption[];
  drivers: DriverOption[];
}

export function VehicleRotationsView({
  currentDate,
  currentUser,
  movements,
  outboundJourneys,
  destinationJourneys,
  vehicles,
  drivers,
}: VehicleRotationsViewProps) {
  const isController = currentUser.adminRole === "operations_controller";

  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [selectedNextId, setSelectedNextId] = useState<string>("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [operationalReason, setOperationalReason] = useState<string>("");
  const [returnNotes, setReturnNotes] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancellingMovementId, setCancellingMovementId] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // When source journey changes, auto-select its vehicle if available
  function handleSourceChange(sourceId: string) {
    setSelectedSourceId(sourceId);
    const source = outboundJourneys.find((j) => j.id === sourceId);
    if (source?.vehicleId) {
      setSelectedVehicleId(source.vehicleId);
    }
  }

  // Handle Rotation Authorization
  function handleAuthorizeRotation(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (!isController) {
      setFeedback({
        type: "error",
        text: "Permission denied: Only an Operations Controller can authorize vehicle rotations.",
      });
      return;
    }

    if (!selectedSourceId || !selectedNextId || !selectedVehicleId) {
      setFeedback({
        type: "error",
        text: "Source outbound journey, destination journey, and physical vehicle are mandatory.",
      });
      return;
    }

    if (!operationalReason.trim() || operationalReason.trim().length < 5) {
      setFeedback({
        type: "error",
        text: "Please provide a valid operational reason (minimum 5 characters).",
      });
      return;
    }

    const source = outboundJourneys.find((j) => j.id === selectedSourceId);
    const originName = source ? `${source.routeName} Drop-Off Terminal` : "Hostel Drop-Off Terminal";

    startTransition(async () => {
      const res = await authorizeVehicleRotationAction({
        sourceJourneyId: selectedSourceId,
        nextJourneyId: selectedNextId,
        vehicleId: selectedVehicleId,
        driverRecordId: selectedDriverId || undefined,
        operationalReason: operationalReason.trim(),
        originName,
        destinationName: "Main Campus Central Bus Park",
      });

      if (res.success) {
        setFeedback({
          type: "success",
          text: res.message || "Vehicle rotation authorized. Boarding on destination journey is locked until campus return.",
        });
        setSelectedSourceId("");
        setSelectedNextId("");
        setSelectedVehicleId("");
        setSelectedDriverId("");
        setOperationalReason("");
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to authorize vehicle rotation.",
        });
      }
    });
  }

  // Handle Campus Return Confirmation
  function handleConfirmReturn(movementId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await confirmRotatedBusReturnAction({
        movementId,
        notes: returnNotes.trim() || undefined,
      });

      if (res.success) {
        setFeedback({
          type: "success",
          text: res.message || "Campus return confirmed. Next journey boarding lock released.",
        });
        setReturnNotes("");
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to confirm campus return.",
        });
      }
    });
  }

  // Handle Cancel Rotation
  function handleCancelRotation(movementId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await cancelVehicleRotationAction({
        movementId,
        reason: cancelReason.trim() || "Operational adjustment by Operations Controller",
      });

      if (res.success) {
        setFeedback({
          type: "success",
          text: res.message || "Vehicle rotation cancelled successfully.",
        });
        setCancellingMovementId(null);
        setCancelReason("");
      } else {
        setFeedback({
          type: "error",
          text: res.error || "Failed to cancel rotation.",
        });
      }
    });
  }

  const activeReturning = movements.filter((m) => m.status === "returning" || m.status === "planned");
  const completedToday = movements.filter((m) => m.status === "arrived");

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl bg-[#102D4A] p-6 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-[11px] font-bold text-blue-300">
              <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
              OPERATIONS CONTROLLER CONSOLE
            </span>
            <span className="text-xs text-slate-300 font-mono">
              {formatDate(currentDate)}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Vehicle Rotation &amp; Repositioning
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Controlled authorization for electric buses returning empty from hostel drop-offs to Main Campus for subsequent passenger departures.
          </p>
        </div>

        <div className="rounded-xl bg-white/10 p-3 text-xs min-w-[220px]">
          <div className="text-slate-300">Controller Access:</div>
          <div className="font-bold text-white flex items-center gap-1.5 mt-0.5">
            {isController ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>Authorized (Operations Controller)</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span>Read-Only Oversight ({currentUser.adminRole || "General Admin"})</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-300 mt-1">
            Actor: {currentUser.fullName}
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#526B82]">
              Active Returning
            </span>
            <span className="text-base">🔄</span>
          </div>
          <p className="text-2xl font-black text-amber-600 mt-1">
            {activeReturning.length}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Empty buses in repositioning
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#526B82]">
              Completed Rotations
            </span>
            <span className="text-base">✓</span>
          </div>
          <p className="text-2xl font-black text-emerald-600 mt-1">
            {completedToday.length}
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Returned and boarding released
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#526B82]">
              Boarding Safety Lock
            </span>
            <span className="text-base">🛡️</span>
          </div>
          <p className="text-2xl font-black text-blue-600 mt-1">
            Fail-Closed
          </p>
          <p className="text-[11px] text-[#526B82] mt-0.5">
            Physical return required before boarding
          </p>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`rounded-xl p-4 text-xs font-medium flex items-center justify-between gap-3 ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{feedback.type === "success" ? "✓" : "⚠️"}</span>
            <span>{feedback.text}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-800 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Grid: Authorization Form & Active Movements */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Authorization Form (Operations Controller Only) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 text-xs font-bold">
                  🔄
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[#102D4A]">
                    Authorize Vehicle Rotation
                  </h2>
                  <p className="text-[11px] text-[#526B82]">
                    Assign a returning bus to a subsequent departure
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                Controller Only
              </span>
            </div>

            {!isController ? (
              <div className="p-6 text-center text-xs text-[#526B82] space-y-2">
                <p className="font-semibold text-slate-700">
                  Operations Controller Authorization Required
                </p>
                <p>
                  You are viewing this console under role <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">{currentUser.adminRole || "admin"}</code>. Authorizing vehicle rotations is strictly restricted to designated Operations Controllers.
                </p>
              </div>
            ) : (
              <form onSubmit={handleAuthorizeRotation} className="space-y-4 pt-4">
                {/* 1. Source Outbound Journey */}
                <div>
                  <label className="block text-xs font-bold text-[#102D4A] mb-1">
                    1. Outbound Source Journey (Departed / Completed) *
                  </label>
                  <select
                    value={selectedSourceId}
                    onChange={(e) => handleSourceChange(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select Outbound Trip --</option>
                    {outboundJourneys.map((j) => (
                      <option key={j.id} value={j.id}>
                        {formatTime(j.scheduledDeparture)} — {j.routeName} ({j.vehicleReg || "No Bus"} • {j.status})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[#526B82] mt-0.5">
                    Select the initial trip that delivered passengers to a hostel terminal.
                  </p>
                </div>

                {/* 2. Destination Next Journey */}
                <div>
                  <label className="block text-xs font-bold text-[#102D4A] mb-1">
                    2. Next Passenger Departure (Destination) *
                  </label>
                  <select
                    value={selectedNextId}
                    onChange={(e) => setSelectedNextId(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select Subsequent Journey --</option>
                    {destinationJourneys.map((j) => (
                      <option key={j.id} value={j.id}>
                        {formatTime(j.scheduledDeparture)} — {j.routeName} ({j.transportGroupName})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[#526B82] mt-0.5">
                    Boarding on this departure will be locked until the bus physically returns to campus.
                  </p>
                </div>

                {/* 3. Physical Vehicle */}
                <div>
                  <label className="block text-xs font-bold text-[#102D4A] mb-1">
                    3. Physical Vehicle Assignment *
                  </label>
                  <select
                    value={selectedVehicleId}
                    onChange={(e) => setSelectedVehicleId(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select Electric Bus --</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id} disabled={!v.isActive || v.status !== "available"}>
                        {v.registrationNumber} — {v.name} ({v.status})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 4. Optional Driver for Next Run */}
                <div>
                  <label className="block text-xs font-bold text-[#102D4A] mb-1">
                    4. Assigned Driver for Second Journey (Optional)
                  </label>
                  <select
                    value={selectedDriverId}
                    onChange={(e) => setSelectedDriverId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Keep Existing / Assign Later --</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.fullName} ({d.driverReference})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-[#526B82] mt-0.5">
                    The second journey may have a different driver than the initial outbound trip.
                  </p>
                </div>

                {/* 5. Operational Reason */}
                <div>
                  <label className="block text-xs font-bold text-[#102D4A] mb-1">
                    5. Operational Justification *
                  </label>
                  <textarea
                    value={operationalReason}
                    onChange={(e) => setOperationalReason(e.target.value)}
                    required
                    rows={2}
                    placeholder="e.g., Evening peak demand at Boys' Hostel; repositioning Bus 02 empty after Kado drop-off."
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <BusIcon className="w-4 h-4" />
                  <span>{isPending ? "Authorizing..." : "Authorize Vehicle Rotation"}</span>
                </button>
              </form>
            )}
          </div>

          {/* Operational Policy Callout */}
          <div className="rounded-xl border border-slate-200 bg-[#F6F8FA] p-4 text-xs space-y-2">
            <div className="font-bold text-[#102D4A] flex items-center gap-1.5">
              <span>🛡️</span>
              <span>Controlled Repositioning Safety Rules</span>
            </div>
            <ul className="text-[#526B82] text-[11px] space-y-1 list-disc pl-4">
              <li>Empty repositioning trips never appear on the student Departure Board or FIDS.</li>
              <li>Students cannot book or board empty repositioning movements.</li>
              <li>Representative boarding for the destination journey fails closed until campus return is physically confirmed.</li>
              <li>Bus Manager or Controller confirms physical arrival at Main Campus Central Bus Park.</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Active & Historical Vehicle Movements */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold">
                  🚍
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[#102D4A]">
                    Empty Repositioning Movements
                  </h2>
                  <p className="text-[11px] text-[#526B82]">
                    Physical vehicle ferry trips returning to Main Campus Central Bus Park
                  </p>
                </div>
              </div>
              <span className="text-xs text-[#526B82] font-semibold">
                {movements.length} logged
              </span>
            </div>

            <div className="space-y-3 pt-4">
              {movements.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-[#526B82]">
                  No vehicle rotations or empty repositioning movements recorded today.
                </div>
              ) : (
                movements.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-xl border p-4 transition-all ${
                      m.status === "returning"
                        ? "border-amber-300 bg-amber-50/40"
                        : m.status === "arrived"
                        ? "border-emerald-200 bg-emerald-50/20"
                        : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black text-[#102D4A] bg-white border border-slate-200 px-2.5 py-0.5 rounded-lg shadow-2xs">
                          {m.vehicleReg}
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          {m.originName} → {m.destinationName}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {m.status === "returning" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                            RETURNING EMPTY
                          </span>
                        )}
                        {m.status === "arrived" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            ✓ CAMPUS RETURN CONFIRMED
                          </span>
                        )}
                        {m.status === "cancelled" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                            CANCELLED
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Movement Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#526B82] pt-2">
                      <div>
                        <span>Origin Outbound: </span>
                        <strong className="text-slate-900 font-semibold">{m.sourceRouteName}</strong>
                        {m.sourceDeparture && (
                          <span className="ml-1 text-slate-500 font-mono">({formatTime(m.sourceDeparture)})</span>
                        )}
                      </div>

                      <div>
                        <span>Next Scheduled Run: </span>
                        <strong className="text-slate-900 font-semibold">{m.nextRouteName || "Unassigned"}</strong>
                        {m.nextDeparture && (
                          <span className="ml-1 text-slate-500 font-mono">({formatTime(m.nextDeparture)})</span>
                        )}
                      </div>

                      <div>
                        <span>Authorized By: </span>
                        <span className="text-slate-700 font-medium">{m.initiatedByName}</span>
                        <span className="text-slate-400 font-mono ml-1">({formatTime(m.initiatedAt)})</span>
                      </div>

                      <div>
                        <span>Confirmed By: </span>
                        {m.confirmedByName ? (
                          <span className="text-emerald-800 font-semibold">
                            {m.confirmedByName} {m.arrivedAt ? `(${formatTime(m.arrivedAt)})` : ""}
                          </span>
                        ) : (
                          <span className="text-amber-700 font-semibold">Pending Physical Inspection</span>
                        )}
                      </div>
                    </div>

                    {/* Operational Reason */}
                    <div className="text-[11px] bg-white border border-slate-200 rounded-lg p-2 mt-2 text-slate-700">
                      <span className="font-bold text-[#102D4A]">Reason: </span>
                      {m.operationalReason}
                    </div>

                    {/* Physical Arrival Confirmation Button */}
                    {m.status === "returning" && (
                      <div className="pt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 border-t border-slate-200/80 mt-2">
                        <div className="flex-1">
                          <input
                            type="text"
                            placeholder="Optional return inspection notes (e.g., Bus parked at Bay 3, no issues)"
                            value={returnNotes}
                            onChange={(e) => setReturnNotes(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleConfirmReturn(m.id)}
                            disabled={isPending}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors shadow-2xs flex items-center gap-1"
                          >
                            <CheckCircleIcon className="w-3.5 h-3.5" />
                            <span>Confirm Campus Return</span>
                          </button>

                          {isController && (
                            <button
                              onClick={() => {
                                if (cancellingMovementId === m.id) {
                                  handleCancelRotation(m.id);
                                } else {
                                  setCancellingMovementId(m.id);
                                }
                              }}
                              disabled={isPending}
                              className="px-2.5 py-1.5 border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-lg transition-colors"
                            >
                              {cancellingMovementId === m.id ? "Confirm Cancel?" : "Cancel Rotation"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
