import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { verifyMediaAccessToken } from "@/lib/media-access-token";
import { IMAGE_EXTENSIONS, KEPEK_ROOT, fileExtension } from "@/lib/kepek";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_WIDTH = 200;
const MAX_WIDTH = 2400;

export async function GET(request: Request) {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();

  if (!cfg || !tokenSecret) {
    return new Response("Képek szolgáltatás nem elérhető.", { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const widthParam = Number.parseInt(searchParams.get("w") ?? "640", 10);
  const width = Number.isFinite(widthParam)
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widthParam))
    : 640;

  if (!token) return new Response("Missing token", { status: 400 });

  const payload = verifyMediaAccessToken(token, tokenSecret);
  if (!payload) return new Response("Invalid or expired token", { status: 403 });

  const key = payload.key;

  if (!key.startsWith(KEPEK_ROOT)) {
    return new Response("Forbidden key prefix", { status: 403 });
  }

  if (!IMAGE_EXTENSIONS.has(fileExtension(key))) {
    return new Response("Unsupported image type", { status: 415 });
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

  try {
    const output = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    );

    if (!output.Body) return new Response("Not found", { status: 404 });

    const source = Buffer.from(await output.Body.transformToByteArray());

    const thumb = await sharp(source, { failOn: "none" })
      .rotate() // apply EXIF orientation
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();

    return new Response(new Uint8Array(thumb), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(thumb.byteLength),
        "Cache-Control":
          "public, max-age=86400, s-maxage=691200, stale-while-revalidate=86400",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Nem sikerült a kép feldolgozása.", { status: 422 });
  }
}
