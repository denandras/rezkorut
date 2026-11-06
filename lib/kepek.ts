/**
 * Képek (photo library) helpers for the intern gallery.
 *
 * Source of truth: TB1 S3 → `…/2022-09- Réz körút/media/képek/`
 * (this is the "Réz körút/képek" folder seen in Nextcloud).
 */

export const KEPEK_ROOT =
  "documents/002 Szakma/01 Harsona/05 Együttesek/2022-09- Réz körút/media/képek/";

export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
]);

export const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm"]);

/** Extensions we can hand to the browser at all (download / inline preview). */
export const SERVABLE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  "heic",
  "heif",
]);

export type KepekKind = "image" | "video" | "other";

export type KepekFile = {
  name: string;
  /** Path relative to KEPEK_ROOT, folder included, e.g. `2025-03-09 Solti/a.jpg` */
  path: string;
  key: string;
  size: number;
  contentType: string;
  kind: KepekKind;
  thumbUrl?: string;
  previewUrl?: string;
  viewUrl?: string;
  downloadUrl?: string;
  lastModified?: string;
};

export type KepekFolder = {
  name: string;
  /** Path relative to KEPEK_ROOT */
  path: string;
  fileCount: number;
  imageCount: number;
  coverUrl?: string;
};

export function fileExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  if (!base.includes(".")) return "";
  return base.split(".").pop()!.toLowerCase();
}

export function kindOf(name: string): KepekKind {
  const ext = fileExtension(name);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "other";
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[fileExtension(name)] ?? "application/octet-stream";
}

const collator = new Intl.Collator("hu", { numeric: true, sensitivity: "base" });

/** Natural (numeric-aware) Hungarian sort. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Sanitize a caller-supplied relative folder path. Returns "" for the root. */
export function normalizeRelPath(input: string | null | undefined): string {
  if (!input) return "";
  const parts = input
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  return parts.join("/");
}
