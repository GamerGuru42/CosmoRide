"use client";

import { useState } from "react";
import { Clock, MapPin, Bus, Calendar } from "lucide-react";

interface TransitRoute {
  code: string;
  name: string;
  type: "morning" | "evening";
  departureTime: string;
  isExpress: boolean;
  origin: string;
  via?: string;
  destination: string;
  days: string;
  cutoff: string;
  description: string;
}

const TRANSIT_ROUTES: TransitRoute[] = [
  {
    code: "BOYS_AM_ROUTE",
    name: "Boys' Morning Route (via Wuye)",
    type: "morning",
    departureTime: "07:30 AM",
    isExpress: false,
    origin: "Main Boys' Hostel Stop (Kado)",
    via: "Wuye Boys' Hostel Stop",
    destination: "Main Campus Central Bus Park",
    days: "Monday – Friday",
    cutoff: "15 mins before departure (07:15 AM)",
    description: "Scheduled morning service linking Main Boys' Hostel and Wuye residences directly to Main Campus lecture halls.",
  },
  {
    code: "BOYS_AM_DIRECT",
    name: "Boys' Morning Direct Express",
    type: "morning",
    departureTime: "08:30 AM",
    isExpress: true,
    origin: "Main Boys' Hostel Stop (Kado)",
    destination: "Main Campus Central Bus Park",
    days: "Monday – Friday",
    cutoff: "15 mins before departure (08:15 AM)",
    description: "Non-stop morning express service providing direct point-to-point transit for 09:00 AM lectures.",
  },
  {
    code: "BOYS_PM_DIRECT",
    name: "Boys' Evening Direct Express",
    type: "evening",
    departureTime: "04:00 PM",
    isExpress: true,
    origin: "Main Campus Central Bus Park",
    destination: "Main Boys' Hostel Stop (Kado)",
    days: "Monday – Friday",
    cutoff: "15 mins before departure (03:45 PM)",
    description: "Point-to-point evening return express from Main Campus directly back to Main Boys' Hostel.",
  },
  {
    code: "BOYS_PM_ROUTE",
    name: "Boys' Evening Route (via Wuye)",
    type: "evening",
    departureTime: "04:50 PM",
    isExpress: false,
    origin: "Main Campus Central Bus Park",
    via: "Wuye Boys' Hostel Stop",
    destination: "Main Boys' Hostel Stop (Kado)",
    days: "Monday – Friday",
    cutoff: "15 mins before departure (04:35 PM)",
    description: "Comprehensive evening service returning students from Main Campus with scheduled stop at Wuye hostel.",
  },
];

const CAMPUSES = [
  {
    code: "MAIN",
    name: "Main Campus",
    location: "Abuja, Nigeria",
    station: "Administrative Plaza & Central Bus Park",
    description: "Central university hub serving faculties, lecture halls, university library, and primary transit dispatch.",
    features: ["Central Bus Park", "FIDS Departure Screens", "Designated Waiting Canopy"],
  },
  {
    code: "KADO",
    name: "Kado Campus",
    location: "Kado District, Abuja",
    station: "Academic Wing A & Bus Terminal",
    description: "Academic campus complex housing foundational faculties, student hostels, and terminal transit bays.",
    features: ["Bus Terminal", "Hostel Entrance Station", "Sheltered Boarding Zone"],
  },
  {
    code: "WUYE",
    name: "Wuye Station",
    location: "Wuye District, Abuja",
    station: "Wuye Boys' Hostel Stop",
    description: "Dedicated scheduled transit stop serving Cosmopolitan students residing in Wuye district.",
    features: ["Scheduled AM & PM Pickups", "Hostel Rep Supervised", "Direct Campus Link"],
  },
];

