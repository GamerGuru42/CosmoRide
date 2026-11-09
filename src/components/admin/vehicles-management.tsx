"use client";

import React, { useState, useTransition } from "react";
import { createVehicleAction, updateVehicleAction } from "@/actions/admin";
import { StatusBadge } from "@/components/ui/status-badge";
import { BusIcon, AlertTriangleIcon, CheckCircleIcon } from "@/components/ui/icons";

export interface VehicleRecord {
  id: string;
  registrationNumber: string;
  name: string | null;
  safeCapacity: number;
  vehicleType: string;
  ownershipType: string;
  vehicleReference: string | null;
  status: "available" | "assigned" | "maintenance" | "retired" | "unavailable";
  maintenanceNotes: string | null;
  isActive: boolean;
  createdAt: string;
}

interface VehiclesManagementProps {
  initialVehicles: VehicleRecord[];
}

const VEHICLE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available: { label: "Available", color: "bg-emerald-100 text-emerald-800" },
  assigned: { label: "Assigned", color: "bg-blue-100 text-blue-800" },
  maintenance: { label: "Under Maintenance", color: "bg-amber-100 text-amber-800" },
  retired: { label: "Retired", color: "bg-slate-100 text-slate-700" },
  unavailable: { label: "Unavailable", color: "bg-rose-100 text-rose-800" },
};

