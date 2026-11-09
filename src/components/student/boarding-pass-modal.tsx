"use client";

import React from "react";
import { QrCode } from "@/components/ui/qr-code";
import { formatTime, formatDate } from "@/lib/utils";
import { APP_NAME, UNIVERSITY_NAME } from "@/lib/constants";
import { BusIcon } from "@/components/ui/icons";

export interface BoardingPassData {
  bookingId: string;
  ticketToken: string | null;
  status: "confirmed" | "checked_in" | "no_show" | "cancelled" | "expired";
  studentName: string;
  studentId: string | null;
  routeName: string;
  routeCode: string;
  originName: string;
  destinationName: string;
  pickupStopName: string;
  scheduledDeparture: string;
  vehicleName: string | null;
  vehicleRegistration: string;
  bookedAt: string;
}

interface BoardingPassModalProps {
  pass: BoardingPassData | null;
  onClose: () => void;
}

export function BoardingPassModal({ pass, onClose }: BoardingPassModalProps) {
  if (!pass) return null;

  // The QR payload is strictly opaque - NO PII
  const qrPayload = JSON.stringify({
    token: pass.ticketToken || "TICKET_PENDING",
    booking_id: pass.bookingId,
  });

  const isBoarded = pass.status === "checked_in";
  const isCancelled = pass.status === "cancelled";
  const isExpired = pass.status === "expired" || pass.status === "no_show";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-sm font-bold transition-colors"
          aria-label="Close Boarding Pass"
        >
          ✕
        </button>

        {/* Top Header Section (Midnight Navy) */}
        <div className="bg-[#102D4A] text-white p-6 pb-8 relative">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-mono tracking-widest text-[#20A477] font-bold">
                BOARDING PASS
              </span>
              <h3 className="text-xl font-black tracking-wider text-white font-mono">
                {APP_NAME}
              </h3>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-300 block">Status</span>
              <span
                className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  isBoarded
                    ? "bg-[#20A477] text-white"
                    : isCancelled
                    ? "bg-[#D9534F] text-white"
                    : isExpired
                    ? "bg-slate-500 text-white"
                    : "bg-[#20A477]/20 text-[#20A477] border border-[#20A477]"
                }`}
              >
                {isBoarded ? "BOARDED" : isCancelled ? "CANCELLED" : isExpired ? "EXPIRED" : "CONFIRMED"}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-300 mt-1">
            {UNIVERSITY_NAME}
          </p>

          {/* Route Display */}
          <div className="mt-6 flex items-center justify-between">
            <div className="flex-1">
              <p className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">
                ORIGIN
              </p>
              <p className="text-base font-bold text-white leading-tight truncate">
                {pass.originName}
              </p>
            </div>

            <div className="px-3 flex flex-col items-center">
              <BusIcon className="w-5 h-5 text-[#20A477]" />
              <div className="w-12 h-0.5 bg-slate-500/50 mt-1" />
            </div>

            <div className="flex-1 text-right">
              <p className="text-[10px] uppercase text-slate-400 font-semibold tracking-wider">
                DESTINATION
              </p>
              <p className="text-base font-bold text-white leading-tight truncate">
                {pass.destinationName}
              </p>
            </div>
          </div>
        </div>

        {/* Perforation Line with Side Notches */}
        <div className="relative bg-white flex items-center justify-between px-2 -my-2.5 z-10">
          <div className="w-5 h-5 rounded-full bg-black/60 -ml-5 shadow-inner" />
          <div className="flex-1 border-t-2 border-dashed border-slate-300 mx-2" />
          <div className="w-5 h-5 rounded-full bg-black/60 -mr-5 shadow-inner" />
        </div>

        {/* Details Section */}
        <div className="p-6 pt-5 bg-white space-y-4">
          <div className="grid grid-cols-2 gap-4 text-left">
            <div>
              <p className="text-[10px] uppercase text-[#526B82] font-semibold tracking-wider">
                PASSENGER
              </p>
              <p className="text-sm font-bold text-[#102D4A] truncate">
                {pass.studentName}
              </p>
              {pass.studentId && (
                <p className="text-[11px] font-mono text-[#526B82]">
                  {pass.studentId}
                </p>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase text-[#526B82] font-semibold tracking-wider">
                DEPARTURE
              </p>
              <p className="text-base font-black font-mono text-[#102D4A]">
                {formatTime(pass.scheduledDeparture)}
              </p>
              <p className="text-[11px] text-[#526B82]">
                {formatDate(pass.scheduledDeparture)}
              </p>
            </div>

            <div>
              <p className="text-[10px] uppercase text-[#526B82] font-semibold tracking-wider">
                PICKUP STOP
              </p>
              <p className="text-xs font-semibold text-[#102D4A] truncate">
                {pass.pickupStopName}
              </p>
            </div>

            <div>
              <p className="text-[10px] uppercase text-[#526B82] font-semibold tracking-wider">
                VEHICLE
              </p>
              <p className="text-xs font-bold text-[#102D4A]">
                {pass.vehicleRegistration}
              </p>
              {pass.vehicleName && (
                <p className="text-[10px] text-[#526B82] truncate">
                  {pass.vehicleName}
                </p>
              )}
            </div>
          </div>

          {/* QR Code Presentation Box */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col items-center justify-center text-center">
            {isCancelled ? (
              <div className="py-8 text-center text-[#D9534F]">
                <p className="font-bold text-sm">Ticket Cancelled</p>
                <p className="text-xs text-[#526B82] mt-1">
                  This boarding pass is no longer valid for travel.
                </p>
              </div>
            ) : (
              <>
                <QrCode value={qrPayload} size={150} />
                <p className="text-[10px] font-mono text-[#526B82] mt-2 tracking-wider">
                  REF: #{pass.bookingId.slice(0, 8).toUpperCase()}
                </p>
                <p className="text-[11px] text-[#526B82] mt-1">
                  Present this QR code to the Boarding Officer at pickup.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="bg-[#F6F8FA] border-t border-slate-100 px-6 py-3 flex items-center justify-between text-[10px] text-[#526B82]">
          <span>Route: {pass.routeCode}</span>
          <button
            onClick={onClose}
            className="font-semibold text-[#102D4A] hover:underline"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

