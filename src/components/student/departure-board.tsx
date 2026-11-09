"use client";

import React, { useState, useMemo, useTransition } from "react";
import { formatTime, formatDate, calculateAvailableSeats, getTodayDateString } from "@/lib/utils";
import { DEPARTURE_STATUS_CONFIG } from "@/lib/constants";
import { bookSeat } from "@/actions/bookings";
import { BusIcon, ClockIcon, AlertTriangleIcon, CheckCircleIcon } from "@/components/ui/icons";

export interface DepartureStop {
  id: string;
  name: string;
  order: number;
  estimatedMinutesFromStart: number;
}

export interface DepartureJourney {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  actualDeparture: string | null;
  status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
  delayMinutes: number;
  delayReason: string | null;
  proposedAllocation: number;
  safeCapacity: number;
  bookedCount: number;
  routeId: string;
  routeName: string;
  routeCode: string;
  originName: string;
  destinationName: string;
  transportGroupName?: string;
  genderGroup?: string;
  vehicleRegistration: string;
  vehicleName: string | null;
  stops: DepartureStop[];
  userBookingId?: string | null;
  userWaitlistPosition?: number | null;
  latestStopUpdate?: {
    eventType: string;
    stopName: string;
    timestamp: string;
    isAssisted: boolean;
  } | null;
}

interface DepartureBoardProps {
  journeys: DepartureJourney[];
  currentUserId?: string;
  onBookingSuccess?: () => void;
}

