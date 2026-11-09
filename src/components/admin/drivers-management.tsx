"use client";

import React, { useState, useTransition } from "react";
import { createDriverRecordAction, updateDriverRecordAction } from "@/actions/admin";
import { StatusBadge } from "@/components/ui/status-badge";

export interface DriverItem {
  id: string;
  driverReference: string;
  fullName: string;
  phone: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  status: "active" | "on_leave" | "suspended" | "inactive";
  hasAppAccess: boolean;
  notes: string | null;
  assignedVehicleId: string | null;
  assignedVehiclePlate: string | null;
  assignedVehicleName: string | null;
  profileId: string | null;
  profileEmail: string | null;
  createdAt: string;
}

export interface AvailableVehicleOption {
  id: string;
  registrationNumber: string;
  name: string | null;
}

interface DriversManagementProps {
  initialDrivers: DriverItem[];
  availableVehicles: AvailableVehicleOption[];
}

const DRIVER_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-emerald-100 text-emerald-800" },
  on_leave: { label: "On Leave", color: "bg-amber-100 text-amber-800" },
  suspended: { label: "Suspended", color: "bg-rose-100 text-rose-800" },
  inactive: { label: "Inactive", color: "bg-slate-100 text-slate-700" },
};

export function DriversManagement({
  initialDrivers,
  availableVehicles,
}: DriversManagementProps) {
  const [drivers, setDrivers] = useState<DriverItem[]>(initialDrivers);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Form states for Add
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [driverReference, setDriverReference] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [assignedVehicleId, setAssignedVehicleId] = useState("");
  const [hasAppAccess, setHasAppAccess] = useState(false);
  const [driverStatus, setDriverStatus] = useState<DriverItem["status"]>("active");
  const [notes, setNotes] = useState("");

  // Edit form states
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLicenseNumber, setEditLicenseNumber] = useState("");
  const [editLicenseExpiry, setEditLicenseExpiry] = useState("");
  const [editAssignedVehicleId, setEditAssignedVehicleId] = useState("");
  const [editHasAppAccess, setEditHasAppAccess] = useState(false);
  const [editStatus, setEditStatus] = useState<DriverItem["status"]>("active");
  const [editNotes, setEditNotes] = useState("");

  const filteredDrivers = drivers.filter((d) => {
    const matchesSearch =
      d.fullName.toLowerCase().includes(search.toLowerCase()) ||
      d.driverReference.toLowerCase().includes(search.toLowerCase()) ||
      (d.phone && d.phone.includes(search));

    const matchesStatus = statusFilter === "all" || d.status === statusFilter;
    const matchesMode =
      modeFilter === "all" ||
      (modeFilter === "app" && d.hasAppAccess) ||
      (modeFilter === "assisted" && !d.hasAppAccess);

    return matchesSearch && matchesStatus && matchesMode;
  });

  const handleOpenAdd = () => {
    setFullName("");
    setPhone("");
    setDriverReference(`DRV-CU-0${drivers.length + 1}`);
    setLicenseNumber("");
    setLicenseExpiry("");
    setAssignedVehicleId("");
    setHasAppAccess(false);
    setDriverStatus("active");
    setNotes("");
    setFormError(null);
    setFormSuccess(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (d: DriverItem) => {
    setEditingDriver(d);
    setEditFullName(d.fullName);
    setEditPhone(d.phone || "");
    setEditLicenseNumber(d.licenseNumber || "");
    setEditLicenseExpiry(d.licenseExpiry || "");
    setEditAssignedVehicleId(d.assignedVehicleId || "");
    setEditHasAppAccess(d.hasAppAccess);
    setEditStatus(d.status);
    setEditNotes(d.notes || "");
    setFormError(null);
    setFormSuccess(null);
  };

  const handleCreateDriver = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    startTransition(async () => {
      const res = await createDriverRecordAction({
        fullName,
        phone: phone || undefined,
        driverReference,
        licenseNumber: licenseNumber || undefined,
        licenseExpiry: licenseExpiry || undefined,
        assignedVehicleId: assignedVehicleId || undefined,
        status: driverStatus,
        hasAppAccess,
        notes: notes || undefined,
      });

      if (!res.success) {
        setFormError(res.error || "Failed to register driver.");
        return;
      }

      setFormSuccess(res.message || "Driver registered successfully.");
      setTimeout(() => {
        setShowAddModal(false);
        window.location.reload();
      }, 1000);
    });
  };

  const handleUpdateDriver = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDriver) return;
    setFormError(null);
    setFormSuccess(null);

    startTransition(async () => {
      const res = await updateDriverRecordAction({
        id: editingDriver.id,
        fullName: editFullName,
        phone: editPhone || undefined,
        licenseNumber: editLicenseNumber || undefined,
        licenseExpiry: editLicenseExpiry || undefined,
        assignedVehicleId: editAssignedVehicleId || null,
        status: editStatus,
        hasAppAccess: editHasAppAccess,
        notes: editNotes || undefined,
      });

      if (!res.success) {
        setFormError(res.error || "Failed to update driver.");
        return;
      }

      setFormSuccess(res.message || "Driver updated successfully.");
      setTimeout(() => {
        setEditingDriver(null);
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Policy banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-xl">🤝</span>
          <div>
            <h4 className="text-xs font-bold text-blue-900">
              Inclusive Driver Operations Policy (Mode A &amp; Mode B)
            </h4>
            <p className="mt-0.5 text-xs text-blue-700">
              Smartphone ownership is never mandatory for driver employment at Cosmopolitan University. Drivers without smartphones are registered in <strong>Mode B (Assisted Operations)</strong>, where authorised boarding officers log trip updates, departures, and milestones on their behalf without impersonation.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <input
              type="text"
              placeholder="Search driver name, reference, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs focus:border-[#102D4A] focus:outline-none"
            />
          </div>

          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Operational Modes</option>
            <option value="app">Mode A: Smartphone App Access</option>
            <option value="assisted">Mode B: Assisted Operations</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="on_leave">On Leave</option>
            <option value="suspended">Suspended</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <button
          onClick={handleOpenAdd}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a] transition-colors"
        >
          <span>+</span> Register Driver
        </button>
      </div>

      {/* Drivers Roster */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-[#102D4A]">
            Driver Roster &amp; Operational Modes ({filteredDrivers.length})
          </h3>
          <p className="mt-0.5 text-xs text-[#526B82]">
            Authorised drivers for campus shuttles, girls&apos; fleet, and inter-campus transit corridors.
          </p>
        </div>

        {filteredDrivers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
              👨‍✈️
            </div>
            <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Drivers Found</h4>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
              {search || modeFilter !== "all" || statusFilter !== "all"
                ? "No driver records matched your filter criteria."
                : "No drivers have been registered in the database yet."}
            </p>
            <div className="mt-4">
              <button
                onClick={handleOpenAdd}
                className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c233a]"
              >
                + Register First Driver
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Reference ID</th>
                  <th className="px-4 py-3 font-semibold">Full Name &amp; Contact</th>
                  <th className="px-4 py-3 font-semibold">Operational Mode</th>
                  <th className="px-4 py-3 font-semibold">Assigned Bus</th>
                  <th className="px-4 py-3 font-semibold">License Details</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredDrivers.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-mono font-bold text-[#102D4A] text-xs">
                        {d.driverReference}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold text-[#102D4A]">{d.fullName}</div>
                      <span className="text-[11px] text-[#526B82] font-mono">
                        {d.phone || "No phone provided"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.hasAppAccess ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                          <span>📱</span> Mode A (App Access)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          <span>🤝</span> Mode B (Assisted Ops)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.assignedVehiclePlate ? (
                        <div>
                          <span className="font-semibold text-[#102D4A]">
                            {d.assignedVehiclePlate}
                          </span>
                          <span className="block text-[10px] text-[#526B82]">
                            {d.assignedVehicleName || "Electric Bus"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">No default bus</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {d.licenseNumber ? (
                        <div>
                          <span className="font-mono font-medium text-slate-800">
                            {d.licenseNumber}
                          </span>
                          {d.licenseExpiry && (
                            <span className="block text-[10px] text-[#526B82]">
                              Exp: {d.licenseExpiry}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Unrecorded</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={d.status} statusConfig={DRIVER_STATUS_CONFIG} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleOpenEdit(d)}
                        className="rounded px-2.5 py-1 text-xs font-semibold text-[#102D4A] hover:bg-slate-100 transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Register Driver */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">Register Driver Record</h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Add a driver to the university transport roster with or without direct smartphone access.
            </p>

            {formError && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-[#D9534F] border border-rose-200">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                {formSuccess}
              </div>
            )}

            <form onSubmit={handleCreateDriver} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Institutional Ref *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. DRV-CU-01"
                    value={driverReference}
                    onChange={(e) => setDriverReference(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 uppercase focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Operational Status
                  </label>
                  <select
                    value={driverStatus}
                    onChange={(e) => setDriverStatus(e.target.value as DriverItem["status"])}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="on_leave">On Leave</option>
                    <option value="suspended">Suspended</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ibrahim Danjuma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Contact Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 08012345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">License Number</label>
                  <input
                    type="text"
                    placeholder="e.g. FCT-12345-DL"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">License Expiry</label>
                  <input
                    type="date"
                    value={licenseExpiry}
                    onChange={(e) => setLicenseExpiry(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Default Assigned Vehicle
                </label>
                <select
                  value={assignedVehicleId}
                  onChange={(e) => setAssignedVehicleId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="">-- No Default Vehicle --</option>
                  {availableVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationNumber} {v.name ? `(${v.name})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mode A vs Mode B switch */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center gap-2 font-semibold text-[#102D4A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasAppAccess}
                    onChange={(e) => setHasAppAccess(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#102D4A] focus:ring-[#102D4A]"
                  />
                  <span>Driver possesses a smartphone and has app access (Mode A)</span>
                </label>
                <p className="mt-1 text-[11px] text-[#526B82] pl-6">
                  {hasAppAccess
                    ? "Driver will log in directly to view their trips and report milestones."
                    : "Unchecked: Driver operates under Mode B (Boarding Officers record updates for this driver)."}
                </p>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Additional driver notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
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
                  {isPending ? "Registering..." : "Save Driver"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Driver */}
      {editingDriver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">
              Edit Driver: {editingDriver.driverReference}
            </h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Update driver status, phone, license, or assigned default vehicle.
            </p>

            {formError && (
              <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-[#D9534F] border border-rose-200">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
                {formSuccess}
              </div>
            )}

            <form onSubmit={handleUpdateDriver} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as DriverItem["status"])}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="on_leave">On Leave</option>
                    <option value="suspended">Suspended</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">License No</label>
                  <input
                    type="text"
                    value={editLicenseNumber}
                    onChange={(e) => setEditLicenseNumber(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">License Expiry</label>
                  <input
                    type="date"
                    value={editLicenseExpiry}
                    onChange={(e) => setEditLicenseExpiry(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Assigned Vehicle</label>
                <select
                  value={editAssignedVehicleId}
                  onChange={(e) => setEditAssignedVehicleId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="">-- No Default Vehicle --</option>
                  {availableVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registrationNumber} {v.name ? `(${v.name})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center gap-2 font-semibold text-[#102D4A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editHasAppAccess}
                    onChange={(e) => setEditHasAppAccess(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#102D4A] focus:ring-[#102D4A]"
                  />
                  <span>Has Direct Smartphone App Access (Mode A)</span>
                </label>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingDriver(null)}
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
                  {isPending ? "Updating..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
