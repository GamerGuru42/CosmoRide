"use client";

import React, { useState, useTransition } from "react";
import { closeAndDepartJourneyAction } from "@/actions/boarding";

interface JourneyClosureModalProps {
  journeyId: string;
  routeCode: string;
  routeName: string;
  busRegistration: string;
  boardedCount: number;
  confirmedCount: number; // unboarded confirmed
  capacityCeiling: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function JourneyClosureModal({
  journeyId,
  routeCode,
  routeName,
  busRegistration,
  boardedCount,
  confirmedCount,
  capacityCeiling,
  isOpen,
  onClose,
  onSuccess,
}: JourneyClosureModalProps) {
  const [markNoShow, setMarkNoShow] = useState<boolean>(true);
  const [notes, setNotes] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  function handleConfirmClosure() {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await closeAndDepartJourneyAction(
        journeyId,
        markNoShow,
        notes.trim() || undefined
      );

      if (res.success) {
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMessage(res.error || "Failed to close and depart journey.");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm Journey Gate Closure"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#102D4A] px-6 py-5 text-white">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🚌</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              BOARDING GATE CLOSURE
            </span>
          </div>
          <h3 className="text-lg font-bold">
            Depart Bus {busRegistration}
          </h3>
          <p className="text-xs text-slate-300">
            {routeCode} • {routeName}
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {errorMessage && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 font-medium">
              {errorMessage}
            </div>
          )}

          {/* Operational Count Cards */}
          <div className="grid grid-cols-3 gap-2.5 text-center">
            <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3">
              <span className="text-[10px] font-bold text-[#526B82] uppercase block">
                Boarded
              </span>
              <span className="text-xl font-extrabold text-[#20A477]">
                {boardedCount}
              </span>
              <span className="text-[10px] text-[#526B82] block">
                of {capacityCeiling} max
              </span>
            </div>

            <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3">
              <span className="text-[10px] font-bold text-[#526B82] uppercase block">
                Unboarded
              </span>
              <span className={`text-xl font-extrabold ${confirmedCount > 0 ? "text-[#E5A13B]" : "text-[#526B82]"}`}>
                {confirmedCount}
              </span>
              <span className="text-[10px] text-[#526B82] block">
                pending
              </span>
            </div>

            <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-3">
              <span className="text-[10px] font-bold text-[#526B82] uppercase block">
                Empty Seats
              </span>
              <span className="text-xl font-extrabold text-[#102D4A]">
                {Math.max(0, capacityCeiling - boardedCount)}
              </span>
              <span className="text-[10px] text-[#526B82] block">
                vacant
              </span>
            </div>
          </div>

          {/* Unboarded Passenger Warning & No-Show Action */}
          {confirmedCount > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 text-sm mt-0.5">⚠️</span>
                <div className="text-xs text-amber-900 leading-relaxed">
                  <strong>{confirmedCount} student(s)</strong> reserved a seat but have not checked in.
                </div>
              </div>

              <label className="flex items-center gap-2.5 pt-1 text-xs font-semibold text-amber-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={markNoShow}
                  onChange={(e) => setMarkNoShow(e.target.checked)}
                  className="rounded text-[#102D4A] focus:ring-0 h-4 w-4"
                />
                Mark unboarded confirmed students as No-Show
              </label>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 font-semibold text-center">
              ✓ All confirmed passengers accounted for.
            </div>
          )}

          {/* Operational Closure Notes */}
          <div>
            <label
              htmlFor="closure-notes"
              className="block text-xs font-bold text-[#526B82] uppercase tracking-wider mb-1"
            >
              Closure Notes (Optional)
            </label>
            <input
              id="closure-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Departed on schedule, 0 incidents"
              className="w-full text-xs bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
            />
          </div>

          {/* Warning Banner */}
          <p className="text-[11px] text-[#526B82] leading-relaxed">
            Departing this journey transitions status to <strong>In Transit</strong>. Passenger check-ins will close permanently.
          </p>

          {/* Action Buttons */}
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
              type="button"
              onClick={handleConfirmClosure}
              disabled={isPending}
              className="flex-1 py-2.5 text-xs font-bold text-white bg-[#102D4A] hover:bg-[#0b1f33] rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              {isPending ? "Closing Gate..." : "Close & Depart Bus"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

