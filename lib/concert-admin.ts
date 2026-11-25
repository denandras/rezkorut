import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getS4Config, getS4UpcomingPrefix } from "@/lib/s4-config";
import { parseUpcomingConcertsMarkdown, serializeConcert } from "@/lib/upcoming-concerts";
import type { Concert } from "@/lib/upcoming-concerts";

export type { Concert } from "@/lib/upcoming-concerts";

/** Input for creating a concert: everything the manager fills in, minus the generated id. */
export type ConcertInput = Omit<Concert, "id" | "note">;

/** Patch for updating a concert. The id is immutable and `note` is not persisted in the file. */
export type ConcertPatch = Partial<Omit<Concert, "id" | "note">>;

const UPCOMING_FILE_NAME = "rezkorut-upcoming-concerts.md";

type S4Config = NonNullable<ReturnType<typeof getS4Config>>;

// ---------------------------------------------------------------------------
// Hungarian date helpers
// ---------------------------------------------------------------------------

const HU_MONTH_NAMES = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
] as const;

const HU_MONTH_BY_NAME: Record<string, string> = Object.fromEntries(
  HU_MONTH_NAMES.map((name, index) => [name, String(index + 1).padStart(2, "0")]),
);

/**
 * Parses a Hungarian date like `2026. november 27.` (spaces around the dots
 * are optional, the day may be a single digit) into a sortable ISO date
 * (`2026-11-27`). Returns null when the string is not a pure Hungarian date.
 */
export function huDateToIso(hu: string): string | null {
  const match = hu
    .trim()
    .match(/^(\d{4})\s*\.\s*([a-záéíóöőúüű]+)\s*(\d{1,2})\s*\.\s*$/i);
  if (!match) return null;
  const [, year, monthName, day] = match;
  const month = HU_MONTH_BY_NAME[monthName.toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

/**
 * Formats a sortable ISO date (`2026-11-27`) as a Hungarian date
 * (`2026. november 27.`). Throws when the ISO date is malformed.
 */
export function isoToHuDate(iso: string): string {
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`[concert-admin] Invalid ISO date: ${JSON.stringify(iso)} (expected "2026-11-27")`);
  }
  const [, year, monthRaw, dayRaw] = match;
  const month = Number(monthRaw);
  if (month < 1 || month > 12) {
    throw new Error(`[concert-admin] Invalid month in ISO date: ${JSON.stringify(iso)}`);
  }
  const day = Number(dayRaw);
  if (day < 1 || day > 31) {
    throw new Error(`[concert-admin] Invalid day in ISO date: ${JSON.stringify(iso)}`);
  }
  return `${year}. ${HU_MONTH_NAMES[month - 1]} ${day}.`;
}

// ---------------------------------------------------------------------------
// Id derivation
// ---------------------------------------------------------------------------

/** Ascii-folds and slugifies: lowercase, accents folded, non-alnum runs to `-`, max 20 chars. */
function slugify(value: string): string {
  const folded = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ő/g, "o")
    .replace(/ű/g, "u")
    .replace(/[^a-z0-9]+/g, "-");
  return folded.replace(/^-+|-+$/g, "").slice(0, 20).replace(/-+$/g, "");
}

/**
 * Derives the stable concert id `rk-<YYYY-MM-DD>-<slug>` from the venue
 * (fallback: location). When the id already exists in `existingIds`, `-2`,
 * `-3`, ... is appended until it is unique.
 */
export function deriveConcertId(
  input: { date: string; venue: string; location: string },
  existingIds: ReadonlySet<string>,
): string {
  const isoDate = huDateToIso(input.date);
  if (!isoDate) {
    throw new Error(
      `[concert-admin] Cannot derive id: unparsable date ${JSON.stringify(input.date)} (expected "2026. november 27.")`,
    );
  }
  const slug = slugify(input.venue || input.location);
  if (!slug) {
    throw new Error("[concert-admin] Cannot derive id: both venue and location are empty");
  }
  const base = `rk-${isoDate}-${slug}`;
  if (!existingIds.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new Error(`[concert-admin] Cannot derive a unique id from ${JSON.stringify(base)}`);
}

// ---------------------------------------------------------------------------
// Content mutations (pure — operate on the markdown text, testable without S3)
// ---------------------------------------------------------------------------

function splitLines(content: string): { lines: string[]; eol: "\n" | "\r\n" } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return { lines: content.split(/\r?\n/), eol };
}

