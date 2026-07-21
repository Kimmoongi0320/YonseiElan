export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

export function formatRemainingMinutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
