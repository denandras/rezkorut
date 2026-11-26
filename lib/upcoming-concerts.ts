import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getS4Config, getS4UpcomingPrefix } from "@/lib/s4-config";

export type Concert = {
  /**
   * Stable identifier (`rk-<YYYY-MM-DD>-<slug>`), stored as the optional 9th
   * pipe field (`id:rk-...`). Legacy lines may not have one yet.
   */
  id?: string;
  /**
   * `/jegyek/<id>` — set by `withTicketUrls` (lib/tickets-public) for concerts
   * whose ticketing is `on_sale`. Server pages annotate the S3 concerts with
   * it before rendering; it is never stored in the file. Drives the
   * „Jegyvásárlás” CTA on the concert card.
   */
  ticketUrl?: string;
  date: string;
  time?: string;
  location: string;
  venue: string;
  title: string;
  program?: string[];
  link?: { label: string; href: string };
  note?: string;
};

function isLikelyHref(value: string | undefined): boolean {
  if (!value) return false;
  return /^(https?:\/\/|mailto:|tel:|\/)/i.test(value.trim());
}

/** Shape of the optional trailing id field: `id:rk-2026-11-27-bmc-konyvtar`. */
const CONCERT_ID_FIELD = /^id:(rk-[a-z0-9-]+)$/;

function ensureTrailingSlash(prefix: string) {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

/**
 * Parses the rezkorut upcoming concerts markdown format.
 *
 * Each concert is a bullet line with pipe-separated fields:
 *   - date | time | location | venue | title | program (semicolon-separated) | href | href_label | id:rk-...
 *
 * `time`, `program`, `href`, `href_label` and the trailing `id:rk-...` field are
 * optional. The id field may appear anywhere after the title; it is never
 * mistaken for a program or an href. If no program field is present, the field
 * after title may be an href directly.
 */
export function parseUpcomingConcertsMarkdown(raw: string): Concert[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());

  return lines
    .map((line) => line.split("|").map((p) => p.trim()))
    .filter((parts) => parts.length >= 5)
    .map((parts) => {
      const [date, time, location, venue, title, ...restWithIds] = parts;

      // Pull out the optional id field(s) first so the remaining logic below
      // (program / href detection) can never mistake `id:rk-...` for either.
      // If more than one id field is present, the last one wins.
      let id: string | undefined;
      const rest: string[] = [];
      for (const part of restWithIds) {
        const idMatch = CONCERT_ID_FIELD.exec(part);
        if (idMatch) {
          id = idMatch[1];
        } else {
          rest.push(part);
        }
      }

      // rest: [program?, href?, href_label?]
      // href can appear at rest[0] if there is no program field
      const hrefIndex = rest.findIndex((v) => isLikelyHref(v));
      const programRaw =
        hrefIndex > 0
          ? rest[0]
          : hrefIndex < 0
            ? rest[0]
            : undefined;
      const href = hrefIndex >= 0 ? rest[hrefIndex] : undefined;
      const hrefLabel = hrefIndex >= 0 ? rest[hrefIndex + 1] : undefined;

      const program =
        programRaw && programRaw.length > 0
          ? programRaw
              .split(";")
              .map((p) => p.trim())
              .filter(Boolean)
          : undefined;

      const concert: Concert = {
        date: date ?? "",
        time: time || undefined,
        location: location ?? "",
        venue: venue ?? "",
        title: title ?? "",
        program: program && program.length > 0 ? program : undefined,
        link: href ? { href, label: hrefLabel || "Jegyinfo" } : undefined,
      };
      if (id) concert.id = id;
      return concert;
    });
}

/**
 * Serializes a concert back into the canonical bullet line:
 *   `- date | time | location | venue | title | program | href | label | id:rk-...`
 *
 * The five positional fields are always emitted (missing `time` becomes an
 * empty slot, exactly like the `venue` slot in the live file); `program`,
 * `href`+`label` and the id field are appended only when present. For any
 * concert produced by `parseUpcomingConcertsMarkdown`,
 * `parseUpcomingConcertsMarkdown(serializeConcert(c))` yields an equal concert.
 */
export function serializeConcert(concert: Concert): string {
  const parts: string[] = [
    concert.date,
    concert.time ?? "",
    concert.location,
    concert.venue,
    concert.title,
  ];
  if (concert.program && concert.program.length > 0) {
    parts.push(concert.program.join("; "));
  }
  if (concert.link) {
    parts.push(concert.link.href);
    parts.push(concert.link.label || "Jegyinfo");
  }
  if (concert.id) {
    parts.push(`id:${concert.id}`);
  }
  return `- ${parts.join(" | ")}`;
}

async function fetchConcertsMarkdown(
  fileName: string,
): Promise<Concert[] | null> {
  const cfg = getS4Config();
  const upcomingPrefixRaw = getS4UpcomingPrefix();
  if (!cfg || !upcomingPrefixRaw) return [];

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  const prefix = ensureTrailingSlash(upcomingPrefixRaw);

  try {
    let token: string | undefined;
    let markdownKey: string | null = null;

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
        const key = (obj.Key.split("/").pop() ?? "").toLowerCase();
        if (key === fileName.toLowerCase()) {
          markdownKey = obj.Key;
          break;
        }
      }

      if (markdownKey) break;
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);

    if (!markdownKey) return [];

    const getObj = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: markdownKey,
      }),
    );

    const body = await getObj.Body?.transformToString("utf-8");
    if (!body) return [];

    return parseUpcomingConcertsMarkdown(body);
  } catch (err) {
    console.error(
      `[upcoming-concerts] Failed to fetch ${fileName}:`,
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
    return null;
  }
}

export async function getUpcomingConcerts(): Promise<Concert[] | null> {
  return fetchConcertsMarkdown("rezkorut-upcoming-concerts.md");
}

export async function getArchivedConcerts(): Promise<Concert[] | null> {
  return fetchConcertsMarkdown("rezkorut-past-concerts.md");
}