function parseConcertLine(line: string): Concert | null {
  return parseUpcomingConcertsMarkdown(line)[0] || null;
}

function collectConcertIds(content: string): Set<string> {
  const ids = new Set<string>();
  const { lines } = splitLines(content);
  for (const line of lines) {
    const concert = parseConcertLine(line);
    if (concert?.id) ids.add(concert.id);
  }
  return ids;
}

/**
 * Assigns derived ids to every concert line that does not carry an `id:rk-...`
 * field yet. Lines that already have an id — and every non-concert line — are
 * left byte-identical; id-less lines only gain the appended id field. Idempotent.
 */
export function assignMissingIds(content: string): string {
  if (!content) return content;
  const { lines, eol } = splitLines(content);
  const existingIds = collectConcertIds(content);
  let changed = false;
  const nextLines = lines.map((line) => {
    const concert = parseConcertLine(line);
    if (!concert || concert.id) return line;
    const id = deriveConcertId(concert, existingIds);
    existingIds.add(id);
    changed = true;
    return `${line.trimEnd()} | id:${id}`;
  });
  return changed ? nextLines.join(eol) : content;
}

/**
 * Inserts a serialized concert line at its chronological position: before the
 * first existing concert line dated strictly after it; otherwise appended at
 * the end of the file (the upcoming file is ascending by date, like today).
 */
function insertLineAtChronologicalPosition(content: string, line: string, isoDate: string): string {
  if (!content.trim()) return line;
  const { lines, eol } = splitLines(content);
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const concert = parseConcertLine(lines[i]);
    if (!concert) continue;
    const iso = huDateToIso(concert.date);
    if (iso && iso > isoDate) {
      insertAt = i;
      break;
    }
  }
  if (insertAt >= 0) {
    lines.splice(insertAt, 0, line);
  } else if (lines[lines.length - 1] === "") {
    // File ends with a newline: keep it as the file's trailing newline.
    lines.splice(lines.length - 1, 0, line);
  } else {
    lines.push(line);
  }
  return lines.join(eol);
}

/**
 * Creates a concert inside the file content (no S3 access): first migrates
 * id-less lines, then derives a unique id for the new concert and inserts the
 * serialized line at its chronological position. Returns the new content and
 * the stored concert.
 */
export function applyCreateConcert(
  content: string,
  input: ConcertInput,
): { content: string; concert: Concert } {
  const migrated = assignMissingIds(content);
  const isoDate = huDateToIso(input.date);
  if (!isoDate) {
    throw new Error(
      `[concert-admin] Cannot create concert: unparsable date ${JSON.stringify(input.date)} (expected "2026. november 27.")`,
    );
  }
  const id = deriveConcertId(input, collectConcertIds(migrated));
  const concert: Concert = { ...input, id };
  return { content: insertLineAtChronologicalPosition(migrated, serializeConcert(concert), isoDate), concert };
}

/**
 * Rewrites only the line of the concert with the given id, keeping every other
 * line byte-identical. Id-less lines get ids first (migration), so a caller can
 * update one of today's id-less concerts with the id the migration derives for
 * it. The id itself is immutable. Returns the new content and the updated concert.
 */
