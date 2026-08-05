export const CHECK_OUT_WAIT_MS = 50 * 60 * 1000;

// After this hour (KST, 24h clock), check-in is no longer accepted.
export const CHECKIN_CUTOFF_HOUR_KST = 22;

// How long the kiosk's "취소" toast stays up after a tap. Also doubles as the
// server-side delay before the arrival Kakao alert fires, so a cancel within
// the window (which deletes the record via undoCheckIn) suppresses the alert.
export const ATTENDANCE_UNDO_WINDOW_MS = 4500;
