"use client";

import React, { useState } from "react";
import { formatDate, formatTime, getTodayDateString } from "@/lib/utils";

export interface JourneyReportRow {
  id: string;
  journeyDate: string;
  scheduledDeparture: string;
  routeCode: string;
  routeName: string;
  transportGroupName: string;
  vehiclePlate: string;
  driverName: string;
  safeCapacity: number;
  bookedCount: number;
  boardedCount: number;
  status: string;
  isDelayed: boolean;
  delayMinutes: number;
}

export interface IncidentReportRow {
  id: string;
  date: string;
  category: string;
  severity: string;
  status: string;
  reporterName: string;
  description: string;
  resolutionNotes: string | null;
}

export interface PassengerReportRow {
  id: string;
  journeyDate: string;
  routeCode: string;
  studentName: string;
  studentId: string | null;
  status: string;
  boardedAt: string | null;
}

interface ReportsViewProps {
  journeys: JourneyReportRow[];
  incidents: IncidentReportRow[];
  passengers: PassengerReportRow[];
}

export function ReportsView({
  journeys,
  incidents,
  passengers,
}: ReportsViewProps) {
  // Aggregate Metrics
  const totalJourneys = journeys.length;
  const totalCapacity = journeys.reduce((sum, j) => sum + j.safeCapacity, 0);
  const totalBooked = journeys.reduce((sum, j) => sum + j.bookedCount, 0);
  const totalBoarded = journeys.reduce((sum, j) => sum + j.boardedCount, 0);

  const avgSeatUtilization =
    totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0;

  const boardingComplianceRate =
    totalBooked > 0 ? Math.round((totalBoarded / totalBooked) * 100) : 0;

  const delayedJourneysCount = journeys.filter((j) => j.isDelayed).length;
  const onTimePerformance =
    totalJourneys > 0
      ? Math.round(((totalJourneys - delayedJourneysCount) / totalJourneys) * 100)
      : 100;

  // CSV Exporters
  const downloadCsv = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJourneysCsv = () => {
    const headers = [
      "Journey ID",
      "Date",
      "Scheduled Departure",
      "Route Code",
      "Route Name",
      "Corridor",
      "Vehicle Plate",
      "Driver",
      "Safe Capacity",
      "Booked Count",
      "Boarded Count",
      "Utilization %",
      "Status",
      "Is Delayed",
      "Delay Minutes",
    ];

    const rows = journeys.map((j) => [
      `"${j.id}"`,
      `"${j.journeyDate}"`,
      `"${j.scheduledDeparture}"`,
      `"${j.routeCode}"`,
      `"${j.routeName}"`,
      `"${j.transportGroupName}"`,
      `"${j.vehiclePlate}"`,
      `"${j.driverName}"`,
      j.safeCapacity,
      j.bookedCount,
      j.boardedCount,
      j.safeCapacity > 0 ? Math.round((j.bookedCount / j.safeCapacity) * 100) : 0,
      `"${j.status}"`,
      j.isDelayed ? "YES" : "NO",
      j.delayMinutes,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    downloadCsv(`CosmoRide_Journeys_Utilization_${getTodayDateString()}.csv`, csvContent);
  };

  const exportPassengersCsv = () => {
    const headers = [
      "Booking ID",
      "Date",
      "Route Code",
      "Student Name",
      "Matric / Student ID",
      "Booking Status",
      "Boarded Timestamp",
    ];

    const rows = passengers.map((p) => [
      `"${p.id}"`,
      `"${p.journeyDate}"`,
      `"${p.routeCode}"`,
      `"${p.studentName}"`,
      `"${p.studentId || "N/A"}"`,
      `"${p.status}"`,
      `"${p.boardedAt || ""}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    downloadCsv(`CosmoRide_Passenger_Compliance_${getTodayDateString()}.csv`, csvContent);
  };

  const exportIncidentsCsv = () => {
    const headers = [
      "Incident ID",
      "Date",
      "Category",
      "Severity",
      "Status",
      "Reporter",
      "Description",
      "Resolution Notes",
    ];

    const rows = incidents.map((i) => [
      `"${i.id}"`,
      `"${i.date}"`,
      `"${i.category}"`,
      `"${i.severity}"`,
      `"${i.status}"`,
      `"${i.reporterName}"`,
      `"${i.description.replace(/"/g, '""')}"`,
      `"${(i.resolutionNotes || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    downloadCsv(`CosmoRide_Incidents_Log_${getTodayDateString()}.csv`, csvContent);
  };

  return (
    <div className="space-y-6">
      {/* Top Export Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-[#102D4A]">
            Transport Performance &amp; Operations Reports
          </h3>
          <p className="text-xs text-[#526B82]">
            Data-backed metrics on fleet capacity, passenger boarding compliance, and service disruptions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportJourneysCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#102D4A] hover:bg-slate-50 transition-colors"
          >
            <span>📥</span> Export Journeys CSV
          </button>
          <button
            onClick={exportPassengersCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#102D4A] hover:bg-slate-50 transition-colors"
          >
            <span>📥</span> Export Passenger CSV
          </button>
          <button
            onClick={exportIncidentsCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#102D4A] hover:bg-slate-50 transition-colors"
          >
            <span>📥</span> Export Incidents CSV
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
            Capacity Utilization Rate
          </p>
          <p className="mt-2 text-3xl font-bold text-[#102D4A]">{avgSeatUtilization}%</p>
          <p className="mt-1 text-xs text-[#526B82]">
            {totalBooked} booked of {totalCapacity} approved passenger places
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
            Boarding Compliance
          </p>
          <p className="mt-2 text-3xl font-bold text-[#20A477]">{boardingComplianceRate}%</p>
          <p className="mt-1 text-xs text-[#526B82]">
            {totalBoarded} boarded passengers checked-in
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
            On-Time Performance
          </p>
          <p className="mt-2 text-3xl font-bold text-[#102D4A]">{onTimePerformance}%</p>
          <p className="mt-1 text-xs text-[#526B82]">
            {delayedJourneysCount} delay exception(s) logged
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#526B82]">
            Total Incidents Logged
          </p>
          <p className="mt-2 text-3xl font-bold text-[#D9534F]">{incidents.length}</p>
          <p className="mt-1 text-xs text-[#526B82]">
            {incidents.filter((i) => i.status === "resolved").length} resolved
          </p>
        </div>
      </div>

      {/* Corridor Breakdown & Journey Analytics Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-[#102D4A]">
            Historical Journey Performance ({journeys.length} Records)
          </h3>
          <p className="mt-0.5 text-xs text-[#526B82]">
            Real capacity utilization and passenger attendance per dispatched trip.
          </p>
        </div>

        {journeys.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#526B82]">
            No historical journey operational data available for reporting.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                  <th className="px-4 py-3 font-semibold">Route &amp; Corridor</th>
                  <th className="px-4 py-3 font-semibold">Vehicle</th>
                  <th className="px-4 py-3 font-semibold">Driver</th>
                  <th className="px-4 py-3 font-semibold text-center">Safe Cap</th>
                  <th className="px-4 py-3 font-semibold text-center">Booked</th>
                  <th className="px-4 py-3 font-semibold text-center">Boarded</th>
                  <th className="px-4 py-3 font-semibold text-center">Util %</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {journeys.slice(0, 50).map((j) => {
                  const util = j.safeCapacity > 0 ? Math.round((j.bookedCount / j.safeCapacity) * 100) : 0;
                  return (
                    <tr key={j.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-900">
                        {j.journeyDate}{" "}
                        <span className="text-[#526B82]">{formatTime(j.scheduledDeparture)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-[#102D4A]">{j.routeCode}</span>
                        <span className="block text-[10px] text-[#526B82]">{j.transportGroupName}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-semibold text-slate-800">
                        {j.vehiclePlate}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        {j.driverName}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap font-mono">
                        {j.safeCapacity}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap font-semibold text-[#102D4A]">
                        {j.bookedCount}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap font-bold text-emerald-700">
                        {j.boardedCount}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-block font-mono font-semibold text-[11px] ${
                            util >= 90 ? "text-[#D9534F]" : "text-slate-800"
                          }`}
                        >
                          {util}%
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap capitalize text-slate-600">
                        {j.status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

