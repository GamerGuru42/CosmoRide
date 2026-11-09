"use client";

import React, { useState, useTransition } from "react";
import { reportOperationalIncident } from "@/actions/boarding";

interface IncidentModalProps {
  journeyId: string | null;
  vehicleId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const INCIDENT_CATEGORIES = [
  { value: "student_left_behind", label: "Student Left Behind / Over-capacity" },
  { value: "bus_breakdown", label: "Bus Breakdown / Mechanical Failure" },
  { value: "missed_pickup", label: "Missed Scheduled Pickup Stop" },
  { value: "overcrowding", label: "Overcrowding / Line Contention" },
  { value: "incorrect_passenger_assignment", label: "Incorrect Corridor / Student Mismatch" },
  { value: "other", label: "Other Operational Exception" },
];

export function IncidentModal({
  journeyId,
  vehicleId,
  isOpen,
  onClose,
}: IncidentModalProps) {
  const [category, setCategory] = useState<string>(INCIDENT_CATEGORIES[0].value);
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [description, setDescription] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    if (description.trim().length < 10) {
      setErrorMessage("Please enter at least 10 characters describing the incident.");
      return;
    }

    startTransition(async () => {
      const res = await reportOperationalIncident(
        journeyId,
        vehicleId,
        category,
        severity,
        description
      );

      if (res.success) {
        setIsSuccess(true);
        setTimeout(() => {
          setIsSuccess(false);
          setDescription("");
          onClose();
        }, 1800);
      } else {
        setErrorMessage(res.error || "Failed to submit incident report.");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Report Operational Incident"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-[#102D4A] px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="text-base font-bold">Report Operational Incident</h3>
              <p className="text-xs text-slate-300">
                Log exception for university transport management
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-slate-300 hover:text-white text-lg font-bold p-1"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        {isSuccess ? (
          <div className="p-8 text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-[#20A477] text-2xl font-bold">
              ✓
            </div>
            <h4 className="text-base font-bold text-[#102D4A]">
              Incident Successfully Reported
            </h4>
            <p className="text-xs text-[#526B82]">
              The operational exception has been logged and transmitted to the Transport Administration team.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {errorMessage && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 font-medium">
                {errorMessage}
              </div>
            )}

            {/* Category */}
            <div>
              <label
                htmlFor="incident-category"
                className="block text-xs font-bold text-[#526B82] uppercase tracking-wider mb-1.5"
              >
                Incident Category
              </label>
              <select
                id="incident-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs font-semibold bg-[#F6F8FA] border border-slate-300 rounded-xl px-3.5 py-2.5 text-[#102D4A] focus:outline-none focus:border-[#102D4A]"
              >
                {INCIDENT_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Severity */}
            <div>
              <label className="block text-xs font-bold text-[#526B82] uppercase tracking-wider mb-1.5">
                Severity Level
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(["low", "medium", "high", "critical"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setSeverity(lvl)}
                    className={`py-2 text-xs font-bold rounded-xl border capitalize transition-all ${
                      severity === lvl
                        ? lvl === "critical"
                          ? "bg-rose-600 text-white border-rose-600"
                          : lvl === "high"
                          ? "bg-[#D9534F] text-white border-[#D9534F]"
                          : lvl === "medium"
                          ? "bg-[#E5A13B] text-white border-[#E5A13B]"
                          : "bg-[#20A477] text-white border-[#20A477]"
                        : "bg-white text-[#526B82] border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="incident-desc"
                className="block text-xs font-bold text-[#526B82] uppercase tracking-wider mb-1.5"
              >
                Detailed Explanation
              </label>
              <textarea
                id="incident-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="State what occurred, student details if left behind, time of event, and current status..."
                className="w-full text-xs bg-[#F6F8FA] border border-slate-300 rounded-xl p-3 text-[#102D4A] placeholder-slate-400 focus:outline-none focus:border-[#102D4A]"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="flex-1 py-2.5 text-xs font-bold text-[#526B82] bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-[#D9534F] hover:bg-rose-700 rounded-xl shadow-xs transition-colors disabled:opacity-50"
              >
                {isPending ? "Submitting Log..." : "Submit Incident Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