export function VehiclesManagement({ initialVehicles }: VehiclesManagementProps) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>(initialVehicles);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Form inputs for Add
  const [regNumber, setRegNumber] = useState("");
  const [name, setName] = useState("");
  const [safeCap, setSafeCap] = useState(30);
  const [vehType, setVehType] = useState("electric_bus");
  const [ownType, setOwnType] = useState("university_owned");
  const [vehRef, setVehRef] = useState("");
  const [notes, setNotes] = useState("");

  // Edit form state
  const [editStatus, setEditStatus] = useState<VehicleRecord["status"]>("available");
  const [editSafeCap, setEditSafeCap] = useState(30);
  const [editNotes, setEditNotes] = useState("");

  const filteredVehicles = vehicles.filter((v) => {
    const matchesSearch =
      v.registrationNumber.toLowerCase().includes(search.toLowerCase()) ||
      (v.name && v.name.toLowerCase().includes(search.toLowerCase())) ||
      (v.vehicleReference && v.vehicleReference.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === "all" || v.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenAddModal = () => {
    setRegNumber("");
    setName("");
    setSafeCap(30);
    setVehType("electric_bus");
    setOwnType("university_owned");
    setVehRef("");
    setNotes("");
    setFormError(null);
    setFormSuccess(null);
    setShowAddModal(true);
  };

  const handleOpenEditModal = (v: VehicleRecord) => {
    setEditingVehicle(v);
    setEditStatus(v.status);
    setEditSafeCap(v.safeCapacity);
    setEditNotes(v.maintenanceNotes || "");
    setFormError(null);
    setFormSuccess(null);
  };

  const handleCreateVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    startTransition(async () => {
      const res = await createVehicleAction({
        registrationNumber: regNumber,
        name,
        safeCapacity: Number(safeCap),
        vehicleType: vehType,
        ownershipType: ownType,
        vehicleReference: vehRef || undefined,
        maintenanceNotes: notes || undefined,
      });

      if (!res.success) {
        setFormError(res.error || "Failed to register vehicle.");
        return;
      }

      setFormSuccess(res.message || "Vehicle registered successfully.");
      setTimeout(() => {
        setShowAddModal(false);
        window.location.reload();
      }, 1000);
    });
  };

  const handleUpdateVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicle) return;
    setFormError(null);
    setFormSuccess(null);

    startTransition(async () => {
      const res = await updateVehicleAction({
        id: editingVehicle.id,
        safeCapacity: Number(editSafeCap),
        status: editStatus,
        maintenanceNotes: editNotes,
      });

      if (!res.success) {
        setFormError(res.error || "Failed to update vehicle.");
        return;
      }

      setFormSuccess(res.message || "Vehicle updated successfully.");
      setTimeout(() => {
        setEditingVehicle(null);
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Top action & filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <input
              type="text"
              placeholder="Search registration, name, callsign..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-xs focus:border-[#102D4A] focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-[#102D4A] focus:outline-none"
          >
            <option value="all">All Operational Statuses</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
            <option value="maintenance">Under Maintenance</option>
            <option value="retired">Retired</option>
          </select>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a] transition-colors"
        >
          <span>+</span> Register Fleet Vehicle
        </button>
      </div>

      {/* Fleet table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-[#102D4A]">
            Cosmopolitan University Fleet Inventory ({filteredVehicles.length})
          </h3>
          <p className="mt-0.5 text-xs text-[#526B82]">
            Authorised electric buses and campus shuttles with certified safe seating capacities.
          </p>
        </div>

        {filteredVehicles.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
              🚍
            </div>
            <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Vehicles Found</h4>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
              {search || statusFilter !== "all"
                ? "No fleet vehicles matched your search filters."
                : "No vehicles have been registered in the fleet yet."}
            </p>
            <div className="mt-4">
              <button
                onClick={handleOpenAddModal}
                className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c233a]"
              >
                + Register First Bus
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-[#526B82]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Plate / Reference</th>
                  <th className="px-4 py-3 font-semibold">Callsign & Type</th>
                  <th className="px-4 py-3 font-semibold text-center">Safe Seating Capacity</th>
                  <th className="px-4 py-3 font-semibold">Ownership</th>
                  <th className="px-4 py-3 font-semibold">Operational Status</th>
                  <th className="px-4 py-3 font-semibold">Maintenance / Notes</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredVehicles.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono font-bold text-[#102D4A] text-sm">
                        {v.registrationNumber}
                      </div>
                      {v.vehicleReference && (
                        <span className="text-[10px] text-[#526B82]">
                          Ref: {v.vehicleReference}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold text-[#102D4A]">{v.name || "University Bus"}</div>
                      <span className="capitalize text-[10px] text-[#526B82]">
                        {v.vehicleType.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-800 text-xs">
                        {v.safeCapacity} seats
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap capitalize text-[#526B82]">
                      {v.ownershipType.replace("_", " ")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={v.status} statusConfig={VEHICLE_STATUS_CONFIG} />
                    </td>
                    <td className="px-4 py-3">
                      {v.maintenanceNotes ? (
                        <p className="text-[11px] text-slate-600 line-clamp-1 max-w-[200px]">
                          {v.maintenanceNotes}
                        </p>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Normal service</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleOpenEditModal(v)}
                        className="rounded px-2.5 py-1 text-xs font-semibold text-[#102D4A] hover:bg-slate-100 transition-colors"
                      >
                        Edit Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Register Vehicle */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">Register New Fleet Vehicle</h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Add an electric bus or shuttle to the university fleet register with approved seating limits.
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

            <form onSubmit={handleCreateVehicle} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Registration Number * (License Plate)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CU-BUS-01 or ABC-123-XY"
                  value={regNumber}
                  onChange={(e) => setRegNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 uppercase focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Vehicle Name / Callsign *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Electric Bus Alpha (Girls Fleet)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Safe Seating Capacity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    required
                    value={safeCap}
                    onChange={(e) => setSafeCap(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                  <p className="mt-0.5 text-[10px] text-[#526B82]">Strictly enforced ceiling.</p>
                </div>

                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Vehicle Type</label>
                  <select
                    value={vehType}
                    onChange={(e) => setVehType(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="electric_bus">Electric Bus</option>
                    <option value="shuttle_bus">Shuttle Bus</option>
                    <option value="minivan">Minivan</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Ownership</label>
                  <select
                    value={ownType}
                    onChange={(e) => setOwnType(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="university_owned">University Owned</option>
                    <option value="leased">Leased</option>
                    <option value="chartered">Chartered</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Fleet Reference ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. FLEET-01"
                    value={vehRef}
                    onChange={(e) => setVehRef(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Maintenance / Inspection Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Battery condition, tire pressure, AC inspection notes..."
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
                  {isPending ? "Registering..." : "Save Vehicle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Vehicle */}
      {editingVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">
              Edit Vehicle: {editingVehicle.registrationNumber}
            </h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Update operational readiness status, approved capacity, or maintenance records.
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

            <form onSubmit={handleUpdateVehicle} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Operational Status *
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as VehicleRecord["status"])}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  <option value="available">Available (Ready for Dispatch)</option>
                  <option value="assigned">Assigned (Active on Route)</option>
                  <option value="maintenance">Under Maintenance (Cannot Dispatch)</option>
                  <option value="retired">Retired</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Certified Safe Capacity *
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={editSafeCap}
                  onChange={(e) => setEditSafeCap(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">
                  Maintenance / Service Log Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Record workshop visits, oil checks, or mechanical issues..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingVehicle(null)}
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