export function applyUpdateConcert(
  content: string,
  id: string,
  patch: ConcertPatch,
): { content: string; concert: Concert } {
  const migrated = assignMissingIds(content);
  const { lines, eol } = splitLines(migrated);
  const index = lines.findIndex((line) => parseConcertLine(line)?.id === id);
  if (index < 0) {
    throw new Error(`[concert-admin] No upcoming concert with id "${id}"`);
  }
  const current = parseConcertLine(lines[index]);
  if (!current) {
    throw new Error(`[concert-admin] Internal error: line ${index} is not a concert line`);
  }
  const concert: Concert = { ...current, ...patch, id };
  lines[index] = serializeConcert(concert);
  return { content: lines.join(eol), concert };
}

/** Removes the line of the concert with the given id, keeping every other line byte-identical. */
export function applyDeleteConcert(content: string, id: string): string {
  const migrated = assignMissingIds(content);
  const { lines, eol } = splitLines(migrated);
  const index = lines.findIndex((line) => parseConcertLine(line)?.id === id);
  if (index < 0) {
    throw new Error(`[concert-admin] No upcoming concert with id "${id}"`);
  }
  lines.splice(index, 1);
  return lines.join(eol);
}

// ---------------------------------------------------------------------------
// S3 file access (server-only)
// ---------------------------------------------------------------------------

function requireS4(): { cfg: S4Config; upcomingPrefix: string } {
  const cfg = getS4Config();
  const upcomingPrefix = getS4UpcomingPrefix();
  if (!cfg) {
    throw new Error(
      "[concert-admin] S4 configuration missing (S4_ENDPOINT, S4_ACCESS_KEY_ID, S4_SECRET_ACCESS_KEY, S4_PREFIX)",
    );
  }
  if (!upcomingPrefix) {
    throw new Error("[concert-admin] S4_UPCOMING_PREFIX is not configured");
  }
  return { cfg, upcomingPrefix };
}

function ensureTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function createS3Client(cfg: S4Config): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

/** Same file lookup as lib/upcoming-concerts.ts: list the prefix, match by file name. */
async function findUpcomingFileKey(
  client: S3Client,
  cfg: S4Config,
  upcomingPrefix: string,
): Promise<string> {
  const prefix = ensureTrailingSlash(upcomingPrefix);
  let token: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 500,
      }),
    );
    for (const obj of list.Contents ?? []) {
      if (!obj.Key) continue;
      const keyName = (obj.Key.split("/").pop() ?? "").toLowerCase();
      if (keyName === UPCOMING_FILE_NAME.toLowerCase()) {
        return obj.Key;
      }
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  // Not found yet: fall back to the canonical key so a write can create the file.
  return `${prefix}${UPCOMING_FILE_NAME}`;
}

function isMissingKeyError(err: unknown): boolean {
  return err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound");
}

async function fetchUpcomingFileContent(
  client: S3Client,
  cfg: S4Config,
  key: string,
): Promise<string> {
  try {
    const obj = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    const content = await obj.Body?.transformToString("utf-8");
    return content ?? "";
  } catch (err) {
    if (isMissingKeyError(err)) return "";
    throw err;
  }
}

async function readUpcomingFile(): Promise<{
  client: S3Client;
  cfg: S4Config;
  key: string;
  content: string;
}> {
  const { cfg, upcomingPrefix } = requireS4();
  const client = createS3Client(cfg);
  const key = await findUpcomingFileKey(client, cfg, upcomingPrefix);
  const content = await fetchUpcomingFileContent(client, cfg, key);
  return { client, cfg, key, content };
}

