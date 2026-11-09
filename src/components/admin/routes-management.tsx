"use client";

import React, { useState, useTransition } from "react";
import {
  createRouteAction,
  addStopToRouteAction,
  removeStopFromRouteAction,
} from "@/actions/admin";

export interface RouteStopConfig {
  stopId: string;
  stopName: string;
  campusName: string | null;
  stopOrder: number;
  estimatedMinutesFromStart: number;
}

export interface RouteItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  genderGroup: "male" | "female" | "mixed";
  transportGroupId: string | null;
  transportGroupName: string;
  isActive: boolean;
  stops: RouteStopConfig[];
}

export interface TransportGroupOption {
  id: string;
  name: string;
  genderGroup: string;
}

export interface StopOption {
  id: string;
  name: string;
  campusName: string | null;
}

interface RoutesManagementProps {
  initialRoutes: RouteItem[];
  transportGroups: TransportGroupOption[];
  availableStops: StopOption[];
}

export function RoutesManagement({
  initialRoutes,
  transportGroups,
  availableStops,
}: RoutesManagementProps) {
  const [routes, setRoutes] = useState<RouteItem[]>(initialRoutes);
  const [selectedRouteId, setSelectedRouteId] = useState<string>(
    initialRoutes[0]?.id || ""
  );
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [showCreateRouteModal, setShowCreateRouteModal] = useState(false);
  const [showAddStopModal, setShowAddStopModal] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Create route form
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newGender, setNewGender] = useState<"male" | "female" | "mixed">("mixed");
  const [newTransportGroupId, setNewTransportGroupId] = useState(
    transportGroups[0]?.id || ""
  );

  // Add stop form
  const [addStopId, setAddStopId] = useState(availableStops[0]?.id || "");
  const [addStopOrder, setAddStopOrder] = useState(1);
  const [addEstimatedMin, setAddEstimatedMin] = useState(0);

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || routes[0];

  const handleOpenCreateRoute = () => {
    setNewCode("");
    setNewName("");
    setNewDesc("");
    setNewGender("mixed");
    setNewTransportGroupId(transportGroups[0]?.id || "");
    setActionError(null);
    setActionSuccess(null);
    setShowCreateRouteModal(true);
  };

  const handleOpenAddStop = () => {
    if (!selectedRoute) return;
    setAddStopId(availableStops[0]?.id || "");
    setAddStopOrder(selectedRoute.stops.length + 1);
    setAddEstimatedMin(selectedRoute.stops.length * 10);
    setActionError(null);
    setActionSuccess(null);
    setShowAddStopModal(true);
  };

  const handleCreateRoute = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    startTransition(async () => {
      const res = await createRouteAction({
        code: newCode,
        name: newName,
        description: newDesc,
        genderGroup: newGender,
        transportGroupId: newTransportGroupId,
      });

      if (!res.success) {
        setActionError(res.error || "Failed to create route.");
        return;
      }

      setActionSuccess(res.message || "Route created successfully.");
      setTimeout(() => {
        setShowCreateRouteModal(false);
        window.location.reload();
      }, 1000);
    });
  };

  const handleAddStop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoute) return;
    setActionError(null);
    setActionSuccess(null);

    startTransition(async () => {
      const res = await addStopToRouteAction({
        routeId: selectedRoute.id,
        stopId: addStopId,
        stopOrder: Number(addStopOrder),
        estimatedMinutesFromStart: Number(addEstimatedMin),
      });

      if (!res.success) {
        setActionError(res.error || "Failed to add stop to route.");
        return;
      }

      setActionSuccess("Stop added to route successfully.");
      setTimeout(() => {
        setShowAddStopModal(false);
        window.location.reload();
      }, 1000);
    });
  };

  const handleRemoveStop = (stopId: string) => {
    if (!selectedRoute) return;
    if (!confirm("Are you sure you want to remove this stop from the route?")) return;

    startTransition(async () => {
      const res = await removeStopFromRouteAction(selectedRoute.id, stopId);
      if (!res.success) {
        alert(res.error || "Failed to remove stop.");
        return;
      }
      window.location.reload();
    });
  };

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-[#102D4A]">
            Campus Corridors &amp; Transit Routes ({routes.length})
          </h3>
          <p className="text-xs text-[#526B82]">
            Define official shuttle routes and intermediate passenger pickup points between Main and Kado campuses.
          </p>
        </div>

        <button
          onClick={handleOpenCreateRoute}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0c233a] transition-colors"
        >
          <span>+</span> Create New Route
        </button>
      </div>

      {/* Routes & Stops Split Layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Routes Roster */}
        <div className="space-y-3 lg:col-span-1">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#526B82]">
            Configured Routes
          </h4>
          <div className="space-y-2">
            {routes.map((r) => {
              const isSelected = r.id === selectedRoute?.id;
              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedRouteId(r.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition-all ${
                    isSelected
                      ? "border-[#102D4A] bg-[#102D4A]/5 shadow-sm ring-1 ring-[#102D4A]"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono font-bold text-sm text-[#102D4A]">
                        {r.code}
                      </span>
                      <h5 className="font-semibold text-xs text-slate-900 mt-0.5">
                        {r.name}
                      </h5>
                    </div>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        r.genderGroup === "female"
                          ? "bg-purple-100 text-purple-800"
                          : r.genderGroup === "male"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {r.genderGroup.toUpperCase()}
                    </span>
                  </div>

                  <p className="mt-2 text-[11px] text-[#526B82] line-clamp-2">
                    {r.description || "Campus transport corridor."}
                  </p>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                    <span>Corridor: {r.transportGroupName}</span>
                    <span className="font-medium text-[#102D4A]">
                      {r.stops.length} stop(s)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Ordered Stops & Itinerary for Selected Route */}
        <div className="lg:col-span-2">
          {selectedRoute ? (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[#102D4A] text-base">
                      {selectedRoute.code}
                    </span>
                    <span className="text-slate-300">•</span>
                    <h3 className="font-bold text-sm text-slate-900">
                      {selectedRoute.name}
                    </h3>
                  </div>
                  <p className="mt-0.5 text-xs text-[#526B82]">
                    Corridor: <span className="font-semibold">{selectedRoute.transportGroupName}</span> • {selectedRoute.stops.length} Ordered Transit Stop(s)
                  </p>
                </div>

                <button
                  onClick={handleOpenAddStop}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#102D4A] bg-white px-3 py-1.5 text-xs font-semibold text-[#102D4A] hover:bg-slate-50"
                >
                  <span>+</span> Add Stop
                </button>
              </div>

              {selectedRoute.stops.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
                    🚏
                  </div>
                  <h4 className="mt-3 text-sm font-bold text-[#102D4A]">No Stops Configured</h4>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-[#526B82]">
                    This route does not have any passenger pickup or drop-off stops yet. Add stops to establish the scheduled itinerary.
                  </p>
                  <div className="mt-4">
                    <button
                      onClick={handleOpenAddStop}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#102D4A] px-4 py-2 text-xs font-semibold text-white"
                    >
                      + Add First Stop
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-5">
                  <div className="relative border-l-2 border-slate-200 ml-4 space-y-6">
                    {selectedRoute.stops.map((stop, idx) => (
                      <div key={stop.stopId} className="relative pl-6">
                        {/* Dot indicator */}
                        <div
                          className={`absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white ${
                            idx === 0
                              ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                              : idx === selectedRoute.stops.length - 1
                              ? "border-rose-600 bg-rose-50"
                              : "border-[#102D4A]"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3 hover:bg-slate-50 transition-colors">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[#102D4A]">
                                Stop #{stop.stopOrder}
                              </span>
                              <span className="font-semibold text-sm text-slate-900">
                                {stop.stopName}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-[#526B82]">
                              <span>Campus: {stop.campusName || "Main / Kado"}</span>
                              <span>•</span>
                              <span className="font-medium text-slate-700">
                                +{stop.estimatedMinutesFromStart} min from departure
                              </span>
                            </div>
                          </div>

                          <div className="mt-2 sm:mt-0 flex items-center gap-2">
                            <button
                              onClick={() => handleRemoveStop(stop.stopId)}
                              disabled={isPending}
                              className="text-xs font-semibold text-[#D9534F] hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <p className="text-xs text-[#526B82]">Select a route from the list to view its itinerary.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create Route */}
      {showCreateRouteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">Create Transportation Route</h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Define a new shuttle corridor for Cosmopolitan University bus services.
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

            <form onSubmit={handleCreateRoute} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Route Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. GF-MAIN-01"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 uppercase focus:border-[#102D4A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">Gender Group</label>
                  <select
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value as "male" | "female" | "mixed")}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  >
                    <option value="female">Girls&apos; Corridor</option>
                    <option value="male">Boys&apos; Corridor</option>
                    <option value="mixed">Mixed / General Fleet</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Route Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Girls Hostel to Main Campus - Morning"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Transport Group *</label>
                <select
                  value={newTransportGroupId}
                  onChange={(e) => setNewTransportGroupId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  {transportGroups.map((tg) => (
                    <option key={tg.id} value={tg.id}>
                      {tg.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Service corridor description, operating campuses..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                />
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateRouteModal(false)}
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
                  {isPending ? "Creating..." : "Create Route"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Stop */}
      {showAddStopModal && selectedRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#102D4A]">
              Add Stop to {selectedRoute.code}
            </h3>
            <p className="mt-1 text-xs text-[#526B82]">
              Attach an approved campus pickup stop and specify sequence in the itinerary.
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

            <form onSubmit={handleAddStop} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#102D4A] mb-1">Select Stop *</label>
                <select
                  value={addStopId}
                  onChange={(e) => setAddStopId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                >
                  {availableStops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.campusName ? `(${s.campusName})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Stop Sequence Order *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    required
                    value={addStopOrder}
                    onChange={(e) => setAddStopOrder(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                  <p className="mt-0.5 text-[10px] text-[#526B82]">1 = Departure origin</p>
                </div>

                <div>
                  <label className="block font-semibold text-[#102D4A] mb-1">
                    Est. Minutes from Start
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    required
                    value={addEstimatedMin}
                    onChange={(e) => setAddEstimatedMin(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 p-2 focus:border-[#102D4A] focus:outline-none"
                  />
                  <p className="mt-0.5 text-[10px] text-[#526B82]">Travel transit time</p>
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddStopModal(false)}
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
                  {isPending ? "Adding..." : "Add to Itinerary"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
