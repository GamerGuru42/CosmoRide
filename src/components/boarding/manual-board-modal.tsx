"use client";

import React, { useState, useTransition } from "react";
import { boardPassengerManualOverride } from "@/actions/boarding";
import type { BoardingPassenger } from "./boarding-scanner-view";

interface ManualBoardModalProps {
  passenger: BoardingPassenger | null;
  journeyId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (studentName: string) => void;
}

export function ManualBoardModal({
  passenger,
  journeyId,
  isOpen,
  onClose,
  onSuccess,
}: ManualBoardModalProps) {
  const [reason, setReason] = useState<string>("Verified physical university ID card");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen || !passenger) return null;

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (reason.trim().length < 5) {
      setErrorMessage("Please provide a valid auditable reason (min 5 characters).");
      return;
    }

    startTransition(async () => {
      if (!passenger) return;
      const res = await boardPassengerManualOverride(
        passenger.bookingId,
        journeyId,
        reason.trim()
      );

      if (res.success) {
        onSuccess(passenger.studentName);
        onClose();
      } else {
        setErrorMessage(res.error || "Manual boarding override failed.");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Auditable Manual Boarding Override"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#102D4A] px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🪪</span>
            <div>
              <h3 className="text-base font-bold">Manual Boarding Override</h3>
              <p className="text-xs text-slate-300">Audited exception log</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-slate-300 hover:text-white text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleConfirm} className="p-6 space-y-4">
          {errorMessage && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 font-medium">
              {errorMessage}
            </div>
          )}

          {/* Passenger Details */}
          <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-4 space-y-1">
            <div className="text-[10px] font-bold text-[#526B82] uppercase">
              Student Details
            </div>
            <div className="text-sm font-bold text-[#102D4A]">
              {passenger.studentName}
            </div>
            {passenger.studentMatric && (
              <div className="text-xs font-mono text-[#526B82]">
                Matric / ID: {passenger.studentMatric}
              </div>
            )}
            <div className="text-xs text-[#526B82] pt-1">
              Stop: <span className="font-semibold">{passenger.boardingStopName}</span>
            </div>
          </div>

          {/* Justification input */}
          <div>
            <label
              htmlFor="override-reason"
              className="block text-xs font-bold text-[#526B82] uppercase tracking-wider mb-1.5"
            >
              Auditable Exception Justification
            </label>
            <input
              id="override-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Verified physical university ID card"
              className="w-full text-xs bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
            />
            <p className="text-[10px] text-[#526B82] mt-1">
              This action is logged in university audit logs with your officer ID.
            </p>
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
              className="flex-1 py-2.5 text-xs font-bold text-white bg-[#20A477] hover:bg-[#1a8560] rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              {isPending ? "Recording Boarding..." : "Verify & Board Student"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

