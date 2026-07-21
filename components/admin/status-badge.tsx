import type { AttendanceStatus } from "@/lib/students";

const STATUS_COPY: Record<AttendanceStatus, { label: string; className: string }> = {
  checked_in: { label: "등원중", className: "bg-emerald-100 text-emerald-700" },
  checked_out: { label: "하원완료", className: "bg-sky-100 text-sky-700" },
  not_arrived: { label: "미등원", className: "bg-gray-200 text-gray-600" },
};

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  const { label, className } = STATUS_COPY[status];
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
