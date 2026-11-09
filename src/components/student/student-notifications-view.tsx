"use client";

import React, { useState, useTransition } from "react";
import { formatDate, formatTime } from "@/lib/utils";
import { markNotificationAsRead, markAllNotificationsAsRead } from "@/actions/notifications";
import {
  BellIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  BusIcon,
  TicketIcon,
} from "@/components/ui/icons";

export interface StudentNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  relatedJourneyId: string | null;
  isRead: boolean;
  createdAt: string;
}

interface StudentNotificationsViewProps {
  notifications: StudentNotification[];
}

export function StudentNotificationsView({ notifications }: StudentNotificationsViewProps) {
  const [items, setItems] = useState<StudentNotification[]>(notifications);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [isPending, startTransition] = useTransition();

  const unreadCount = items.filter((n) => !n.isRead).length;

  const filteredItems = items.filter((n) => {
    if (filter === "unread") return !n.isRead;
    return true;
  });

  function handleMarkRead(id: string) {
    startTransition(async () => {
      await markNotificationAsRead(id);
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsAsRead();
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    });
  }

  function getNotificationIcon(type: string) {
    switch (type) {
      case "delay_alert":
        return <AlertTriangleIcon className="w-4 h-4 text-[#E5A13B]" />;
      case "booking_confirmed":
        return <CheckCircleIcon className="w-4 h-4 text-[#20A477]" />;
      case "booking_cancelled":
        return <AlertTriangleIcon className="w-4 h-4 text-[#D9534F]" />;
      case "waitlist_promoted":
        return <TicketIcon className="w-4 h-4 text-purple-600" />;
      case "schedule_change":
        return <BusIcon className="w-4 h-4 text-[#102D4A]" />;
      default:
        return <BellIcon className="w-4 h-4 text-[#102D4A]" />;
    }
  }

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-[#102D4A]">
            OPERATIONAL ALERTS
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-[#102D4A] tracking-tight mt-1">
            Notifications
          </h1>
          <p className="text-xs text-[#526B82] mt-0.5">
            Real-time updates on delays, booking confirmations, and timetable notices
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={isPending}
            className="text-xs font-semibold text-[#102D4A] hover:underline self-start sm:self-auto"
          >
            Mark all as read ({unreadCount})
          </button>
        )}
      </div>

      {/* Segmented Filter */}
      <div className="flex items-center gap-1.5 p-1 bg-white rounded-xl border border-slate-200 w-fit shadow-xs">
        <button
          onClick={() => setFilter("all")}
          className={`py-1.5 px-4 text-xs font-bold rounded-lg transition-all ${
            filter === "all"
              ? "bg-[#102D4A] text-white shadow-xs"
              : "text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          All ({items.length})
        </button>

        <button
          onClick={() => setFilter("unread")}
          className={`py-1.5 px-4 text-xs font-bold rounded-lg transition-all ${
            filter === "unread"
              ? "bg-[#102D4A] text-white shadow-xs"
              : "text-[#526B82] hover:text-[#102D4A]"
          }`}
        >
          Unread ({unreadCount})
        </button>
      </div>

      {/* Notifications Feed */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <span className="text-4xl block mb-2">🔔</span>
          <h4 className="text-base font-bold text-[#102D4A]">No Notifications</h4>
          <p className="text-xs text-[#526B82] max-w-sm mx-auto mt-1">
            You are all caught up! Departure delays, seat confirmations, and route updates will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredItems.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.isRead && handleMarkRead(n.id)}
              className={`p-4 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                n.isRead
                  ? "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                  : "bg-white border-[#102D4A]/30 shadow-xs ring-1 ring-[#102D4A]/10"
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                {getNotificationIcon(n.type)}
              </div>

              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-[#102D4A]">
                      {n.title}
                    </h3>
                    {!n.isRead && (
                      <span className="w-2 h-2 rounded-full bg-[#20A477]" />
                    )}
                  </div>
                  <span className="text-[10px] text-[#526B82] font-mono shrink-0">
                    {formatDate(n.createdAt)} • {formatTime(n.createdAt)}
                  </span>
                </div>

                <p className="text-xs text-[#526B82] mt-1 leading-relaxed">
                  {n.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
