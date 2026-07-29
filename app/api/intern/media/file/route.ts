import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { verifyMediaAccessToken } from "@/lib/media-access-token";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

type RateEntry = { count: number; resetAt: number };
const rateStore = new Map<string, RateEntry>();

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

const ALLOWED_EXTENSIONS = new Set([
  "wav", "mp3", "mp4", "mov", "m4a", "flac", "ogg", "aac",
]);

const REC_ME_PREFIX = "media/rec-me/";

function fileExtension(key: string) {
  return key.split(".").pop()?.toLowerCase() ?? "";
}

function getContentType(key: string) {
  return CONTENT_TYPES[fileExtension(key)] ?? "application/octet-stream";
}

function isAllowedKey(key: string) {
  if (!key.startsWith(REC_ME_PREFIX)) return false;
  return ALLOWED_EXTENSIONS.has(fileExtension(key));
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

function enforceRateLimit(request: Request) {
  const now = Date.now();
  const ip = getClientIp(request);
  const existing = rateStore.get(ip);

  if (!existing || existing.resetAt <= now) {
    rateStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  if (existing.count >= RATE_LIMIT_MAX) return true;

  existing.count += 1;
  return false;
}

export async function GET(request: Request) {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();

  if (!cfg || !tokenSecret) {
    return new Response("Media service unavailable", { status: 500 });
  }

  if (enforceRateLimit(request)) {
    return new Response("Too many requests", { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const download = searchParams.get("download") === "1";

  if (!token) return new Response("Missing token", { status: 400 });

  const payload = verifyMediaAccessToken(token, tokenSecret);
  if (!payload) return new Response("Invalid or expired token", { status: 403 });

  const key = payload.key;

  if (!isAllowedKey(key)) {
    return new Response("Unsupported media type", { status: 400 });
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

  // Determine total object size via HEAD if possible
  const totalSize = await (async () => {
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );
      return head.ContentLength ?? 0;
    } catch {
      return 0;
    }
  })();

  // Parse Range header for video/audio seeking
  const rangeHeader = request.headers.get("range");
  const safeName = (payload.name || "file").replace(/[^a-zA-Z0-9._-]/g, "-");
  const disposition = download
    ? `attachment; filename="${safeName}"`
    : "inline";

  if (download || !rangeHeader || !totalSize) {
    // No range request or download — serve full file
    try {
      const output = await client.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
      );

      if (!output.Body) return new Response("File not found", { status: 404 });

      const stream = output.Body.transformToWebStream();

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": getContentType(key),
          "Content-Disposition": disposition,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          ...(totalSize ? { "Content-Length": String(totalSize) } : {}),
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return new Response("Failed to retrieve file", { status: 502 });
    }
  }

  // Parse range: "bytes=start-end"
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    return new Response("Invalid range", { status: 416 });
  }

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

  if (start >= totalSize || end >= totalSize || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${totalSize}` },
    });
  }

  try {
    const output = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Range: `bytes=${start}-${end}`,
      }),
    );

    if (!output.Body) return new Response("File not found", { status: 404 });

    const stream = output.Body.transformToWebStream();
    const contentLength = end - start + 1;

    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Type": getContentType(key),
        "Content-Disposition": disposition,
        "Content-Length": String(contentLength),
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Failed to retrieve file", { status: 502 });
  }
}