export function DepartureBoard({ journeys, currentUserId, onBookingSuccess }: DepartureBoardProps) {
  // Filters
  const [selectedDate, setSelectedDate] = useState<string>("today");
  const [selectedRouteFilter, setSelectedRouteFilter] = useState<string>("all");
  const [activeBookingJourney, setActiveBookingJourney] = useState<DepartureJourney | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string>("");
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingSuccessMessage, setBookingSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const todayStr = useMemo(() => getTodayDateString(), []);
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getTodayDateString(d);
  }, []);

  // Filtered journeys
  const filteredJourneys = useMemo(() => {
    return journeys.filter((j) => {
      // Date filter
      if (selectedDate === "today" && j.journeyDate !== todayStr) return false;
      if (selectedDate === "tomorrow" && j.journeyDate !== tomorrowStr) return false;

      // Route filter
      if (selectedRouteFilter !== "all" && j.routeCode !== selectedRouteFilter && j.genderGroup !== selectedRouteFilter) {
        return false;
      }

      return true;
    });
  }, [journeys, selectedDate, selectedRouteFilter, todayStr, tomorrowStr]);

  // Handle open booking modal
  function handleOpenBooking(journey: DepartureJourney) {
    setBookingError(null);
    setBookingSuccessMessage(null);
    setActiveBookingJourney(journey);
    setSelectedStopId(journey.stops[0]?.id ?? "");
  }

  // Submit booking
  function handleConfirmBooking() {
    if (!activeBookingJourney || !selectedStopId) return;

    setBookingError(null);
    startTransition(async () => {
      const res = await bookSeat(activeBookingJourney.id, selectedStopId);
      if (res.success) {
        setBookingSuccessMessage(res.message || "Booking confirmed successfully.");
        if (onBookingSuccess) onBookingSuccess();
      } else {
        setBookingError(res.error || "Failed to complete reservation.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Flight Information Display System (FIDS) Controls & Filter Header */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Date Segment Filter */}
          <div className="flex items-center gap-1.5 p-1 bg-[#F6F8FA] rounded-lg border border-slate-200 w-fit">
            <button
              onClick={() => setSelectedDate("today")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                selectedDate === "today"
                  ? "bg-[#102D4A] text-white shadow-xs"
                  : "text-[#526B82] hover:text-[#102D4A]"
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setSelectedDate("tomorrow")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                selectedDate === "tomorrow"
                  ? "bg-[#102D4A] text-white shadow-xs"
                  : "text-[#526B82] hover:text-[#102D4A]"
              }`}
            >
              Tomorrow
            </button>
            <button
              onClick={() => setSelectedDate("all")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                selectedDate === "all"
                  ? "bg-[#102D4A] text-white shadow-xs"
                  : "text-[#526B82] hover:text-[#102D4A]"
              }`}
            >
              All Scheduled
            </button>
          </div>

          {/* Route / Service Corridor Selector */}
          <div className="flex items-center gap-2">
            <label htmlFor="service-corridor-filter" className="text-xs font-medium text-[#526B82]">Corridor:</label>
            <select
              id="service-corridor-filter"
              value={selectedRouteFilter}
              onChange={(e) => setSelectedRouteFilter(e.target.value)}
              className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
            >
              <option value="all">All Corridors & Campuses</option>
              <option value="female">Girls&apos; Fleet Only</option>
              <option value="male">Boys&apos; Corridor Only</option>
              <option value="mixed">Inter-Campus Transfers</option>
            </select>
          </div>
        </div>
      </div>

      {/* Departure Board Cards / Desktop Grid */}
      {filteredJourneys.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <span className="text-4xl block mb-3">🚌</span>
          <h4 className="text-base font-bold text-[#102D4A]">No Departures Listed</h4>
          <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
            There are currently no scheduled bus departures matching this filter. Scheduled journeys will display here once published by the transport administrator.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredJourneys.map((j) => {
            const availableSeats = calculateAvailableSeats(
              j.proposedAllocation,
              j.safeCapacity,
              j.bookedCount
            );
            const isFull = availableSeats <= 0;
            const isDelayed = j.delayMinutes > 0;
            const hasUserBooked = Boolean(j.userBookingId);
            const hasUserWaitlisted = Boolean(j.userWaitlistPosition);

            // Calculate status label and style
            let statusKey: keyof typeof DEPARTURE_STATUS_CONFIG = "scheduled";
            if (j.status === "cancelled") statusKey = "cancelled";
            else if (j.status === "in_transit") statusKey = "in_transit";
            else if (j.status === "completed") statusKey = "completed";
            else if (j.status === "boarding") statusKey = "boarding";
            else if (isDelayed) statusKey = "delayed";
            else if (isFull) statusKey = "full";
            else statusKey = "booking_open";

            const statusStyle = DEPARTURE_STATUS_CONFIG[statusKey];

            return (
              <div
                key={j.id}
                className="bg-white rounded-xl border border-slate-200 hover:border-slate-300 shadow-xs transition-all overflow-hidden"
              >
                {/* Delay Notice Banner if delayed */}
                {isDelayed && (
                  <div className="bg-[#E5A13B]/10 border-b border-[#E5A13B]/30 px-4 py-2 flex items-center justify-between text-xs text-[#102D4A]">
                    <div className="flex items-center gap-2">
                      <AlertTriangleIcon className="w-4 h-4 text-[#E5A13B]" />
                      <span className="font-bold">
                        Operational Delay: +{j.delayMinutes} mins
                      </span>
                      {j.delayReason && (
                        <span className="text-[#526B82] hidden sm:inline">
                          — {j.delayReason}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-[#526B82]">
                      Driver manual update
                    </span>
                  </div>
                )}

                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Left: Time & Destination */}
                  <div className="flex items-start sm:items-center gap-4">
                    {/* Departure Time */}
                    <div className="text-center w-20 py-1.5 px-2 bg-[#F6F8FA] rounded-lg border border-slate-200 shrink-0">
                      <p className="text-lg font-black font-mono tracking-tight text-[#102D4A] leading-tight">
                        {formatTime(j.scheduledDeparture)}
                      </p>
                      <p className="text-[10px] text-[#526B82] font-semibold uppercase mt-0.5">
                        {formatDate(j.scheduledDeparture)}
                      </p>
                    </div>

                    {/* Corridor & Stops */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#102D4A]">
                          {j.originName}
                        </span>
                        <span className="text-[#526B82]">→</span>
                        <span className="font-bold text-sm text-[#102D4A]">
                          {j.destinationName}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-[#526B82] mt-1 flex-wrap">
                        <span className="font-mono text-[11px] font-medium bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                          {j.routeCode}
                        </span>
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <BusIcon className="w-3.5 h-3.5" />
                          {j.vehicleRegistration}
                        </span>
                        {j.vehicleName && (
                          <span className="text-[11px] text-slate-400 hidden md:inline">
                            ({j.vehicleName})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle / Right: Seat Availability & Action */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                    {/* Status Chip */}
                    <div className="text-left sm:text-right">
                      <div className="flex items-center sm:justify-end gap-1.5 mb-1">
                        <span className={`w-2 h-2 rounded-full ${statusStyle.dotClass}`} />
                        <span className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full ${statusStyle.badgeClass}`}>
                          {statusStyle.label}
                        </span>
                      </div>

                      <p className="text-xs font-mono text-[#526B82]">
                        {isFull ? (
                          <span className="text-purple-700 font-bold">Safe Limit Reached ({j.safeCapacity} max)</span>
                        ) : (
                          <span>
                            <strong className="text-[#20A477] font-bold">{availableSeats}</strong> seats open / {j.safeCapacity} cap
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Booking Action Button */}
                    <div>
                      {hasUserBooked ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#20A477]/10 text-[#20A477] text-xs font-bold border border-[#20A477]/20">
                          <CheckCircleIcon className="w-4 h-4" />
                          Reserved
                        </span>
                      ) : hasUserWaitlisted ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-50 text-purple-700 text-xs font-bold border border-purple-200">
                          Waitlist #{j.userWaitlistPosition}
                        </span>
                      ) : j.status === "completed" || j.status === "in_transit" || j.status === "cancelled" ? (
                        <button
                          disabled
                          className="px-3.5 py-2 rounded-lg bg-slate-100 text-slate-400 text-xs font-medium cursor-not-allowed"
                        >
                          Closed
                        </button>
                      ) : isFull ? (
                        <button
                          onClick={() => handleOpenBooking(j)}
                          className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-colors shadow-xs"
                        >
                          Join Waitlist
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOpenBooking(j)}
                          className="px-4 py-2 rounded-lg bg-[#102D4A] hover:bg-[#18426C] text-white text-xs font-bold transition-colors shadow-xs"
                        >
                          Book Seat
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Latest Operational Milestone Banner */}
                {j.latestStopUpdate && (
                  <div className="bg-emerald-50 px-4 py-2 border-t border-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-emerald-900">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span>📍</span>
                      <span>
                        Bus {j.latestStopUpdate.eventType.replace("_", " ")} at <strong>{j.latestStopUpdate.stopName}</strong> ({formatTime(j.latestStopUpdate.timestamp)})
                      </span>
                    </div>
                    <span className="text-[10px] text-emerald-700 font-semibold shrink-0">
                      {j.latestStopUpdate.isAssisted ? "Representative recorded" : "Driver reported"}
                    </span>
                  </div>
                )}

                {/* Pickup Stops Accordion / Footer Preview */}
                {j.stops.length > 0 && (
                  <div className="bg-[#F6F8FA]/80 px-4 py-2 border-t border-slate-100 flex items-center gap-3 text-[11px] text-[#526B82] overflow-x-auto">
                    <span className="font-semibold text-[#102D4A] uppercase text-[10px]">Stops:</span>
                    {j.stops.map((stop, idx) => (
                      <span key={stop.id} className="whitespace-nowrap flex items-center gap-1">
                        <span>{stop.name}</span>
                        {stop.estimatedMinutesFromStart > 0 && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            (+{stop.estimatedMinutesFromStart}m)
                          </span>
                        )}
                        {idx < j.stops.length - 1 && <span className="text-slate-300">›</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Booking Confirmation Modal */}
      {activeBookingJourney && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-[#102D4A] text-white p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-mono tracking-widest text-[#20A477] font-bold">
                  RESERVATION
                </span>
                <h3 className="text-base font-bold text-white font-mono">
                  {calculateAvailableSeats(
                    activeBookingJourney.proposedAllocation,
                    activeBookingJourney.safeCapacity,
                    activeBookingJourney.bookedCount
                  ) <= 0
                    ? "Join Waiting List"
                    : "Confirm Bus Seat"}
                </h3>
              </div>
              <button
                onClick={() => setActiveBookingJourney(null)}
                className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xs font-bold"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {bookingSuccessMessage ? (
                <div className="p-4 rounded-xl bg-[#20A477]/10 border border-[#20A477]/30 text-center space-y-2">
                  <CheckCircleIcon className="w-8 h-8 text-[#20A477] mx-auto" />
                  <p className="text-sm font-bold text-[#102D4A]">
                    {bookingSuccessMessage}
                  </p>
                  <p className="text-xs text-[#526B82]">
                    Your reservation has been confirmed by CosmoRide. View your digital ticket under &ldquo;My Trips&rdquo;.
                  </p>
                  <button
                    onClick={() => setActiveBookingJourney(null)}
                    className="mt-3 w-full py-2 bg-[#102D4A] text-white text-xs font-bold rounded-lg"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  {bookingError && (
                    <div className="p-3 rounded-lg bg-[#D9534F]/10 border border-[#D9534F]/30 text-xs text-[#D9534F]">
                      {bookingError}
                    </div>
                  )}

                  {/* Summary Card */}
                  <div className="bg-[#F6F8FA] p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <div className="flex justify-between items-center text-[#102D4A] font-bold">
                      <span>Corridor</span>
                      <span>{activeBookingJourney.originName} → {activeBookingJourney.destinationName}</span>
                    </div>
                    <div className="flex justify-between items-center text-[#526B82]">
                      <span>Scheduled Departure</span>
                      <span className="font-mono font-semibold text-[#102D4A]">
                        {formatTime(activeBookingJourney.scheduledDeparture)} ({formatDate(activeBookingJourney.scheduledDeparture)})
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[#526B82]">
                      <span>Vehicle</span>
                      <span className="font-mono font-semibold text-[#102D4A]">
                        {activeBookingJourney.vehicleRegistration}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[#526B82]">
                      <span>Effective Capacity</span>
                      <span className="font-semibold text-[#102D4A]">
                        Safe Limit: {activeBookingJourney.safeCapacity} seats
                      </span>
                    </div>
                  </div>

                  {/* Authorized Pickup Stop Selection */}
                  <div>
                    <label htmlFor="authorized-pickup-point" className="block text-xs font-bold text-[#102D4A] mb-1">
                      Select Your Authorized Pickup Point
                    </label>
                    <select
                      id="authorized-pickup-point"
                      value={selectedStopId}
                      onChange={(e) => setSelectedStopId(e.target.value)}
                      className="w-full p-2.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
                    >
                      {activeBookingJourney.stops.map((stop) => (
                        <option key={stop.id} value={stop.id}>
                          {stop.name} {stop.estimatedMinutesFromStart > 0 ? `(+${stop.estimatedMinutesFromStart}m)` : "(Terminal)"}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-[#526B82] mt-1">
                      Expected bus pickup will be calculated from terminal departure.
                    </p>
                  </div>

                  {/* Capacity Note */}
                  {calculateAvailableSeats(
                    activeBookingJourney.proposedAllocation,
                    activeBookingJourney.safeCapacity,
                    activeBookingJourney.bookedCount
                  ) <= 0 && (
                    <div className="p-2.5 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-700">
                      <strong>Waitlist Notice:</strong> All seats on this bus are currently confirmed. If you confirm, you will be added to the official waiting list and automatically promoted if someone cancels.
                    </div>
                  )}

                  {/* Actions */}
                  <div className="pt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveBookingJourney(null)}
                      className="flex-1 py-2.5 rounded-lg border border-slate-300 text-xs font-bold text-[#526B82] hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isPending || !selectedStopId}
                      onClick={handleConfirmBooking}
                      className="flex-1 py-2.5 rounded-lg bg-[#102D4A] hover:bg-[#18426C] text-white text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      {isPending
                        ? "Processing..."
                        : calculateAvailableSeats(
                            activeBookingJourney.proposedAllocation,
                            activeBookingJourney.safeCapacity,
                            activeBookingJourney.bookedCount
                          ) <= 0
                        ? "Join Waitlist"
                        : "Confirm Seat"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

