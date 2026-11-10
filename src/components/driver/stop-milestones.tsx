"use client";

import React, { useState, useTransition } from "react";
import { formatTime } from "@/lib/utils";
import { recordStopMilestoneAction } from "@/actions/driver";

export interface RouteStopItem {
  id: string; // stop id
  name: string;
  order: number;
  estimatedMinutesFromStart: number | null;
  lastUpdate?: {
    eventType: "approaching" | "arrived" | "pickup_completed" | "departed";
    timestamp: string;
    isAssisted: boolean;
    notes?: string | null;
  } | null;
}

interface StopMilestonesProps {
  journeyId: string;
  stops: RouteStopItem[];
  isAssisted?: boolean;
  onUpdateSuccess?: () => void;
}

export function StopMilestones({
  journeyId,
  stops,
  isAssisted = false,
  onUpdateSuccess,
}: StopMilestonesProps) {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [actionNotes, setActionNotes] = useState<string>("");
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRecordEvent(
    stopId: string,
    eventType: "approaching" | "arrived" | "pickup_completed" | "departed"
  ) {
    startTransition(async () => {
      const res = await recordStopMilestoneAction({
        journeyId,
        stopId,
        eventType,
        notes: actionNotes.trim() || undefined,
        isAssisted,
      });

      if (res.success) {
        setFeedbackBanner(res.message || "Stop update recorded.");
        setSelectedStopId(null);
        setActionNotes("");
        if (onUpdateSuccess) onUpdateSuccess();
        setTimeout(() => setFeedbackBanner(null), 3500);
      } else {
        alert(res.error || "Failed to log stop update.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-[#102D4A] uppercase tracking-wider font-mono">
            ROUTE STOP MILESTONES
          </h3>
          <p className="text-xs text-[#526B82] mt-0.5">
            Log milestone events at scheduled stops. Informs student departure board without live GPS.
          </p>
        </div>
      </div>

      {feedbackBanner && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-2 animate-in fade-in">
          <span>✓</span>
          <span>{feedbackBanner}</span>
        </div>
      )}

      {/* Ordered Stops List */}
      <div className="space-y-3">
        {stops.map((stop, index) => {
          const isSelected = selectedStopId === stop.id;
          const hasUpdate = Boolean(stop.lastUpdate);

          return (
            <div
              key={stop.id}
              className={`rounded-2xl border p-4 transition-all ${
                isSelected
                  ? "border-[#102D4A] bg-[#F6F8FA] shadow-xs"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#102D4A] text-white font-mono text-xs font-bold shrink-0 mt-0.5">
                    {index + 1}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#102D4A]">
                      {stop.name}
                    </h4>
                    <p className="text-[11px] text-[#526B82]">
                      {stop.estimatedMinutesFromStart != null && stop.estimatedMinutesFromStart > 0
                        ? `Est. +${stop.estimatedMinutesFromStart} min from departure`
                        : stop.order === 1
                        ? "Terminal departure point"
                        : "Travel duration unverified"}
                    </p>

                    {/* Milestone badge */}
                    {stop.lastUpdate && (
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-800">
                          {stop.lastUpdate.eventType.replace("_", " ")} at {formatTime(stop.lastUpdate.timestamp)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-medium">
                          ({stop.lastUpdate.isAssisted ? "Representative recorded" : "Driver reported"})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Open Action Controls */}
                <button
                  type="button"
                  onClick={() => setSelectedStopId(isSelected ? null : stop.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors self-start sm:self-auto ${
                    isSelected
                      ? "bg-slate-200 text-[#102D4A]"
                      : "bg-slate-100 text-[#526B82] hover:bg-slate-200 hover:text-[#102D4A]"
                  }`}
                >
                  {isSelected ? "Close" : "Update Stop"}
                </button>
              </div>

              {/* Action Buttons Drawer */}
              {isSelected && (
                <div className="mt-3 pt-3 border-t border-slate-200 space-y-2.5 animate-in fade-in duration-100">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRecordEvent(stop.id, "approaching")}
                      className="py-2 px-2 text-center text-xs font-bold rounded-xl border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      Approaching
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRecordEvent(stop.id, "arrived")}
                      className="py-2 px-2 text-center text-xs font-bold rounded-xl border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50"
                    >
                      Arrived at Stop
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRecordEvent(stop.id, "pickup_completed")}
                      className="py-2 px-2 text-center text-xs font-bold rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                    >
                      Pickup Done
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRecordEvent(stop.id, "departed")}
                      className="py-2 px-2 text-center text-xs font-bold rounded-xl border border-slate-300 bg-slate-100 text-[#102D4A] hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                      Departed Stop
                    </button>
                  </div>

                  <input
                    type="text"
                    value={actionNotes}
                    onChange={(e) => setActionNotes(e.target.value)}
                    placeholder="Optional milestone note (e.g. 12 students boarded at gate)"
                    className="w-full text-xs p-2 rounded-xl border border-slate-300 bg-white text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

