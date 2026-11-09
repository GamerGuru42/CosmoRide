"use client";

import React, { useState, useTransition } from "react";
import { recordVehicleReadinessAction } from "@/actions/driver";

interface ReadinessModalProps {
  journeyId: string;
  vehicleRegistration: string;
  routeCode: string;
  isOpen: boolean;
  onClose: () => void;
  isAssisted?: boolean;
  onSuccess?: () => void;
}

export function ReadinessModal({
  journeyId,
  vehicleRegistration,
  routeCode,
  isOpen,
  onClose,
  isAssisted = false,
  onSuccess,
}: ReadinessModalProps) {
  const [vehicleAvailable, setVehicleAvailable] = useState<boolean>(true);
  const [vehicleSafe, setVehicleSafe] = useState<boolean>(true);
  const [mechanicalFault, setMechanicalFault] = useState<boolean>(false);
  const [faultDescription, setFaultDescription] = useState<string>("");
  const [journeyReviewed, setJourneyReviewed] = useState<boolean>(true);
  const [batteryLevel, setBatteryLevel] = useState<number>(85);
  const [tiresAndLights, setTiresAndLights] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>("");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (mechanicalFault && faultDescription.trim().length < 5) {
      setErrorMessage("Please describe the mechanical fault (min 5 characters).");
      return;
    }

    startTransition(async () => {
      const res = await recordVehicleReadinessAction({
        journeyId,
        vehicleAvailable,
        vehicleSafe,
        mechanicalFault,
        faultDescription: faultDescription.trim() || undefined,
        journeyReviewed,
        batteryLevel,
        tiresAndLights,
        notes: notes.trim() || undefined,
        isAssisted,
      });

      if (res.success) {
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMessage(res.error || "Failed to record readiness check.");
      }
    });
  }

  const isUnsafe = !vehicleSafe || !vehicleAvailable || (mechanicalFault && !vehicleSafe);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pre-Departure Vehicle Readiness Checklist"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#102D4A] px-6 py-4 text-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🛠️</span>
              <h3 className="text-base font-bold">
                Pre-Trip Readiness Checklist
              </h3>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Bus {vehicleRegistration} • {routeCode} {isAssisted && "(Assisted by Representative)"}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-slate-300 hover:text-white text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 font-medium">
              {errorMessage}
            </div>
          )}

          {/* Safety Status Warning */}
          {isUnsafe && (
            <div className="rounded-xl bg-rose-50 border border-rose-300 p-3.5 text-xs text-rose-900 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <span>⛔</span>
                <span>SAFETY ESCALATION NOTICE</span>
              </div>
              <p>
                Marking this vehicle as unsafe or unavailable will <strong>block passenger boarding and departure</strong> and immediately alert transport administration.
              </p>
            </div>
          )}

          {/* Verification Items */}
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={vehicleAvailable}
                onChange={(e) => setVehicleAvailable(e.target.checked)}
                className="mt-0.5 rounded text-[#102D4A] focus:ring-0 h-4 w-4"
              />
              <div className="text-xs">
                <span className="font-bold text-[#102D4A] block">Vehicle Physically Available</span>
                <span className="text-[#526B82]">Bus is positioned at the authorized staging terminal.</span>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={vehicleSafe}
                onChange={(e) => setVehicleSafe(e.target.checked)}
                className="mt-0.5 rounded text-[#102D4A] focus:ring-0 h-4 w-4"
              />
              <div className="text-xs">
                <span className="font-bold text-[#102D4A] block">Vehicle Safe for Passenger Carriage</span>
                <span className="text-[#526B82]">Brakes, steering, doors, and emergency exits verified functional.</span>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={tiresAndLights}
                onChange={(e) => setTiresAndLights(e.target.checked)}
                className="mt-0.5 rounded text-[#102D4A] focus:ring-0 h-4 w-4"
              />
              <div className="text-xs">
                <span className="font-bold text-[#102D4A] block">Tires, Mirrors & Lights Inspected</span>
                <span className="text-[#526B82]">Tire pressure adequate; headlamps and indicators operational.</span>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={journeyReviewed}
                onChange={(e) => setJourneyReviewed(e.target.checked)}
                className="mt-0.5 rounded text-[#102D4A] focus:ring-0 h-4 w-4"
              />
              <div className="text-xs">
                <span className="font-bold text-[#102D4A] block">Route & Stop Sequence Reviewed</span>
                <span className="text-[#526B82]">Departure timetable and pickup sequence confirmed.</span>
              </div>
            </label>
          </div>

          {/* Electric Bus Battery Charge Level */}
          <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-[#102D4A]">
              <span>Electric Bus Battery Level</span>
              <span className="font-mono text-emerald-700 font-extrabold">{batteryLevel}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={batteryLevel}
              onChange={(e) => setBatteryLevel(Number(e.target.value))}
              className="w-full accent-[#20A477] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#526B82]">
              <span>Min Required: 25%</span>
              <span>Full: 100%</span>
            </div>
          </div>

          {/* Mechanical Fault Toggle */}
          <div className="border border-slate-200 rounded-xl p-3.5 space-y-2">
            <label className="flex items-center justify-between text-xs font-bold text-[#102D4A] cursor-pointer">
              <span>Report Mechanical Fault / Defect</span>
              <input
                type="checkbox"
                checked={mechanicalFault}
                onChange={(e) => setMechanicalFault(e.target.checked)}
                className="rounded text-[#D9534F] focus:ring-0 h-4 w-4"
              />
            </label>

            {mechanicalFault && (
              <div className="pt-2 space-y-1">
                <label
                  htmlFor="fault-desc"
                  className="block text-[10px] font-bold text-[#526B82] uppercase"
                >
                  Fault Description
                </label>
                <textarea
                  id="fault-desc"
                  value={faultDescription}
                  onChange={(e) => setFaultDescription(e.target.value)}
                  placeholder="Describe fault (e.g. AC failure, indicator lamp blown, brake pressure warning)..."
                  rows={2}
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-300 bg-white text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="readiness-notes"
              className="block text-[10px] font-bold text-[#526B82] uppercase tracking-wider mb-1"
            >
              Additional Inspection Notes (Optional)
            </label>
            <input
              id="readiness-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cleaned interior; verified fire extinguisher present"
              className="w-full text-xs bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="flex-1 py-2.5 text-xs font-bold text-[#526B82] bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className={`flex-1 py-2.5 text-xs font-bold text-white rounded-xl shadow-xs transition-colors disabled:opacity-50 ${
                isUnsafe
                  ? "bg-[#D9534F] hover:bg-rose-700"
                  : "bg-[#20A477] hover:bg-[#1a8560]"
              }`}
            >
              {isPending
                ? "Submitting Checklist..."
                : isUnsafe
                ? "Flag Vehicle as Unsafe"
                : "Pass Readiness & Approve"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

