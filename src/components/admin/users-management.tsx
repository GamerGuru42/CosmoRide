"use client";

import React, { useState, useTransition } from "react";
import { updateUserRoleAndCorridorAction } from "@/actions/admin";
import { StatusBadge } from "@/components/ui/status-badge";

export interface UserProfileItem {
  id: string;
  fullName: string;
  studentId: string | null;
  phone: string | null;
  role: "student" | "boarding_officer" | "driver" | "admin";
  assignedTransportGroupId: string | null;
  transportGroupName: string | null;
  hostelName: string | null;
  hostelId: string | null;
  createdAt: string;
}

export interface TransportGroupOption {
  id: string;
  name: string;
}

export interface HostelOption {
  id: string;
  name: string;
}

interface UsersManagementProps {
  initialUsers: UserProfileItem[];
  transportGroups: TransportGroupOption[];
  hostels: HostelOption[];
}

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  admin: { label: "Admin", color: "bg-purple-100 text-purple-800 font-bold" },
  boarding_officer: { label: "Boarding Officer", color: "bg-blue-100 text-blue-800" },
  driver: { label: "Driver", color: "bg-amber-100 text-amber-800" },
  student: { label: "Student", color: "bg-slate-100 text-slate-700" },
};

export function UsersManagement({
  initialUsers,
  transportGroups,
  hostels,
}: UsersManagementProps) {
  const [users, setUsers] = useState<UserProfileItem[]>(initialUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  // Modal state
  const [editingUser, setEditingUser] = useState<UserProfileItem | null>(null);
  const [newRole, setNewRole] = useState<UserProfileItem["role"]>("student");
  const [newTgId, setNewTgId] = useState<string>("");
  const [newHostelId, setNewHostelId] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.fullName.toLowerCase().includes(search.toLowerCase()) ||
      (u.studentId && u.studentId.toLowerCase().includes(search.toLowerCase())) ||
      (u.phone && u.phone.includes(search));

    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleOpenEdit = (u: UserProfileItem) => {
    setEditingUser(u);
    setNewRole(u.role);
    setNewTgId(u.assignedTransportGroupId || "");
    setNewHostelId(u.hostelId || "");
    setActionError(null);
    setActionSuccess(null);
  };

  const handleUpdateRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setActionError(null);
    setActionSuccess(null);

    startTransition(async () => {
      const res = await updateUserRoleAndCorridorAction({
        userId: editingUser.id,
        role: newRole,
        assignedTransportGroupId: newTgId || null,
        hostelId: newHostelId || null,
      });

      if (!res.success) {
        setActionError(res.error || "Failed to update user role.");
        return;
      }

      setActionSuccess(res.message || "User role updated successfully.");
      setTimeout(() => {
        setEditingUser(null);
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <input
              type="text"
              placeholder="Search user name, matric/staff ID, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs focus:border-[#102D4A] focus:outline-none"
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Roles</option>
            <option value="student">Student</option>
            <option value="boarding_officer">Hostel Rep / Boarding Officer</option>
            <option value="driver">Driver</option>
            <option value="admin">Administrator</option>
          </select>
        </div>

        <div className="text-xs text-[#526B82]">
          Total Registered: <span className="font-bold text-[#102D4A]">{filteredUsers.length}</span> user(s)
        </div>
      </div>

      {/* Users Roster Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-[#102D4A]">
            University User Directory &amp; Permissions
          </h3>
          <p className="mt-0.5 text-xs text-[#526B82]">
            Staff role assignments, boarding officer corridor isolation, and student credentials.
          </p>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#526B82]">
            No university user records found matching your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Matric / Staff ID</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Assigned Corridor</th>
                  <th className="px-4 py-3 font-semibold">Hostel</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-900">{u.fullName}</span>
                      <span className="block text-[10px] text-[#526B82] font-mono">
                        {u.phone || "No phone"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-700">
                      {u.studentId || "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={u.role} statusConfig={ROLE_CONFIG} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {u.transportGroupName ? (
                        <span className="font-semibold text-slate-800">
                          {u.transportGroupName}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">No restriction</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {u.hostelName || <span className="text-slate-400 italic">None</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleOpenEdit(u)}
                        className="rounded px-2.5 py-1 text-xs font-semibold text-[#102D4A] hover:bg-slate-100 transition-colors"
                      >
                        Edit Role / Corridor
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Edit User Role & Corridor */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">
              Edit Permissions: {editingUser.fullName}
            </h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Assign system roles and configure corridor operational boundaries for boarding officers.
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

            <form onSubmit={handleUpdateRole} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  System Role *
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserProfileItem["role"])}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="student">Student (Bus Booking)</option>
                  <option value="boarding_officer">Hostel Rep / Boarding Officer (Verification)</option>
                  <option value="driver">Driver (Mode A App Access)</option>
                  <option value="admin">Transport Administrator (Control Centre)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Assigned Transport Group / Corridor
                </label>
                <select
                  value={newTgId}
                  onChange={(e) => setNewTgId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="">-- No Group Restriction (General) --</option>
                  {transportGroups.map((tg) => (
                    <option key={tg.id} value={tg.id}>
                      {tg.name}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-[10px] text-[#526B82]">
                  Enforces corridor isolation for boarding officers (e.g. Girls&apos; vs Boys&apos; operations).
                </p>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Associated University Hostel
                </label>
                <select
                  value={newHostelId}
                  onChange={(e) => setNewHostelId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="">-- None / Non-Residential --</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
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
                  {isPending ? "Updating..." : "Save Role Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
