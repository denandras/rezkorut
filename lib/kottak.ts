/**
 * Kották (scores) helpers for the intern score library.
 *
 * Source of truth: TB1 S3 → `scores/03 Mixed Chamber/07 Septet/`
 * (the Réz körút septet repertoire folder).
 */

export const KOTTAK_ROOT = "scores/03 Mixed Chamber/07 Septet/";

export type KottakKind = "pdf" | "audio" | "video" | "project" | "other";

export type KottakFile = {
  name: string;
  /** Path relative to KOTTAK_ROOT, e.g. `Hidas - Brass Septet/score.pdf` */
  path: string;
  key: string;
  size: number;
  ext: string;
  kind: KottakKind;
  downloadUrl: string;
  lastModified?: string;
};

export type KottakFolder = {
  name: string;
  path: string;
  fileCount: number;
  totalSize: number;
};

const KIND_BY_EXT: Record<string, KottakKind> = {
  pdf: "pdf",
  wav: "audio",
  mp3: "audio",
  m4a: "audio",
  flac: "audio",
  mp4: "video",
  mov: "video",
  mscz: "project",
  mscx: "project",
  sib: "project",
  mus: "project",
  xml: "project",
  mxl: "project",
  musicxml: "project",
};

export function kottakKind(name: string): KottakKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXT[ext] ?? "other";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
