"use client";

import React, { useState, useTransition } from "react";
import { formatTime, formatDate } from "@/lib/utils";
import { updateIncidentStatusAction } from "@/actions/admin";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangleIcon } from "@/components/ui/icons";

export interface IncidentRecord {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "reported" | "investigating" | "resolved" | "dismissed";
  description: string;
  resolutionNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporterName: string;
  reporterRole: string;
  routeCode: string | null;
  vehiclePlate: string | null;
}

interface IncidentsManagementProps {
  initialIncidents: IncidentRecord[];
}

const SEVERITY_CONFIG: Record<string, { label: string; color: string }> = {
  critical: { label: "CRITICAL", color: "bg-red-600 text-white font-bold" },
  high: { label: "HIGH", color: "bg-rose-100 text-rose-800" },
  medium: { label: "MEDIUM", color: "bg-amber-100 text-amber-800" },
  low: { label: "LOW", color: "bg-slate-100 text-slate-700" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  reported: { label: "Reported", color: "bg-rose-100 text-rose-800" },
  investigating: { label: "Investigating", color: "bg-amber-100 text-amber-800" },
  resolved: { label: "Resolved", color: "bg-emerald-100 text-emerald-800" },
  dismissed: { label: "Dismissed", color: "bg-slate-100 text-slate-700" },
};

export function IncidentsManagement({ initialIncidents }: IncidentsManagementProps) {
  const [incidents, setIncidents] = useState<IncidentRecord[]>(initialIncidents);
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  // Resolution modal state
  const [resolvingIncident, setResolvingIncident] = useState<IncidentRecord | null>(null);
  const [newStatus, setNewStatus] = useState<IncidentRecord["status"]>("resolved");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const filteredIncidents = incidents.filter((i) => {
    const matchesStatus = statusFilter === "all" || i.status === statusFilter;
    const matchesSeverity = severityFilter === "all" || i.severity === severityFilter;
    return matchesStatus && matchesSeverity;
  });

  const handleOpenResolve = (inc: IncidentRecord) => {
    setResolvingIncident(inc);
    setNewStatus(inc.status === "reported" ? "investigating" : "resolved");
    setResolutionNotes(inc.resolutionNotes || "");
    setActionError(null);
    setActionSuccess(null);
  };

  const handleUpdateStatus = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingIncident) return;
    setActionError(null);
    setActionSuccess(null);

    startTransition(async () => {
      const res = await updateIncidentStatusAction({
        incidentId: resolvingIncident.id,
        status: newStatus,
        resolutionNotes,
      });

      if (!res.success) {
        setActionError(res.error || "Failed to update incident.");
        return;
      }

      setActionSuccess(res.message || "Incident status updated.");
      setTimeout(() => {
        setResolvingIncident(null);
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Incident Statuses</option>
            <option value="reported">Reported (Action Required)</option>
            <option value="investigating">Under Investigation</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="text-xs text-[#526B82]">
          Showing <span className="font-bold text-[#102D4A]">{filteredIncidents.length}</span> recorded report(s)
        </div>
      </div>

      {/* Incidents Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-[#102D4A]">
            Incident Reports &amp; Disruption Log
          </h3>
          <p className="mt-0.5 text-xs text-[#526B82]">
            Official log of breakdowns, severe delays, misconduct, or route hazards reported by staff and drivers.
          </p>
        </div>

        {filteredIncidents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
              🛡️
            </div>
            <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Incident Reports</h4>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
              {statusFilter !== "all" || severityFilter !== "all"
                ? "No incidents matched your selected filters."
                : "No operational incidents or disruptions are currently open."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Reported At</th>
                  <th className="px-4 py-3 font-semibold">Severity &amp; Category</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 font-semibold">Route / Bus</th>
                  <th className="px-4 py-3 font-semibold">Reported By</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredIncidents.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-[#102D4A]">
                      {formatDate(inc.createdAt)}
                      <span className="block text-[10px] text-slate-500">
                        {formatTime(inc.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={inc.severity} statusConfig={SEVERITY_CONFIG} />
                      <span className="block mt-1 font-semibold text-[11px] capitalize text-[#102D4A]">
                        {inc.category.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-900 max-w-xs line-clamp-2">
                        {inc.description}
                      </p>
                      {inc.resolutionNotes && (
                        <p className="mt-1 text-[11px] text-emerald-800 line-clamp-1">
                          <span className="font-semibold">Resolution:</span> {inc.resolutionNotes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {inc.routeCode && (
                        <span className="font-mono font-bold text-[#102D4A]">
                          {inc.routeCode}
                        </span>
                      )}
                      {inc.vehiclePlate && (
                        <span className="block text-[11px] text-[#526B82]">
                          {inc.vehiclePlate}
                        </span>
                      )}
                      {!inc.routeCode && !inc.vehiclePlate && (
                        <span className="text-slate-400 italic">General campus</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-900">{inc.reporterName}</span>
                      <span className="block text-[10px] text-[#526B82] capitalize">
                        {inc.reporterRole.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={inc.status} statusConfig={STATUS_CONFIG} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleOpenResolve(inc)}
                        className="rounded px-2.5 py-1 text-xs font-semibold text-[#102D4A] hover:bg-slate-100 transition-colors"
                      >
                        Update / Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Update / Resolve Incident */}
      {resolvingIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">
              Update Incident Desk Status
            </h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Category: <span className="font-semibold capitalize">{resolvingIncident.category.replace("_", " ")}</span> • Severity: <span className="uppercase font-bold">{resolvingIncident.severity}</span>
            </p>

            {actionError && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-[#D9534F] border border-rose-200">
                {actionError}
              </div>
            )}
            {actionSuccess && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                {actionSuccess}
              </div>
            )}

            <form onSubmit={handleUpdateStatus} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Investigation / Resolution Status *
                </label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as IncidentRecord["status"])}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="investigating">Under Investigation</option>
                  <option value="resolved">Resolved (Action Complete)</option>
                  <option value="dismissed">Dismissed (No Action Required)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Resolution Notes &amp; Actions Taken *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Record corrective measures, mechanic dispatch, passenger re-assignment notes..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
                <p className="mt-0.5 text-[10px] text-[#526B82]">Min 5 characters required for audit.</p>
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setResolvingIncident(null)}
                  disabled={isPending}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || resolutionNotes.trim().length < 5}
                  className="rounded-lg bg-[#102D4A] px-4 py-2 font-semibold text-white hover:bg-[#0c233a] disabled:opacity-50"
                >
                  {isPending ? "Updating..." : "Save Resolution"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

