import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { createMediaAccessToken } from "@/lib/media-access-token";
import { normalizeRelPath, naturalCompare } from "@/lib/kepek";
import { KOTTAK_ROOT, kottakKind, type KottakFile, type KottakFolder } from "@/lib/kottak";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ObjectRec = { key: string; size: number; lastModified: number };

const LIST_CACHE_TTL_MS = 60_000;
let listCache: { at: number; objects: ObjectRec[] } | null = null;

/** Stable per-day token expiry so download URLs survive a reload (and caching). */
function dayScopedExpiry(): number {
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() + 24 * 60 * 60 * 1000;
}

async function listAllObjects(client: S3Client, bucket: string): Promise<ObjectRec[]> {
  if (listCache && Date.now() - listCache.at < LIST_CACHE_TTL_MS) {
    return listCache.objects;
  }

  const objects: ObjectRec[] = [];
  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: KOTTAK_ROOT,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of list.Contents ?? []) {
      if (!obj.Key || obj.Key === KOTTAK_ROOT || obj.Key.endsWith("/")) continue;
      objects.push({
        key: obj.Key,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.getTime() ?? 0,
      });
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  listCache = { at: Date.now(), objects };
  return objects;
}

/** A-Z, but internal `_`-prefixed folders/files sink to the end. */
function sortKey(name: string): string {
  return name.startsWith("_") ? `\uffff${name}` : name;
}

function parentPath(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx < 0 ? "" : relPath.slice(0, idx);
}

export async function GET(request: Request) {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();

  if (!cfg || !tokenSecret) {
    return Response.json({ error: "Kotta szolgáltatás nem elérhető." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const relPath = normalizeRelPath(searchParams.get("p"));

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  try {
    const objects = await listAllObjects(client, cfg.bucket);
    const withRel = objects
      .map((rec) => ({ rec, rel: rec.key.slice(KOTTAK_ROOT.length) }))
      .filter((entry) => entry.rel.length > 0 && !entry.rel.includes(".DS_Store"));

    // Per-directory aggregates (recursive).
    type Agg = { files: number; size: number };
    const agg = new Map<string, Agg>();

    for (const { rec, rel } of withRel) {
      const parts = rel.split("/");
      let dir = "";
      for (let i = 0; i < parts.length - 1; i += 1) {
        dir = dir ? `${dir}/${parts[i]}` : parts[i];
        const entry = agg.get(dir) ?? { files: 0, size: 0 };
        entry.files += 1;
        entry.size += rec.size;
        agg.set(dir, entry);
      }
    }

    const prefix = relPath ? `${relPath}/` : "";

    // Immediate subfolders straight from S3, so EMPTY folders (e.g. a work
    // folder created before the scores arrive) still show up in the tree.
    const dirPrefixes = new Set<string>();
    let dirToken: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: `${KOTTAK_ROOT}${prefix}`,
          Delimiter: "/",
          ContinuationToken: dirToken,
          MaxKeys: 1000,
        }),
      );
      for (const p of res.CommonPrefixes ?? []) {
        if (!p.Prefix) continue;
        const rel = p.Prefix.slice(KOTTAK_ROOT.length).replace(/\/$/, "");
        if (rel) dirPrefixes.add(rel);
      }
      // MinIO zero-byte folder markers (`…/name/`) arrive as objects, not prefixes.
      for (const obj of res.Contents ?? []) {
        if (!obj.Key || !obj.Key.endsWith("/")) continue;
        const rel = obj.Key.slice(KOTTAK_ROOT.length).replace(/\/$/, "");
        if (rel) dirPrefixes.add(rel);
      }
      dirToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (dirToken);

    const folderPaths = new Set<string>([
      ...Array.from(agg.keys()).filter((dir) => parentPath(dir) === relPath && dir !== ""),
      ...Array.from(dirPrefixes).filter((dir) => parentPath(dir) === relPath),
    ]);

    const folders: KottakFolder[] = Array.from(folderPaths)
      .map((dir) => {
        const entry = agg.get(dir);
        return {
          name: dir.split("/").pop() ?? dir,
          path: dir,
          fileCount: entry?.files ?? 0,
          totalSize: entry?.size ?? 0,
        };
      })
      .sort((a, b) => naturalCompare(sortKey(a.name), sortKey(b.name)));

    const exp = dayScopedExpiry();

    const files: KottakFile[] = withRel
      .filter(({ rel }) => {
        if (!rel.startsWith(prefix)) return false;
        const rest = rel.slice(prefix.length);
        return rest.length > 0 && !rest.includes("/");
      })
      .map(({ rec, rel }) => {
        const name = rel.split("/").pop() ?? rel;
        const token = createMediaAccessToken({ key: rec.key, name, exp }, tokenSecret);
        return {
          name,
          path: rel,
          key: rec.key,
          size: rec.size,
          ext: name.split(".").pop()?.toLowerCase() ?? "",
          kind: kottakKind(name),
          downloadUrl: `/api/intern/kottak/file?token=${encodeURIComponent(token)}`,
          lastModified: rec.lastModified
            ? new Date(rec.lastModified).toISOString()
            : undefined,
        };
      })
      .sort((a, b) => naturalCompare(sortKey(a.name), sortKey(b.name)));

    const breadcrumbs: KottakFolder[] = [];
    let acc = "";
    for (const part of relPath ? relPath.split("/") : []) {
      acc = acc ? `${acc}/${part}` : part;
      const entry = agg.get(acc);
      breadcrumbs.push({
        name: part,
        path: acc,
        fileCount: entry?.files ?? 0,
        totalSize: entry?.size ?? 0,
      });
    }

    return Response.json({ path: relPath, folders, files, breadcrumbs });
  } catch {
    return Response.json({ error: "Nem sikerült betölteni a mappát." }, { status: 502 });
  }
}
