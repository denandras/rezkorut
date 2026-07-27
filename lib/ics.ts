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
 * local time, then converts to UTC for the ICS DTSTART.
 */
export function parseConcertDate(dateStr: string, timeStr?: string): Date | null {
  // "2026. szeptember 12." → year=2026, month=9, day=12
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

  // Create a date in Budapest timezone, then convert to UTC.
  // Use Intl API to get the timezone offset for the specific date
  // (handles DST correctly).
  const localStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  // Europe/Budapest is UTC+1 (CET) or UTC+2 (CEST). We'll compute the offset.
  const utcDate = new Date(localStr);
  // The Date constructor treats this as local time of the server, but we need
  // Budapest time. Use formatToParts to get the actual offset.
  const budapestDate = new Date(
    utcDate.toLocaleString("en-US", { timeZone: "Europe/Budapest" }),
  );
  const serverDate = new Date(
    utcDate.toLocaleString("en-US", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  );
  const offsetMs = serverDate.getTime() - budapestDate.getTime();
  return new Date(utcDate.getTime() - offsetMs);
}

/** Formats a Date as ICS UTC timestamp: 20260912T190000Z */
function formatICSUTC(date: Date): string {
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

/** Escapes text values per RFC 5545 (backslash, semicolon, comma, newline). */
function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds long lines to 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let remaining = line;
  chunks.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    chunks.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return chunks.join("\r\n");
}

const REMINDERS = [
  { weeks: 1, description: "Emlékeztető: 1 hét múlva koncert" },
  { days: 1, description: "Emlékeztető: 1 nap múlva koncert" },
  { hours: 1, description: "Emlékeztető: 1 óra múlva koncert" },
];

function alarmTrigger({ weeks, days, hours }: { weeks?: number; days?: number; hours?: number }): string {
  // Negative = before the event (RFC 5545)
  if (weeks) return `-P${weeks}W`;
  if (days) return `-P${days}D`;
  if (hours) return `-PT${hours}H`;
  return "-PT1H";
}

export type ICSResult = {
  ics: string;
  filename: string;
};

/**
 * Generates a complete .ics calendar file for a concert with 3 reminders
 * (1 week, 1 day, 1 hour before the event).
 */
export function generateConcertICS(concert: Concert): ICSResult | null {
  const start = parseConcertDate(concert.date, concert.time);
  if (!start) return null;

  // Default duration: 2 hours for a concert
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const dtstamp = formatICSUTC(new Date());
  const dtstart = formatICSUTC(start);
  const dtend = formatICSUTC(end);

  const location = `${concert.location}, ${concert.venue}`;
  const summary = concert.title;
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
  const description = descriptionParts.join("\n");

  // Unique ID: rezkorut.hu + date + title hash
  const uid = `rezkorut-${dtstart}-${slugify(concert.title)}@rezkorut.hu`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Réz körút//Naptár//HU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeICS(summary)}`,
    `LOCATION:${escapeICS(location)}`,
    `DESCRIPTION:${escapeICS(description)}`,
  ];

  for (const reminder of REMINDERS) {
    lines.push(
      "BEGIN:VALARM",
      `TRIGGER:${alarmTrigger(reminder)}`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeICS(reminder.description)}`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  const ics = lines.map(foldLine).join("\r\n");
  const filename = `rez-korut-${slugify(concert.title)}-${dtstart.slice(0, 8)}.ics`;

  return { ics, filename };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}