import type { Concert } from "@/lib/upcoming-concerts";

/**
 * Hungarian month names → month number (1–12).
 */
const HU_MONTHS: Record<string, number> = {
  január: 1, február: 2, március: 3, április: 4, május: 5, június: 6,
  július: 7, augusztus: 8, szeptember: 9, október: 10, november: 11, december: 12,
};

/**
 * Parses a Hungarian concert date + optional time into a UTC Date.
 *
 * Date format: "2026. szeptember 12."
 * Time format: "19:00" or "16:00"
 *
 * Assumes Central European Time (CET/CEST, Europe/Budapest) for the concert
 * local time, then converts to UTC.
 */
export function parseConcertDate(dateStr: string, timeStr?: string): Date | null {
  const match = dateStr.match(/(\d{4})\.\s*(\p{L}+)\s+(\d+)/u);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = HU_MONTHS[match[2].toLowerCase()];
  const day = parseInt(match[3], 10);
  if (!month) return null;

  let hours = 19;
  let minutes = 0;
  if (timeStr) {
    const tm = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (tm) {
      hours = parseInt(tm[1], 10);
      minutes = parseInt(tm[2], 10);
    }
  }

  // Convert Budapest wall-clock time to UTC, independent of the server's TZ.
  // First guess: treat the wall-clock time as UTC, then measure Budapest's
  // offset at that instant via formatToParts (never re-parse a localized
  // string with `new Date` — that resolves in the server's local zone).
  const guessUtc = Date.UTC(year, month - 1, day, hours, minutes, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Budapest",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(guessUtc))) {
    parts[p.type] = p.value;
  }
  const budapestWallUtc = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10) % 24,
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10),
  );
  const offsetMs = budapestWallUtc - guessUtc;
  return new Date(guessUtc - offsetMs);
}

/** Formats a Date as Google Calendar UTC timestamp: 20260912T170000Z */
function formatGoogleDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

/** Formats a Date as Google Calendar all-day date: 20260912 (next day for end) */
function formatGoogleAllDayDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate())
  );
}

/**
 * Parses a Hungarian date string (no time) into a UTC Date at midnight.
 */
function parseConcertDateOnly(dateStr: string): Date | null {
  const match = dateStr.match(/(\d{4})\.\s*(\p{L}+)\s+(\d+)/u);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = HU_MONTHS[match[2].toLowerCase()];
  const day = parseInt(match[3], 10);
  if (!month) return null;

  // Use noon UTC to avoid any timezone edge cases shifting the day
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Generates a Google Calendar "add event" URL for a concert.
 *
 * Opens Google Calendar with the event pre-filled — user just clicks Save.
 * Works on all devices (mobile + desktop) with a browser.
 *
 * If the concert has a start time, creates a timed 2-hour event.
 * If no start time, creates an all-day event.
 */
export function generateGoogleCalendarUrl(concert: Concert): string | null {
  const location = `${concert.location}, ${concert.venue}`;

  const descriptionParts: string[] = [];
  if (concert.program && concert.program.length > 0) {
    descriptionParts.push("Program:");
    for (const item of concert.program) {
      descriptionParts.push(`• ${item}`);
    }
  }
  if (concert.note) {
    descriptionParts.push("");
    descriptionParts.push(concert.note);
  }
  if (concert.link) {
    descriptionParts.push("");
    descriptionParts.push(`${concert.link.label}: ${concert.link.href}`);
  }

  let dates: string;

  if (concert.time) {
    // Timed event: 2-hour duration
    const start = parseConcertDate(concert.date, concert.time);
    if (!start) return null;
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    dates = `${formatGoogleDateTime(start)}/${formatGoogleDateTime(end)}`;
  } else {
    // All-day event (no start time)
    const day = parseConcertDateOnly(concert.date);
    if (!day) return null;
    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    dates = `${formatGoogleAllDayDate(day)}/${formatGoogleAllDayDate(nextDay)}`;
  }

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: concert.title,
    dates,
    location,
    details: descriptionParts.join("\n"),
  });

  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
}