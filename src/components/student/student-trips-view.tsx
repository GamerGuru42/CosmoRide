"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { formatTime, formatDate } from "@/lib/utils";
import { cancelBooking } from "@/actions/bookings";
import { BoardingPassModal, type BoardingPassData } from "./boarding-pass-modal";
import {
  BusIcon,
  TicketIcon,
  ClockIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  QrCodeIcon,
} from "@/components/ui/icons";

export interface TripItem {
  id: string;
  ticketToken: string | null;
  status: "confirmed" | "checked_in" | "no_show" | "cancelled";
  bookedAt: string;
  cancelledAt: string | null;
  checkedInAt: string | null;
  studentName: string;
  studentId: string | null;
  journey: {
    id: string;
    scheduledDeparture: string;
    status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
    delayMinutes: number;
    delayReason: string | null;
    route: {
      name: string;
      code: string;
    };
    vehicle: {
      name: string | null;
      registrationNumber: string;
    };
    boardingStop: {
      name: string;
    };
  };
}

export interface WaitlistItem {
  id: string;
  position: number;
  status: string;
  createdAt: string;
  journey: {
    id: string;
    scheduledDeparture: string;
    status: string;
    route: {
      name: string;
      code: string;
    };
    vehicle: {
      name: string | null;
      registrationNumber: string;
    };
    boardingStop: {
      name: string;
    };
  };
}

interface StudentTripsViewProps {
  upcomingTrips: TripItem[];
  completedTrips: TripItem[];
  cancelledTrips: TripItem[];
  waitlistItems: WaitlistItem[];
}