/** JSON.stringify with recursively sorted object keys (and undefined props dropped). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function assertConcertEqual(actual: Concert, expected: Concert, context: string): void {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(
      `[concert-admin] Write verification failed (${context}): expected ${stableStringify(expected)}, found ${stableStringify(actual)}`,
    );
  }
}

async function putUpcomingFileAndVerify(
  file: { client: S3Client; cfg: S4Config; key: string },
  nextContent: string,
  expectedConcertCount: number,
  verify: (concerts: Concert[]) => void,
): Promise<void> {
  await file.client.send(
    new PutObjectCommand({
      Bucket: file.cfg.bucket,
      Key: file.key,
      Body: nextContent,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );

  const reread = await fetchUpcomingFileContent(file.client, file.cfg, file.key);
  if (reread !== nextContent) {
    throw new Error(
      `[concert-admin] Write verification failed for ${file.key}: re-read content differs from what was written`,
    );
  }
  const concerts = parseUpcomingConcertsMarkdown(reread);
  if (concerts.length !== expectedConcertCount) {
    throw new Error(
      `[concert-admin] Write verification failed for ${file.key}: expected ${expectedConcertCount} concert(s) after the write, found ${concerts.length}`,
    );
  }
  verify(concerts);
}

/** Lists the concerts in the live upcoming-concerts file (read-only). */
export async function listUpcomingConcerts(): Promise<Concert[]> {
  const { content } = await readUpcomingFile();
  return parseUpcomingConcertsMarkdown(content);
}

export type UpcomingFileStat = {
  key: string;
  exists: boolean;
  lastModified: string | null;
  sizeBytes: number | null;
};

/** Read-only stat of the live upcoming-concerts file (used to prove reads do not modify it). */
export async function statUpcomingFile(): Promise<UpcomingFileStat> {
  const { cfg, upcomingPrefix } = requireS4();
  const client = createS3Client(cfg);
  const key = await findUpcomingFileKey(client, cfg, upcomingPrefix);
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return {
      key,
      exists: true,
      lastModified: head.LastModified?.toISOString() ?? null,
      sizeBytes: head.ContentLength ?? null,
    };
  } catch (err) {
    if (isMissingKeyError(err)) {
      return { key, exists: false, lastModified: null, sizeBytes: null };
    }
    throw err;
  }
}

/**
 * Creates a concert in the live upcoming-concerts file: read → migrate
 * id-less lines → derive a unique id → insert chronologically → PutObject →
 * re-read → verify. Returns the stored concert (with its id).
 */
export async function createConcert(input: ConcertInput): Promise<Concert> {
  const file = await readUpcomingFile();
  const existing = parseUpcomingConcertsMarkdown(file.content);
  const applied = applyCreateConcert(file.content, input);
  await putUpcomingFileAndVerify(file, applied.content, existing.length + 1, (concerts) => {
    const stored = concerts.find((c) => c.id === applied.concert.id);
    if (!stored) {
      throw new Error(
        `[concert-admin] Write verification failed: created concert id ${applied.concert.id} is missing from the file after the write`,
      );
    }
    assertConcertEqual(stored, applied.concert, `created concert ${applied.concert.id}`);
  });
  return applied.concert;
}

/**
 * Updates the concert with the given id in the live upcoming-concerts file.
 * Id-less lines get ids first (migration); only the target line is rewritten.
 */
export async function updateConcert(id: string, patch: ConcertPatch): Promise<Concert> {
  const file = await readUpcomingFile();
  const existing = parseUpcomingConcertsMarkdown(file.content);
  const applied = applyUpdateConcert(file.content, id, patch);
  await putUpcomingFileAndVerify(file, applied.content, existing.length, (concerts) => {
    const stored = concerts.find((c) => c.id === id);
    if (!stored) {
      throw new Error(
        `[concert-admin] Write verification failed: concert id ${id} is missing from the file after the write`,
      );
    }
    assertConcertEqual(stored, applied.concert, `updated concert ${id}`);
  });
  return applied.concert;
}

/** Deletes the concert with the given id from the live upcoming-concerts file. */
export async function deleteConcert(id: string): Promise<void> {
  const file = await readUpcomingFile();
  const existing = parseUpcomingConcertsMarkdown(file.content);
  const nextContent = applyDeleteConcert(file.content, id);
  await putUpcomingFileAndVerify(file, nextContent, existing.length - 1, (concerts) => {
    if (concerts.some((c) => c.id === id)) {
      throw new Error(
        `[concert-admin] Write verification failed: concert id ${id} is still present after the delete`,
      );
    }
  });
}
