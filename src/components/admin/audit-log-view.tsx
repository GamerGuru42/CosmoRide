"use client";

import React, { useState } from "react";
import { formatDate, formatTime } from "@/lib/utils";
import type { Json } from "@/lib/supabase/types";

export interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Json;
  ipAddress: string | null;
  createdAt: string;
  userName: string;
  userRole: string;
}

interface AuditLogViewProps {
  logs: AuditLogRow[];
}

export function AuditLogView({ logs }: AuditLogViewProps) {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [activeJsonModal, setActiveJsonModal] = useState<AuditLogRow | null>(null);

  const filteredLogs = logs.filter((l) => {
    const matchesSearch =
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.entityType.toLowerCase().includes(search.toLowerCase()) ||
      l.userName.toLowerCase().includes(search.toLowerCase()) ||
      (l.entityId && l.entityId.includes(search));

    const matchesAction = actionFilter === "all" || l.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  const uniqueActions = Array.from(new Set(logs.map((l) => l.action))).sort();

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <input
              type="text"
              placeholder="Search action, actor, entity ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs focus:border-[#102D4A] focus:outline-none"
            />
          </div>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Audit Actions</option>
            {uniqueActions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-[#526B82]">
          Total Logged Mutations: <span className="font-bold text-[#102D4A]">{filteredLogs.length}</span>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-[#102D4A]">
            Immutable System Mutation &amp; Security Logs
          </h3>
          <p className="mt-0.5 text-xs text-[#526B82]">
            Cryptographically grounded audit entries capturing administrative decisions, capacity changes, and operational exceptions.
          </p>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#526B82]">
            No audit log entries found matching your query.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Timestamp</th>
                  <th className="px-4 py-3 font-semibold">Actor / User</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Target Entity</th>
                  <th className="px-4 py-3 font-semibold">Payload Summary</th>
                  <th className="px-4 py-3 font-semibold text-right">Raw Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-[#102D4A]">
                      {formatDate(l.createdAt)}{" "}
                      <span className="text-slate-500">{formatTime(l.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-900">{l.userName}</span>
                      <span className="block text-[10px] text-[#526B82] capitalize">
                        {l.userRole.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-[#102D4A]">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium capitalize text-slate-700">
                        {l.entityType}
                      </span>
                      {l.entityId && (
                        <span className="block font-mono text-[10px] text-slate-500 truncate max-w-[120px]">
                          {l.entityId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600 truncate max-w-xs">
                      {JSON.stringify(l.details)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setActiveJsonModal(l)}
                        className="rounded px-2.5 py-1 text-xs font-semibold text-[#102D4A] hover:bg-slate-100"
                      >
                        View JSON
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: View Raw JSON Payload */}
      {activeJsonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#102D4A]">
                  Audit Log Payload: {activeJsonModal.action}
                </h3>
                <p className="text-[11px] text-[#526B82]">
                  Entity: {activeJsonModal.entityType} • Actor: {activeJsonModal.userName} ({activeJsonModal.userRole})
                </p>
              </div>
              <button
                onClick={() => setActiveJsonModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <pre className="max-h-80 overflow-y-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-emerald-400">
                {JSON.stringify(activeJsonModal.details, null, 2)}
              </pre>
            </div>

            <div className="mt-5 flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setActiveJsonModal(null)}
                className="rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c233a]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

