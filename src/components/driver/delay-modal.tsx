"use client";

import React, { useState, useTransition } from "react";
import { reportOperationalDelayAction } from "@/actions/driver";

interface DelayModalProps {
  journeyId: string;
  routeCode: string;
  routeName: string;
  isOpen: boolean;
  onClose: () => void;
  isAssisted?: boolean;
  onSuccess?: () => void;
}

const DELAY_REASONS = [
  { value: "Traffic congestion", label: "Traffic Congestion / Heavy Gridlock" },
  { value: "Previous journey running late", label: "Previous Journey Turnaround Delay" },
  { value: "Road obstruction", label: "Road Construction / Obstruction" },
  { value: "Mechanical issue", label: "Minor Technical / Mechanical Check" },
  { value: "Weather conditions", label: "Adverse Weather / Heavy Downpour" },
  { value: "Other operational delay", label: "Other Operational Reason" },
];

export function DelayModal({
  journeyId,
  routeCode,
  routeName,
  isOpen,
  onClose,
  isAssisted = false,
  onSuccess,
}: DelayModalProps) {
  const [delayMinutes, setDelayMinutes] = useState<number>(15);
  const [delayReason, setDelayReason] = useState<string>(DELAY_REASONS[0].value);
  const [notes, setNotes] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    startTransition(async () => {
      const res = await reportOperationalDelayAction({
        journeyId,
        delayMinutes,
        delayReason,
        notes: notes.trim() || undefined,
        isAssisted,
      });

      if (res.success) {
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMessage(res.error || "Failed to submit delay report.");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report Operational Delay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#102D4A] px-6 py-4 text-white flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">⏱️</span>
              <h3 className="text-base font-bold">Report Schedule Delay</h3>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              {routeCode} • {routeName} {isAssisted && "(Assisted by Representative)"}
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
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 font-medium">
              {errorMessage}
            </div>
          )}

          {/* Quick Duration Buttons */}
          <div>
            <label className="block text-[10px] font-bold text-[#526B82] uppercase tracking-wider mb-2">
              Delay Duration (Minutes)
            </label>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {[5, 10, 15, 25].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDelayMinutes(mins)}
                  className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                    delayMinutes === mins
                      ? "bg-[#102D4A] text-white border-[#102D4A]"
                      : "bg-[#F6F8FA] text-[#102D4A] border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  +{mins} min
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="120"
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 text-center text-sm font-bold bg-[#F6F8FA] border border-slate-300 rounded-xl py-2 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
              />
              <span className="text-xs text-[#526B82]">minutes delay</span>
            </div>
          </div>

          {/* Reason Selection */}
          <div>
            <label
              htmlFor="delay-reason"
              className="block text-[10px] font-bold text-[#526B82] uppercase tracking-wider mb-1.5"
            >
              Primary Operational Cause
            </label>
            <select
              id="delay-reason"
              value={delayReason}
              onChange={(e) => setDelayReason(e.target.value)}
              className="w-full text-xs font-semibold bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
            >
              {DELAY_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Additional Notes */}
          <div>
            <label
              htmlFor="delay-notes"
              className="block text-[10px] font-bold text-[#526B82] uppercase tracking-wider mb-1.5"
            >
              Passenger Advisory Notes (Optional)
            </label>
            <input
              id="delay-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cleared police checkpoint; moving towards Kado"
              className="w-full text-xs bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
            />
          </div>

          {/* Notification Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
            <span className="text-amber-600 mt-0.5">🔔</span>
            <p className="leading-relaxed">
              Submitting this update will automatically alert all confirmed students and display an advisory banner on the departure board.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-2.5 pt-1">
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
              className="flex-1 py-2.5 text-xs font-bold text-white bg-[#E5A13B] hover:bg-[#d49028] text-[#102D4A] rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              {isPending ? "Broadcasting..." : "Broadcast Delay Notice"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

