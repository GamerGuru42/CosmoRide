"use client";

import React, { useEffect, useState } from "react";
import type { BoardingStatusCode } from "@/actions/boarding";

export interface ScanResultPayload {
  code: BoardingStatusCode | "INVALID";
  message: string;
  passengerName?: string;
  studentId?: string;
  passengerCategory?: "seated" | "standing" | null;
  boardedCount?: number;
  capacity?: number;
  busRegistration?: string;
  originalScanAt?: string;
  routeCode?: string;
  stopName?: string;
}

interface ScanResultModalProps {
  result: ScanResultPayload | null;
  onClose: () => void;
  autoAdvance?: boolean;
}

export function ScanResultModal({
  result,
  onClose,
  autoAdvance = true,
}: ScanResultModalProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(3);

  useEffect(() => {
    if (!result) return;

    // Only auto-advance on successful verification
    if (result.code !== "VALID" || !autoAdvance) {
      return;
    }

    setSecondsRemaining(3);
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [result, autoAdvance, onClose]);

  // Keyboard shortcut: Escape or Enter closes
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "Enter") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!result) return null;

  // Determine visual configuration based on the 6 standard verification states
  const config = getStatusConfig(result.code);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan Verification Result"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        className={`w-full max-w-md rounded-2xl overflow-hidden shadow-2xl bg-white border-4 ${config.borderColor} transition-all`}
      >
        {/* Banner Header */}
        <div className={`${config.bannerBg} px-6 py-6 text-white text-center relative`}>
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-xs">
            <span className="text-3xl" aria-hidden="true">
              {config.icon}
            </span>
          </div>
          <span className="inline-block text-[11px] font-bold tracking-widest uppercase bg-black/25 px-3 py-1 rounded-full mb-1">
            {config.badge}
          </span>
          <h2 className="text-xl font-extrabold tracking-tight">
            {config.headline}
          </h2>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* Passenger Identity Block (when available) */}
          {result.passengerName ? (
            <div className="bg-[#F6F8FA] border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-xs font-semibold text-[#526B82] uppercase tracking-wider">
                Passenger
              </p>
              <p className="text-lg font-bold text-[#102D4A] mt-0.5">
                {result.passengerName}
              </p>
              {result.studentId && (
                <p className="text-xs font-mono font-medium text-[#526B82] mt-0.5">
                  ID: {result.studentId}
                </p>
              )}
              {result.passengerCategory && (
                <div className="mt-2.5">
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      result.passengerCategory === "standing"
                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                        : "bg-emerald-100 text-emerald-900 border border-emerald-300"
                    }`}
                  >
                    {result.passengerCategory === "standing" ? "Standing Place (10 max)" : "Seated Place (20 max)"}
                  </span>
                </div>
              )}
            </div>
          ) : null}

          {/* Detailed Message / Reason */}
          <div className={`p-4 rounded-xl text-sm ${config.messageBoxStyle}`}>
            <p className="font-semibold text-center leading-relaxed">
              {result.message}
            </p>
          </div>

          {/* Operational Details (Capacity & Vehicle) */}
          {(result.boardedCount !== undefined || result.busRegistration) && (
            <div className="grid grid-cols-2 gap-3 pt-1 text-center">
              {result.boardedCount !== undefined && result.capacity !== undefined && (
                <div className="bg-[#F6F8FA] rounded-lg p-2.5 border border-slate-200">
                  <span className="text-[10px] font-bold text-[#526B82] uppercase block">
                    Journey Capacity
                  </span>
                  <span className="text-base font-extrabold text-[#102D4A]">
                    {result.boardedCount} / {result.capacity}
                  </span>
                </div>
              )}
              {result.busRegistration && (
                <div className="bg-[#F6F8FA] rounded-lg p-2.5 border border-slate-200">
                  <span className="text-[10px] font-bold text-[#526B82] uppercase block">
                    Bus Assigned
                  </span>
                  <span className="text-base font-extrabold text-[#102D4A]">
                    {result.busRegistration}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Action Button */}
          <div className="pt-2">
            <button
              onClick={onClose}
              autoFocus
              className={`w-full py-3.5 px-4 rounded-xl text-sm font-bold text-white shadow-md transition-all active:scale-[0.98] ${config.buttonBg} hover:opacity-95 focus:outline-none focus:ring-4 focus:ring-offset-2 ${config.ringColor}`}
            >
              {result.code === "VALID" && autoAdvance ? (
                <span>
                  Scan Next Passenger (auto in {secondsRemaining}s)
                </span>
              ) : (
                <span>Dismiss & Return to Scanner</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStatusConfig(code: BoardingStatusCode | "INVALID") {
  switch (code) {
    case "VALID":
      return {
        badge: "AUTHORISED BOARDING",
        headline: "VERIFIED & BOARDED",
        icon: "✓",
        bannerBg: "bg-[#20A477]",
        borderColor: "border-[#20A477]",
        messageBoxStyle: "bg-emerald-50 text-emerald-900 border border-emerald-200",
        buttonBg: "bg-[#20A477]",
        ringColor: "focus:ring-emerald-300",
      };

    case "ALREADY_BOARDED":
      return {
        badge: "DUPLICATE SCAN PREVENTED",
        headline: "ALREADY BOARDED",
        icon: "⚠️",
        bannerBg: "bg-[#E5A13B]",
        borderColor: "border-[#E5A13B]",
        messageBoxStyle: "bg-amber-50 text-amber-900 border border-amber-200",
        buttonBg: "bg-[#E5A13B]",
        ringColor: "focus:ring-amber-300",
      };

    case "WRONG_JOURNEY":
      return {
        badge: "CORRIDOR / ROUTE MISMATCH",
        headline: "WRONG BUS OR JOURNEY",
        icon: "🚌",
        bannerBg: "bg-[#D9534F]",
        borderColor: "border-[#D9534F]",
        messageBoxStyle: "bg-rose-50 text-rose-900 border border-rose-200",
        buttonBg: "bg-[#102D4A]",
        ringColor: "focus:ring-slate-300",
      };

    case "CANCELLED":
      return {
        badge: "RESERVATION VOID",
        headline: "BOOKING CANCELLED",
        icon: "🚫",
        bannerBg: "bg-[#526B82]",
        borderColor: "border-[#526B82]",
        messageBoxStyle: "bg-slate-100 text-slate-800 border border-slate-300",
        buttonBg: "bg-[#526B82]",
        ringColor: "focus:ring-slate-300",
      };

    case "CROSS_GROUP_DENIED":
      return {
        badge: "SECURITY RESTRICTION",
        headline: "CROSS-GROUP ACCESS DENIED",
        icon: "🔒",
        bannerBg: "bg-[#D9534F]",
        borderColor: "border-[#D9534F]",
        messageBoxStyle: "bg-rose-50 text-rose-900 border border-rose-200",
        buttonBg: "bg-[#102D4A]",
        ringColor: "focus:ring-slate-300",
      };

    case "CAPACITY_EXCEEDED":
      return {
        badge: "SAFETY LIMIT",
        headline: "BUS CAPACITY REACHED",
        icon: "⛔",
        bannerBg: "bg-[#D9534F]",
        borderColor: "border-[#D9534F]",
        messageBoxStyle: "bg-rose-50 text-rose-900 border border-rose-200",
        buttonBg: "bg-[#102D4A]",
        ringColor: "focus:ring-slate-300",
      };

    case "INVALID_TICKET":
    case "INVALID":
      return {
        badge: "INVALID TICKET",
        headline: "UNRECOGNIZED PASS",
        icon: "✕",
        bannerBg: "bg-[#D9534F]",
        borderColor: "border-[#D9534F]",
        messageBoxStyle: "bg-rose-50 text-rose-900 border border-rose-200",
        buttonBg: "bg-[#102D4A]",
        ringColor: "focus:ring-slate-300",
      };

    case "JOURNEY_CLOSED":
    case "UNAUTHORIZED":
    case "SERVER_ERROR":
    default:
      return {
        badge: "VERIFICATION HALTED",
        headline: "UNABLE TO VERIFY",
        icon: "⚠️",
        bannerBg: "bg-[#D9534F]",
        borderColor: "border-[#D9534F]",
        messageBoxStyle: "bg-rose-50 text-rose-900 border border-rose-200",
        buttonBg: "bg-[#102D4A]",
        ringColor: "focus:ring-slate-300",
      };
  }
}

