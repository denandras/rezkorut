import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { verifyMediaAccessToken } from "@/lib/media-access-token";
import { KOTTAK_ROOT } from "@/lib/kottak";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

type RateEntry = { count: number; resetAt: number };
const rateStore = new Map<string, RateEntry>();

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

/** RFC 5987 attachment header — keeps Hungarian/accented filenames intact. */
function attachmentHeader(name: string) {
  const fallback = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "kotta";
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request) {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();

  if (!cfg || !tokenSecret) {
    return new Response("Kotta szolgáltatás nem elérhető.", { status: 500 });
  }

  if (enforceRateLimit(request)) {
    return new Response("Too many requests", { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) return new Response("Missing token", { status: 400 });

  const payload = verifyMediaAccessToken(token, tokenSecret);
  if (!payload) return new Response("Invalid or expired token", { status: 403 });

  const key = payload.key;

  if (!key.startsWith(KOTTAK_ROOT)) {
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

  let totalSize = 0;
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    totalSize = head.ContentLength ?? 0;
  } catch {
    totalSize = 0;
  }

  try {
    const output = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    if (!output.Body) return new Response("File not found", { status: 404 });

    return new Response(output.Body.transformToWebStream(), {
      status: 200,
      headers: {
        // Always a download: no inline preview by design.
        "Content-Type": "application/octet-stream",
        "Content-Disposition": attachmentHeader(payload.name || "kotta.pdf"),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        ...(totalSize ? { "Content-Length": String(totalSize) } : {}),
      },
    });
  } catch {
    return new Response("Failed to retrieve file", { status: 502 });
  }
}
