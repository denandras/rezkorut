import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { createMediaAccessToken } from "@/lib/media-access-token";

export const dynamic = "force-dynamic";

const REC_ME_PREFIX = "media/rec-me/";
const MEDIA_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min

const CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  aac: "audio/aac",
};

const PLAYABLE_EXTENSIONS = new Set([
  "wav", "mp3", "mp4", "mov", "m4a", "flac", "ogg", "aac",
]);

function fileExtension(key: string) {
  return key.split(".").pop()?.toLowerCase() ?? "";
}

function getContentType(key: string) {
  return CONTENT_TYPES[fileExtension(key)] ?? "application/octet-stream";
}

function isPlayable(key: string) {
  return PLAYABLE_EXTENSIONS.has(fileExtension(key));
}

export async function GET(request: Request) {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();

  if (!cfg || !tokenSecret) {
    return Response.json({ error: "Media service unavailable" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const folder = searchParams.get("folder"); // subfolder within rec-me, e.g. "2024-12-21 Réz körút Zak Nagyterem/"

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  if (!folder) {
    // List top-level folders under media/rec-me/ containing "Réz körút"
    const folders: string[] = [];
    let continuationToken: string | undefined;

    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: REC_ME_PREFIX,
          Delimiter: "/",
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      for (const p of list.CommonPrefixes ?? []) {
        const name = p.Prefix?.replace(REC_ME_PREFIX, "").replace(/\/$/, "");
        if (name && name.toLowerCase().includes("réz körút")) {
          folders.push(name);
        }
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    folders.sort((a, b) => b.localeCompare(a));

    return Response.json({ folders });
  }

  // List files within a specific folder
  const prefix = `${REC_ME_PREFIX}${folder}/`;
  const files: Array<{
    name: string;
    key: string;
    size: number;
    contentType: string;
    playable: boolean;
    viewUrl: string;
    downloadUrl: string;
  }> = [];

  let continuationToken: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of list.Contents ?? []) {
      if (!obj.Key || obj.Key === prefix) continue;
      const name = obj.Key.split("/").pop();
      if (!name) continue;

      const ext = fileExtension(obj.Key);
      const playable = isPlayable(obj.Key);
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const accessToken = createMediaAccessToken(
        { key: obj.Key, name: safeName, exp: Date.now() + MEDIA_TOKEN_TTL_MS },
        tokenSecret,
      );
      const encodedToken = encodeURIComponent(accessToken);

      files.push({
        name,
        key: obj.Key,
        size: obj.Size ?? 0,
        contentType: getContentType(obj.Key),
        playable,
        viewUrl: `/api/intern/media/file?token=${encodedToken}`,
        downloadUrl: `/api/intern/media/file?token=${encodedToken}&download=1`,
      });
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  files.sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ folder, files });
}