export function RoutesAndCampuses() {
  const [filter, setFilter] = useState<"all" | "morning" | "evening">("all");

  const filteredRoutes =
    filter === "all"
      ? TRANSIT_ROUTES
      : TRANSIT_ROUTES.filter((c) => c.type === filter);

  return (
    <section id="routes" className="py-20 lg:py-28 bg-[#F6F8FA]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-200/80 px-3.5 py-1 text-xs font-bold text-[#102D4A] mb-3">
            <Bus className="h-3.5 w-3.5 text-[#20A477]" />
            <span>Configured Transport Network</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#102D4A]">
            Official Routes & Timetable
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            All departures operate strictly to West Africa Time (WAT) with certified 30-passenger seating
            and automated 15-minute booking cutoff windows.
          </p>

          {/* Filter Tabs */}
          <div className="mt-8 inline-flex items-center rounded-2xl bg-white p-1.5 shadow-sm border border-slate-200">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                filter === "all"
                  ? "bg-[#102D4A] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All Departures (4)
            </button>
            <button
              onClick={() => setFilter("morning")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                filter === "morning"
                  ? "bg-[#102D4A] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Morning Routes (AM)
            </button>
            <button
              onClick={() => setFilter("evening")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                filter === "evening"
                  ? "bg-[#102D4A] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Evening Routes (PM)
            </button>
          </div>
        </div>

        {/* Routes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 mb-20">
          {filteredRoutes.map((c) => (
            <div
              key={c.code}
              className="rounded-3xl bg-white p-6 sm:p-7 border border-slate-200/90 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between"
            >
              {/* Top Accent Strip */}
              <div
                className={`absolute top-0 left-0 right-0 h-1.5 ${
                  c.type === "morning" ? "bg-[#20A477]" : "bg-[#102D4A]"
                }`}
              />

              <div>
                {/* Header row */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-400">
                      {c.code}
                    </span>
                    <h3 className="text-lg font-bold text-slate-900">
                      {c.name}
                    </h3>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-block rounded-xl bg-slate-900 text-white font-mono text-sm font-black px-3 py-1 shadow-xs">
                      {c.departureTime}
                    </span>
                    {c.isExpress && (
                      <span className="block mt-1 text-[10px] font-extrabold text-[#20A477] uppercase tracking-wide">
                        ★ Non-stop Express
                      </span>
                    )}
                  </div>
                </div>

                {/* Visual Route Progression */}
                <div className="my-5 p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-3">
                  {/* Origin */}
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full border-2 border-[#102D4A] bg-white shrink-0" />
                    <div className="text-xs">
                      <span className="text-[10px] font-medium text-slate-400 block uppercase">
                        Origin Departure
                      </span>
                      <span className="font-bold text-slate-800">{c.origin}</span>
                    </div>
                  </div>

                  {/* Via Stop (if applicable) */}
                  {c.via && (
                    <div className="flex items-center gap-3 pl-0.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#20A477] shrink-0 ml-0.5" />
                      <div className="text-xs">
                        <span className="text-[10px] font-medium text-[#20A477] block uppercase font-semibold">
                          Scheduled Stop
                        </span>
                        <span className="font-semibold text-slate-700">{c.via}</span>
                      </div>
                    </div>
                  )}

                  {/* Destination */}
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-[#102D4A] shrink-0" />
                    <div className="text-xs">
                      <span className="text-[10px] font-medium text-slate-400 block uppercase">
                        Terminal Arrival
                      </span>
                      <span className="font-bold text-slate-800">{c.destination}</span>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed mb-4">
                  {c.description}
                </p>
              </div>

              {/* Bottom Meta */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-1.5 font-medium">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <span>{c.days}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-mono text-amber-700 bg-amber-50 rounded-lg px-2 py-0.5 border border-amber-200">
                  <Clock className="h-3 w-3" />
                  <span>Cutoff: 15m prior</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Campuses Network Subsection */}
        <div id="campuses" className="pt-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-200/80 px-3.5 py-1 text-xs font-bold text-[#102D4A] mb-3">
              <MapPin className="h-3.5 w-3.5 text-[#20A477]" />
              <span>Campus Locations & Hubs</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-[#102D4A]">
              Cosmopolitan University Stations
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600">
              Designated pick-up and drop-off hubs equipped with supervised boarding zones.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {CAMPUSES.map((hub) => (
              <div
                key={hub.code}
                className="rounded-3xl bg-white p-6 border border-slate-200/90 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-mono font-bold tracking-widest text-[#20A477] uppercase">
                      Code: {hub.code}
                    </span>
                    <span className="h-2 w-2 rounded-full bg-[#20A477]" />
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">
                    {hub.name}
                  </h4>
                  <div className="text-xs font-semibold text-[#102D4A] mb-2 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span>{hub.station}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                    {hub.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-100 space-y-1.5">
                  {hub.features.map((feat) => (
                    <div key={feat} className="flex items-center gap-2 text-[11px] text-slate-600">
                      <span className="text-[#20A477] font-bold">✓</span>
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