export function StudentTripsView({
  upcomingTrips,
  completedTrips,
  cancelledTrips,
  waitlistItems,
}: StudentTripsViewProps) {
  const [activeTab, setActiveTab] = useState<"upcoming" | "waitlist" | "completed" | "cancelled">("upcoming");
  const [selectedPass, setSelectedPass] = useState<BoardingPassData | null>(null);
  const [cancelModalBookingId, setCancelModalBookingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenPass(trip: TripItem) {
    const j = trip.journey;
    setSelectedPass({
      bookingId: trip.id,
      ticketToken: trip.ticketToken,
      status: trip.status,
      studentName: trip.studentName,
      studentId: trip.studentId,
      routeName: j.route.name,
      routeCode: j.route.code,
      originName: j.boardingStop?.name || "Terminal",
      destinationName: "Main Campus",
      pickupStopName: j.boardingStop?.name || "Designated Stop",
      scheduledDeparture: j.scheduledDeparture,
      vehicleName: j.vehicle.name,
      vehicleRegistration: j.vehicle.registrationNumber,
      bookedAt: trip.bookedAt,
    });
  }

  function handleCancelBooking() {
    if (!cancelModalBookingId) return;

    setActionError(null);
    setActionSuccess(null);

    startTransition(async () => {
      const res = await cancelBooking(cancelModalBookingId);
      if (res.success) {
        setActionSuccess(res.message || "Booking cancelled successfully.");
        setCancelModalBookingId(null);
      } else {
        setActionError(res.error || "Failed to cancel booking.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="border-b border-slate-200/80 pb-5">
        <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#102D4A]">
          TRAVEL MANIFEST
        </span>
        <h1 className="text-2xl sm:text-3xl font-black text-[#102D4A] tracking-tight mt-1">
          My Trips
        </h1>
        <p className="text-xs text-[#526B82] mt-0.5">
          Manage your active bookings, digital boarding passes, and waiting list reservations
        </p>
      </div>

      {/* Global Action Messages */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-[#20A477]/10 border border-[#20A477]/30 text-xs font-semibold text-[#102D4A] flex items-center gap-2">
          <CheckCircleIcon className="w-4 h-4 text-[#20A477]" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-xl bg-[#D9534F]/10 border border-[#D9534F]/30 text-xs font-semibold text-[#D9534F] flex items-center gap-2">
          <AlertTriangleIcon className="w-4 h-4 text-[#D9534F]" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-white rounded-xl border border-slate-200 w-full overflow-x-auto shadow-xs">
        <button
          onClick={() => setActiveTab("upcoming")}
          className={`flex-1 min-w-[100px] py-2 px-3 text-xs font-bold rounded-lg transition-all text-center whitespace-nowrap ${
            activeTab === "upcoming"
              ? "bg-[#102D4A] text-white shadow-xs"
              : "text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          Upcoming ({upcomingTrips.length})
        </button>

        <button
          onClick={() => setActiveTab("waitlist")}
          className={`flex-1 min-w-[100px] py-2 px-3 text-xs font-bold rounded-lg transition-all text-center whitespace-nowrap ${
            activeTab === "waitlist"
              ? "bg-[#102D4A] text-white shadow-xs"
              : "text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          Waitlist ({waitlistItems.length})
        </button>

        <button
          onClick={() => setActiveTab("completed")}
          className={`flex-1 min-w-[100px] py-2 px-3 text-xs font-bold rounded-lg transition-all text-center whitespace-nowrap ${
            activeTab === "completed"
              ? "bg-[#102D4A] text-white shadow-xs"
              : "text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          Completed ({completedTrips.length})
        </button>

        <button
          onClick={() => setActiveTab("cancelled")}
          className={`flex-1 min-w-[100px] py-2 px-3 text-xs font-bold rounded-lg transition-all text-center whitespace-nowrap ${
            activeTab === "cancelled"
              ? "bg-[#102D4A] text-white shadow-xs"
              : "text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          Cancelled ({cancelledTrips.length})
        </button>
      </div>

      {/* Tab 1: Upcoming Trips */}
      {activeTab === "upcoming" && (
        <div className="space-y-4">
          {upcomingTrips.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <span className="text-4xl block mb-2">🎫</span>
              <h4 className="text-base font-bold text-[#102D4A]">No Active Trips</h4>
              <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1 mb-5">
                You do not have any confirmed bus bookings right now. View scheduled departures to reserve your seat.
              </p>
              <Link
                href="/student/departures"
                className="px-5 py-2.5 rounded-xl bg-[#102D4A] text-white font-bold text-xs shadow-xs"
              >
                Browse Departures
              </Link>
            </div>
          ) : (
            upcomingTrips.map((trip) => {
              const j = trip.journey;
              const isBoarded = trip.status === "checked_in";

              return (
                <div
                  key={trip.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-5 transition-all hover:border-slate-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-mono font-bold text-slate-700">
                          {j.route.code}
                        </span>
                        <span
                          className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                            isBoarded
                              ? "bg-[#20A477]/10 text-[#20A477] border border-[#20A477]/20"
                              : "bg-[#102D4A]/10 text-[#102D4A] border border-[#102D4A]/20"
                          }`}
                        >
                          {isBoarded ? "BOARDED" : "CONFIRMED"}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-[#102D4A] mt-1">
                        {j.route.name}
                      </h3>
                      <p className="text-xs text-[#526B82] font-mono mt-0.5">
                        Bus: {j.vehicle.registrationNumber} {j.vehicle.name && `(${j.vehicle.name})`}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="text-[10px] uppercase text-[#526B82] tracking-wider font-semibold">
                        DEPARTURE
                      </p>
                      <p className="text-xl font-black font-mono text-[#102D4A]">
                        {formatTime(j.scheduledDeparture)}
                      </p>
                      <p className="text-xs text-[#526B82]">
                        {formatDate(j.scheduledDeparture)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="text-xs text-[#526B82]">
                      <span className="font-semibold text-[#102D4A]">Pickup Point: </span>
                      {j.boardingStop?.name || "Main Terminal Gate"}
                    </div>

                    <div className="flex items-center gap-3">
                      {!isBoarded && (
                        <button
                          onClick={() => setCancelModalBookingId(trip.id)}
                          className="px-3.5 py-2 rounded-xl text-xs font-bold text-[#D9534F] hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors"
                        >
                          Cancel Booking
                        </button>
                      )}

                      <button
                        onClick={() => handleOpenPass(trip)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#102D4A] hover:bg-[#18426C] text-white text-xs font-bold shadow-xs transition-colors"
                      >
                        <QrCodeIcon className="w-3.5 h-3.5" />
                        <span>Boarding Pass</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Waiting List */}
      {activeTab === "waitlist" && (
        <div className="space-y-4">
          {waitlistItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <span className="text-4xl block mb-2">📋</span>
              <h4 className="text-base font-bold text-[#102D4A]">No Active Waitlist Entries</h4>
              <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
                You are not on any waiting lists. When a bus reaches full safe capacity, you can join its queue from the Departure Board.
              </p>
            </div>
          ) : (
            waitlistItems.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-2xl border border-purple-200 shadow-xs p-5 relative overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-mono font-bold">
                        QUEUE POSITION #{item.position}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-purple-700">
                        WAITING LIST
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-[#102D4A] mt-1">
                      {item.journey.route.name}
                    </h3>
                    <p className="text-xs text-[#526B82] font-mono mt-0.5">
                      Bus: {item.journey.vehicle.registrationNumber} • Stop: {item.journey.boardingStop?.name}
                    </p>
                  </div>

                  <div className="text-left sm:text-right">
                    <p className="text-lg font-black font-mono text-[#102D4A]">
                      {formatTime(item.journey.scheduledDeparture)}
                    </p>
                    <p className="text-xs text-[#526B82]">
                      {formatDate(item.journey.scheduledDeparture)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-purple-100 bg-purple-50/50 -mx-5 -mb-5 px-5 py-3 text-xs text-purple-800 flex items-center justify-between">
                  <span>
                    <strong>Automatic Promotion:</strong> You will be issued a confirmed seat automatically if another passenger cancels.
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 3: Completed Trips */}
      {activeTab === "completed" && (
        <div className="space-y-3">
          {completedTrips.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-xs text-[#526B82]">
              No past completed trips on record.
            </div>
          ) : (
            completedTrips.map((trip) => (
              <div
                key={trip.id}
                className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2 font-bold text-[#102D4A]">
                    <span>{trip.journey.route.name}</span>
                    <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 rounded">
                      {trip.journey.route.code}
                    </span>
                  </div>
                  <p className="text-[#526B82] mt-0.5">
                    {formatDate(trip.journey.scheduledDeparture)} at {formatTime(trip.journey.scheduledDeparture)}
                  </p>
                </div>

                <div className="text-right">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-[#526B82]">
                    ARRIVED
                  </span>
                  <p className="text-[10px] font-mono text-slate-400 mt-1">
                    {trip.journey.vehicle.registrationNumber}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 4: Cancelled Trips */}
      {activeTab === "cancelled" && (
        <div className="space-y-3">
          {cancelledTrips.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center text-xs text-[#526B82]">
              No cancelled bookings.
            </div>
          ) : (
            cancelledTrips.map((trip) => (
              <div
                key={trip.id}
                className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between text-xs opacity-75"
              >
                <div>
                  <div className="flex items-center gap-2 font-bold text-[#102D4A]">
                    <span className="line-through">{trip.journey.route.name}</span>
                    <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 rounded">
                      {trip.journey.route.code}
                    </span>
                  </div>
                  <p className="text-[#526B82] mt-0.5">
                    Departure was {formatDate(trip.journey.scheduledDeparture)}
                  </p>
                </div>

                <div className="text-right">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#D9534F]/10 text-[#D9534F]">
                    CANCELLED
                  </span>
                  {trip.cancelledAt && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      {formatDate(trip.cancelledAt)}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Boarding Pass Modal */}
      <BoardingPassModal pass={selectedPass} onClose={() => setSelectedPass(null)} />

      {/* Cancel Confirmation Prompt */}
      {cancelModalBookingId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-full bg-red-100 text-[#D9534F] flex items-center justify-center mx-auto">
              <AlertTriangleIcon className="w-5 h-5" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-bold text-[#102D4A]">
                Cancel Bus Reservation?
              </h3>
              <p className="text-xs text-[#526B82] mt-1 leading-relaxed">
                Your seat will be immediately released to students waiting in queue. This action cannot be reversed.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCancelModalBookingId(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-[#526B82] hover:bg-slate-50 transition-colors"
              >
                Keep Seat
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleCancelBooking}
                className="flex-1 py-2.5 rounded-xl bg-[#D9534F] hover:bg-[#c9302c] text-white text-xs font-bold transition-colors disabled:opacity-50"
              >
                {isPending ? "Releasing..." : "Confirm Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

