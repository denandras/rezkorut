import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { verifyMediaAccessToken } from "@/lib/media-access-token";
import { normalizeRelPath } from "@/lib/kepek";
import { streamZip, type ZipEntry } from "@/lib/zip";

/** Above this the zip stream gets cut mid-body by Vercel's 60 s function cap
 *  (measured 2026-11-11: ~12.5 MB/s MinIO→Vercel ⇒ ~600 MB max; 1.2 GB was
 *  truncated mid-stream and unzip failed). Keep well under, fail cleanly 413. */
const MAX_ZIP_BYTES = 500 * 1024 * 1024; // 500 MiB

/** RFC 5987 attachment header — keeps Hungarian/accented filenames intact. */
function attachmentHeader(name: string) {
  const fallback = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "mappa.zip";
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Shared handler for the intern folder-zip routes. The access token's `key`
 * IS the folder's full S3 prefix (trailing slash) — listing and streaming
 * are scoped to exactly that subtree.
 */
export async function folderZipHandler(
  request: Request,
  rootPrefix: string,
  rootLabel: string,
): Promise<Response> {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();

  if (!cfg || !tokenSecret) {
    return new Response("Szolgáltatás nem elérhető.", { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });

  const payload = verifyMediaAccessToken(token, tokenSecret);
  if (!payload) return new Response("Invalid or expired token", { status: 403 });

  // The token key must be a folder prefix inside the library root.
  const folderKey = payload.key;
  if (!folderKey.endsWith("/") || !folderKey.startsWith(rootPrefix)) {
    return new Response("Forbidden key prefix", { status: 403 });
  }

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  // Enumerate the folder RECURSIVELY (subfolders included).
  const objects: { key: string; size: number; lastModified?: Date }[] = [];
  let totalBytes = 0;
  let continuationToken: string | undefined;
  try {
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: folderKey,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );
      for (const obj of list.Contents ?? []) {
        if (!obj.Key || obj.Key.endsWith("/")) continue;
        if (obj.Key.includes(".DS_Store")) continue;
        objects.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified,
        });
        totalBytes += obj.Size ?? 0;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } catch {
    return new Response("Nem sikerült listázni a mappát.", { status: 502 });
  }

  if (objects.length === 0) {
    return new Response("Ez a mappa üres.", { status: 404 });
  }
  if (totalBytes > MAX_ZIP_BYTES) {
    return new Response(
      "A mappa túl nagy egyetlen letöltéshez — töltsd le részmappánként.",
      { status: 413 },
    );
  }

  const rel = normalizeRelPath(folderKey.slice(rootPrefix.length).replace(/\/$/, ""));
  const folderName = rel.split("/").pop() || rootLabel;

  const entries: ZipEntry[] = objects.map((obj) => ({
    // Path inside the zip: folder-name/<subfolders…>/file
    name: `${folderName}/${obj.key.slice(folderKey.length)}`,
    lastModified: obj.lastModified,
    getStream: async function* () {
      const output = await client.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: obj.key }),
      );
      if (!output.Body) return;
      const stream = output.Body.transformToWebStream();
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  }));

  return new Response(streamZip(entries), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentHeader(`${folderName}.zip`),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
