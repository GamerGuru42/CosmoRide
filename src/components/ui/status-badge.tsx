/**
 * StatusBadge — displays a colored badge for journey/booking statuses.
 */
interface StatusBadgeProps {
  status: string;
  statusConfig: Record<string, { label: string; color: string }>;
}

export function StatusBadge({ status, statusConfig }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    label: status,
    color: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}
    >
      {config.label}
    </span>
  );
}

