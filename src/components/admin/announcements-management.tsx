"use client";

import React, { useState, useTransition } from "react";
import { formatDate, formatTime } from "@/lib/utils";
import { createAnnouncementAction } from "@/actions/admin";

export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  targetRole: string | null;
  transportGroupName: string | null;
  campusName: string | null;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  authorName: string;
}

export interface TransportGroupOption {
  id: string;
  name: string;
}

export interface CampusOption {
  id: string;
  name: string;
}

interface AnnouncementsManagementProps {
  initialAnnouncements: AnnouncementItem[];
  transportGroups: TransportGroupOption[];
  campuses: CampusOption[];
}

export function AnnouncementsManagement({
  initialAnnouncements,
  transportGroups,
  campuses,
}: AnnouncementsManagementProps) {
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>(initialAnnouncements);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Modal form states
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetRole, setTargetRole] = useState<string>("student");
  const [transportGroupId, setTransportGroupId] = useState<string>("");
  const [campusId, setCampusId] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleOpenAdd = () => {
    setTitle("");
    setContent("");
    setTargetRole("student");
    setTransportGroupId("");
    setCampusId("");
    setExpiresAt("");
    setActionError(null);
    setActionSuccess(null);
    setShowAddModal(true);
  };

  const handleCreateAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    startTransition(async () => {
      const res = await createAnnouncementAction({
        title,
        content,
        targetRole: targetRole ? (targetRole as "student" | "boarding_officer" | "driver" | "admin") : null,
        transportGroupId: transportGroupId || null,
        campusId: campusId || null,
        expiresAt: expiresAt || null,
      });

      if (!res.success) {
        setActionError(res.error || "Failed to broadcast announcement.");
        return;
      }

      setActionSuccess(res.message || "Announcement published successfully.");
      setTimeout(() => {
        setShowAddModal(false);
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-[#102D4A]">
            Passenger Announcements &amp; Corridor Notices ({announcements.length})
          </h3>
          <p className="text-xs text-[#526B82]">
            Broadcast official transport notices to students, boarding officers, or specific campus corridors.
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a] transition-colors"
        >
          <span>📢</span> Broadcast New Announcement
        </button>
      </div>

      {/* Announcements Roster */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {announcements.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
              📢
            </div>
            <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Active Announcements</h4>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
              No active transport announcements have been published yet.
            </p>
            <div className="mt-4">
              <button
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white"
              >
                + Broadcast First Announcement
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {announcements.map((a) => (
              <div key={a.id} className="p-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-[#102D4A]">{a.title}</h4>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800 capitalize">
                        Audience: {a.targetRole ? a.targetRole.replace("_", " ") : "All University Users"}
                      </span>
                      {a.transportGroupName && (
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-800">
                          {a.transportGroupName}
                        </span>
                      )}
                      {a.campusName && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {a.campusName}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-xs text-slate-700 whitespace-pre-line">
                      {a.content}
                    </p>

                    <div className="mt-3 flex items-center gap-3 text-[11px] text-[#526B82]">
                      <span>Published by: {a.authorName}</span>
                      <span>•</span>
                      <span>Date: {formatDate(a.createdAt)}</span>
                      {a.expiresAt && (
                        <>
                          <span>•</span>
                          <span className="text-amber-800">Expires: {formatDate(a.expiresAt)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Broadcast Announcement */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">
              Broadcast Transport Announcement
            </h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Publish an official notice delivered to passenger boards, student dashboards, and officer consoles.
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

            <form onSubmit={handleCreateAnnouncement} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Announcement Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scheduled Maintenance for Girls Fleet Alpha"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Notice Content *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Provide complete details on route changes, departure timing adjustments, or boarding instructions..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Target Role
                  </label>
                  <select
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="">All Users (University-Wide)</option>
                    <option value="student">Students Only</option>
                    <option value="boarding_officer">Boarding Officers Only</option>
                    <option value="driver">Drivers Only</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Corridor / Fleet Group
                  </label>
                  <select
                    value={transportGroupId}
                    onChange={(e) => setTransportGroupId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="">All Corridors</option>
                    {transportGroups.map((tg) => (
                      <option key={tg.id} value={tg.id}>
                        {tg.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Campus</label>
                  <select
                    value={campusId}
                    onChange={(e) => setCampusId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="">All Campuses</option>
                    {campuses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Expiry Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={isPending}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-[#102D4A] px-4 py-2 font-semibold text-white hover:bg-[#0c233a] disabled:opacity-50"
                >
                  {isPending ? "Broadcasting..." : "Publish Announcement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
