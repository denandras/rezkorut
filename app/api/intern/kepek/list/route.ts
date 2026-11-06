import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { createMediaAccessToken } from "@/lib/media-access-token";
import {
  KEPEK_ROOT,
  SERVABLE_EXTENSIONS,
  contentTypeFor,
  fileExtension,
  kindOf,
  naturalCompare,
  normalizeRelPath,
  type KepekFile,
  type KepekFolder,
} from "@/lib/kepek";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ObjectRec = { key: string; size: number; lastModified: number };

const LIST_CACHE_TTL_MS = 60_000;
let listCache: { at: number; objects: ObjectRec[] } | null = null;

/**
 * Token URLs must be stable across a page load (and ideally the whole day)
 * so the browser can cache thumbnails. Expiry is pinned to a calendar-day
 * boundary instead of "now + N minutes".
 */
function dayScopedExpiry(): number {
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() + 24 * 60 * 60 * 1000;
}

function makeClient(cfg: NonNullable<ReturnType<typeof getS4Config>>) {
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

async function listAllObjects(
  client: S3Client,
  bucket: string,
): Promise<ObjectRec[]> {
  if (listCache && Date.now() - listCache.at < LIST_CACHE_TTL_MS) {
    return listCache.objects;
  }

  const objects: ObjectRec[] = [];
  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: KEPEK_ROOT,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of list.Contents ?? []) {
      if (!obj.Key || obj.Key === KEPEK_ROOT || obj.Key.endsWith("/")) continue;
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

function parentPath(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx < 0 ? "" : relPath.slice(0, idx);
}

function buildFile(
  rec: ObjectRec,
  relPath: string,
  tokenSecret: string,
): KepekFile {
  const name = relPath.split("/").pop() ?? relPath;
  const kind = kindOf(name);
  const ext = fileExtension(name);
  const exp = dayScopedExpiry();
  const token = createMediaAccessToken(
    { key: rec.key, name, exp },
    tokenSecret,
  );
  const encodedToken = encodeURIComponent(token);
  const servable = SERVABLE_EXTENSIONS.has(ext);

  return {
    name,
    path: relPath,
    key: rec.key,
    size: rec.size,
    contentType: contentTypeFor(name),
    kind,
    thumbUrl:
      kind === "image"
        ? `/api/intern/kepek/thumb?token=${encodedToken}&w=640`
        : undefined,
    previewUrl:
      kind === "image"
        ? `/api/intern/kepek/thumb?token=${encodedToken}&w=1600`
        : undefined,
    viewUrl: servable
      ? `/api/intern/kepek/file?token=${encodedToken}`
      : undefined,
    downloadUrl: servable
      ? `/api/intern/kepek/file?token=${encodedToken}&download=1`
      : undefined,
    lastModified: rec.lastModified
      ? new Date(rec.lastModified).toISOString()
      : undefined,
  };
}

export async function GET(request: Request) {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();

  if (!cfg || !tokenSecret) {
    return Response.json(
      { error: "Képek szolgáltatás nem elérhető." },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const relPath = normalizeRelPath(searchParams.get("p"));

  try {
    const client = makeClient(cfg);
    const objects = await listAllObjects(client, cfg.bucket);

    const withRel = objects
      .map((rec) => ({ rec, rel: rec.key.slice(KEPEK_ROOT.length) }))
      .filter((entry) => entry.rel.length > 0 && !entry.rel.includes(".DS_Store"));

    // Aggregate per directory (recursive counts + cover image).
    type Agg = { files: number; images: number; cover?: ObjectRec; coverName?: string };
    const agg = new Map<string, Agg>();

    for (const { rec, rel } of withRel) {
      const parts = rel.split("/");
      const isImage = kindOf(rel) === "image";
      // Register every ancestor directory (root = "")
      let dir = "";
      for (let i = 0; i < parts.length - 1; i += 1) {
        dir = dir ? `${dir}/${parts[i]}` : parts[i];
        let entry = agg.get(dir);
        if (!entry) {
          entry = { files: 0, images: 0 };
          agg.set(dir, entry);
        }
        entry.files += 1;
        if (isImage) {
          entry.images += 1;
          if (!entry.cover || naturalCompare(rel, entry.coverName ?? "") < 0) {
            entry.cover = rec;
            entry.coverName = rel;
          }
        }
      }
    }

    const prefix = relPath ? `${relPath}/` : "";

    const folders: KepekFolder[] = Array.from(agg.entries())
      .filter(([dir]) => parentPath(dir) === relPath && dir !== "")
      .map(([dir, entry]) => {
        const name = dir.split("/").pop() ?? dir;
        const coverUrl =
          entry.cover && tokenSecret
            ? `/api/intern/kepek/thumb?token=${encodeURIComponent(
                createMediaAccessToken(
                  { key: entry.cover.key, name, exp: dayScopedExpiry() },
                  tokenSecret,
                ),
              )}&w=480`
            : undefined;
        return {
          name,
          path: dir,
          fileCount: entry.files,
          imageCount: entry.images,
          coverUrl,
        };
      })
      .sort((a, b) => naturalCompare(a.name, b.name));

    const files: KepekFile[] = withRel
      .filter(({ rel }) => {
        if (!rel.startsWith(prefix)) return false;
        const rest = rel.slice(prefix.length);
        return rest.length > 0 && !rest.includes("/");
      })
      .map(({ rec, rel }) => buildFile(rec, rel, tokenSecret))
      .sort((a, b) => naturalCompare(a.name, b.name));

    // Breadcrumbs for the client (root not included).
    const breadcrumbs: KepekFolder[] = [];
    let acc = "";
    for (const part of relPath ? relPath.split("/") : []) {
      acc = acc ? `${acc}/${part}` : part;
      const entry = agg.get(acc);
      breadcrumbs.push({
        name: part,
        path: acc,
        fileCount: entry?.files ?? 0,
        imageCount: entry?.images ?? 0,
      });
    }

    return Response.json({ path: relPath, folders, files, breadcrumbs });
  } catch {
    return Response.json(
      { error: "Nem sikerült betölteni a mappát." },
      { status: 502 },
    );
  }
}
