"use client";

import React, { useState, useTransition } from "react";
import { updateSystemSettingAction } from "@/actions/admin";
import type { Json } from "@/lib/supabase/types";

export interface SettingItem {
  key: string;
  value: Json;
  description: string | null;
  updatedAt: string;
}

interface SettingsManagementProps {
  initialSettings: SettingItem[];
}

export function SettingsManagement({ initialSettings }: SettingsManagementProps) {
  const [settings, setSettings] = useState<SettingItem[]>(initialSettings);
  const [isPending, startTransition] = useTransition();

  // Active edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [editDesc, setEditDesc] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleStartEdit = (s: SettingItem) => {
    setEditingKey(s.key);
    setEditValue(
      typeof s.value === "object" ? JSON.stringify(s.value) : String(s.value)
    );
    setEditDesc(s.description || "");
    setActionError(null);
    setActionSuccess(null);
  };

  const handleSaveSetting = (key: string) => {
    setActionError(null);
    setActionSuccess(null);

    let parsedVal: Json = editValue;
    // Check if numeric
    if (!isNaN(Number(editValue)) && editValue.trim() !== "") {
      parsedVal = Number(editValue);
    } else if (editValue.toLowerCase() === "true") {
      parsedVal = true;
    } else if (editValue.toLowerCase() === "false") {
      parsedVal = false;
    } else {
      try {
        parsedVal = JSON.parse(editValue);
      } catch {
        parsedVal = editValue;
      }
    }

    startTransition(async () => {
      const res = await updateSystemSettingAction(key, parsedVal, editDesc || undefined);
      if (!res.success) {
        setActionError(res.error || "Failed to update setting.");
        return;
      }

      setActionSuccess(res.message || "Setting saved.");
      setTimeout(() => {
        setEditingKey(null);
        window.location.reload();
      }, 1000);
    });
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-[#102D4A]">
          University Mobility &amp; Booking Policy Controls
        </h3>
        <p className="mt-1 text-xs text-[#526B82]">
          Configure core operational parameters governing reservation cutoff thresholds, passenger capacity ceilings, and cancellation lead-times.
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
      </div>

      {/* Settings Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {settings.map((s) => {
          const isEditing = editingKey === s.key;
          return (
            <div
              key={s.key}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-mono text-xs font-bold text-[#102D4A]">
                    {s.key}
                  </h4>
                  <p className="mt-1 text-xs text-slate-600">
                    {s.description || "Operational configuration policy."}
                  </p>
                </div>
                {!isEditing && (
                  <button
                    onClick={() => handleStartEdit(s)}
                    className="rounded px-2.5 py-1 text-xs font-semibold text-[#102D4A] hover:bg-slate-100 transition-colors"
                  >
                    Edit Policy
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-800 mb-1">
                      Setting Value (String, Number, or Boolean)
                    </label>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#102D4A] focus:outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-800 mb-1">
                      Policy Description / Rationale
                    </label>
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-[#102D4A] focus:outline-none"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingKey(null)}
                      disabled={isPending}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveSetting(s.key)}
                      disabled={isPending}
                      className="rounded-lg bg-[#102D4A] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0c233a] disabled:opacity-50"
                    >
                      {isPending ? "Saving..." : "Save Setting"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#526B82]">
                    Current Live Value:
                  </span>
                  <div className="mt-1 font-mono text-sm font-bold text-[#102D4A]">
                    {typeof s.value === "object"
                      ? JSON.stringify(s.value)
                      : String(s.value)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
