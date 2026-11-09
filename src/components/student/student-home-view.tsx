"use client";

import React, { useState } from "react";
import Link from "next/link";
import { formatTime, formatDate, calculateAvailableSeats } from "@/lib/utils";
import { APP_NAME, UNIVERSITY_NAME, DEPARTURE_STATUS_CONFIG } from "@/lib/constants";
import { BoardingPassModal, type BoardingPassData } from "./boarding-pass-modal";
import { DepartureBoard, type DepartureJourney } from "./departure-board";
import {
  BusIcon,
  TicketIcon,
  ClockIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  QrCodeIcon,
} from "@/components/ui/icons";

export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

interface StudentHomeViewProps {
  student: {
    id: string;
    fullName: string;
    studentId: string | null;
  };
  nextBooking: {
    id: string;
    ticketToken: string | null;
    status: "confirmed" | "checked_in" | "no_show" | "cancelled" | "expired";
    bookedAt: string;
    journey: {
      id: string;
      scheduledDeparture: string;
      status: "scheduled" | "boarding" | "in_transit" | "completed" | "cancelled";
      delayMinutes: number;
      delayReason: string | null;
      route: {
        id: string;
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
  } | null;
  upcomingDepartures: DepartureJourney[];
  announcements: AnnouncementItem[];
  waitlistCount: number;
  totalActiveBookings: number;
}

export function StudentHomeView({
  student,
  nextBooking,
  upcomingDepartures,
  announcements,
  waitlistCount,
  totalActiveBookings,
}: StudentHomeViewProps) {
  const [selectedPass, setSelectedPass] = useState<BoardingPassData | null>(null);

  // Format today's date cleanly (e.g. "Monday, 9 November 2026")
  const currentDate = new Intl.DateTimeFormat("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  // Greeting based on current local hour
  const currentHour = new Date().getHours();
  const greeting =
    currentHour < 12
      ? "Good morning"
      : currentHour < 17
      ? "Good afternoon"
      : "Good evening";

  function openNextBookingPass() {
    if (!nextBooking) return;
    const j = nextBooking.journey;
    setSelectedPass({
      bookingId: nextBooking.id,
      ticketToken: nextBooking.ticketToken,
      status: nextBooking.status,
      studentName: student.fullName,
      studentId: student.studentId,
      routeName: j.route.name,
      routeCode: j.route.code,
      originName: j.boardingStop?.name || "Terminal",
      destinationName: "Main Campus",
      pickupStopName: j.boardingStop?.name || "Designated Stop",
      scheduledDeparture: j.scheduledDeparture,
      vehicleName: j.vehicle.name,
      vehicleRegistration: j.vehicle.registrationNumber,
      bookedAt: nextBooking.bookedAt,
    });
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-150">
      {/* 1. Header & Personal Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-slate-200/60 pb-5">
        <div>
          <p className="text-xs font-semibold text-[#526B82] tracking-wider uppercase">
            {currentDate}
          </p>
          <h1 className="text-2xl sm:text-3xl font-black text-[#102D4A] tracking-tight mt-1">
            {greeting}, {student.fullName.split(" ")[0]}
          </h1>
          <p className="text-xs text-[#526B82] mt-0.5">
            Cosmopolitan University Official Transit Hub
          </p>
        </div>

        {/* Quick status pill */}
        <div className="flex items-center gap-2">
          {totalActiveBookings > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#20A477]/10 text-[#20A477] border border-[#20A477]/20 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#20A477]" />
              {totalActiveBookings} Active {totalActiveBookings === 1 ? "Trip" : "Trips"}
            </span>
          )}
          {waitlistCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
              {waitlistCount} Waitlisted
            </span>
          )}
        </div>
      </div>

      {/* 2. Announcements Ticker / Banner (if any exist) */}
      {announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              className="bg-white border-l-4 border-[#102D4A] rounded-r-xl border-y border-r border-slate-200/80 p-3.5 shadow-xs flex items-start gap-3"
            >
              <div className="w-7 h-7 rounded-lg bg-[#102D4A]/10 text-[#102D4A] flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangleIcon className="w-4 h-4 text-[#102D4A]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[#102D4A] uppercase tracking-wide">
                    {ann.title}
                  </h4>
                  <span className="text-[10px] text-[#526B82] font-mono">
                    {formatDate(ann.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-[#526B82] mt-0.5 leading-relaxed">
                  {ann.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. Hero Feature: Next Upcoming Journey Card (Airline Boarding Card Inspired) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#102D4A] font-mono">
            YOUR NEXT JOURNEY
          </h2>
          <Link
            href="/student/trips"
            className="text-xs text-[#526B82] hover:text-[#102D4A] font-semibold flex items-center gap-1"
          >
            All Bookings <ArrowRightIcon className="w-3.5 h-3.5" />
          </Link>
        </div>

        {nextBooking ? (
          <div className="bg-gradient-to-br from-[#102D4A] to-[#18426C] text-white rounded-2xl shadow-md border border-slate-700 overflow-hidden relative">
            {/* Delay alert banner on top of ticket */}
            {nextBooking.journey.delayMinutes > 0 && (
              <div className="bg-[#E5A13B] text-[#102D4A] px-5 py-2 flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <AlertTriangleIcon className="w-4 h-4" />
                  Departure delayed by +{nextBooking.journey.delayMinutes} mins
                </span>
                <span className="text-[10px] font-mono font-medium">
                  {nextBooking.journey.delayReason || "Operational delay"}
                </span>
              </div>
            )}

            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[#20A477] font-bold">
                    ROUTE {nextBooking.journey.route.code}
                  </span>
                  <h3 className="text-xl font-bold tracking-tight text-white mt-0.5">
                    {nextBooking.journey.route.name}
                  </h3>
                  <p className="text-xs text-slate-300 font-mono mt-0.5">
                    Bus: {nextBooking.journey.vehicle.registrationNumber}
                    {nextBooking.journey.vehicle.name && ` • ${nextBooking.journey.vehicle.name}`}
                  </p>
                </div>

                <div className="text-left sm:text-right shrink-0">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                    SCHEDULED DEPARTURE
                  </span>
                  <p className="text-2xl font-black font-mono tracking-tight text-white">
                    {formatTime(nextBooking.journey.scheduledDeparture)}
                  </p>
                  <p className="text-xs text-slate-300">
                    {formatDate(nextBooking.journey.scheduledDeparture)}
                  </p>
                </div>
              </div>

              {/* Boarding Stop & Pass Action */}
              <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#20A477]">
                    <BusIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      PICKUP LOCATION
                    </span>
                    <p className="text-sm font-bold text-white">
                      {nextBooking.journey.boardingStop?.name || "Terminal Entrance"}
                    </p>
                  </div>
                </div>

                <button
                  onClick={openNextBookingPass}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-[#102D4A] hover:bg-slate-100 font-bold text-xs shadow-sm transition-all active:scale-98"
                >
                  <QrCodeIcon className="w-4 h-4 text-[#102D4A]" />
                  <span>View Digital Boarding Pass</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/90 p-8 sm:p-10 text-center shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-[#102D4A]/5 text-[#102D4A] flex items-center justify-center mx-auto mb-3">
              <BusIcon className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#102D4A]">
              No Upcoming Trips Scheduled
            </h3>
            <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1 mb-6">
              You do not have any active bus reservations. Explore the live university departure board to reserve your next ride.
            </p>
            <Link
              href="/student/departures"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#102D4A] hover:bg-[#18426C] text-white font-bold text-xs shadow-xs transition-colors"
            >
              <span>Explore Departures</span>
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </section>

      {/* 4. Live Departures Preview */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#102D4A] font-mono">
              CAMPUS DEPARTURE BOARD
            </h2>
            <p className="text-xs text-[#526B82]">
              Live schedule & remaining seat availability
            </p>
          </div>

          <Link
            href="/student/departures"
            className="text-xs text-[#526B82] hover:text-[#102D4A] font-semibold flex items-center gap-1"
          >
            Full Board <ArrowRightIcon className="w-3.5 h-3.5" />
          </Link>
        </div>

        <DepartureBoard journeys={upcomingDepartures} currentUserId={student.id} />
      </section>

      {/* 5. Boarding Pass Modal Popup */}
      <BoardingPassModal pass={selectedPass} onClose={() => setSelectedPass(null)} />
    </div>
  );
}

