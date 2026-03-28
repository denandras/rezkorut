import type { Metadata } from "next";
import BottomNav from "@/components/bottom-nav";
import MediaGallery from "@/components/media-gallery";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getMediaTokenSecret, getS4Config } from "@/lib/s4-config";
import { createMediaAccessToken } from "@/lib/media-access-token";

export const metadata: Metadata = {
  title: "Média – Réz körút",
  description: "A Réz körút rézfúvós szeptett fotógalériája.",
  openGraph: {
    title: "Média – Réz körút",
    description: "A Réz körút rézfúvós szeptett fotógalériája.",
    url: "https://rezkorut.hu/media",
  },
  twitter: {
    card: "summary_large_image",
    title: "Média – Réz körút",
    description: "A Réz körút rézfúvós szeptett fotógalériája.",
  },
};

export const dynamic = "force-dynamic";

export type MediaItem = {
  id: string;
  viewUrl: string;
  downloadUrl: string;
};

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
const MEDIA_TOKEN_TTL_MS = 10 * 60 * 1000;

function isImageKey(key: string) {
  const ext = key.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

function fileExtension(key: string) {
  return key.split(".").pop()?.toLowerCase() ?? "jpg";
}

async function getS3MediaItems(): Promise<MediaItem[]> {
  const cfg = getS4Config();
  const tokenSecret = getMediaTokenSecret();
  if (!cfg || !tokenSecret) return [];

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  const keys: string[] = [];
  let token: string | undefined;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: cfg.prefix,
        ContinuationToken: token,
        MaxKeys: 500,
      }),
    );

    for (const obj of list.Contents ?? []) {
      if (!obj.Key) continue;
      if (!isImageKey(obj.Key)) continue;
      keys.push(obj.Key);
    }

    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);

  const sortedKeys = [...keys].sort((a, b) => b.localeCompare(a));

  return sortedKeys.map((key, index) => {
    const ext = fileExtension(key);
    const ordinal = String(index + 1).padStart(3, "0");
    const safeName = `rezkorut-media-${ordinal}.${ext}`;
    const accessToken = createMediaAccessToken(
      { key, name: safeName, exp: Date.now() + MEDIA_TOKEN_TTL_MS },
      tokenSecret,
    );
    const encodedToken = encodeURIComponent(accessToken);
    return {
      id: `${index}`,
      viewUrl: `/api/media/file?token=${encodedToken}`,
      downloadUrl: `/api/media/file?token=${encodedToken}&download=1`,
    };
  });
}

export default async function MediaPage() {
  const mediaConfigured = !!getS4Config() && !!getMediaTokenSecret();
  const s3Items = mediaConfigured ? await getS3MediaItems() : [];
  const emptyMessage = mediaConfigured
    ? "A galéria jelenleg üres."
    : "A galéria átmenetileg nem elérhető.";

  return (
    <div className="flex min-h-screen flex-col bg-background-dark text-neutral-100">
      <header className="sticky top-0 z-50 border-b border-neutral-border bg-background-dark/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-center px-6 md:px-8">
          <h1 className="font-display text-lg font-bold tracking-tight uppercase">Média</h1>
        </div>
      </header>

      <main className="flex-1 pb-24">
        <div className="px-6 pt-10 md:px-12">
          <MediaGallery items={s3Items} emptyMessage={emptyMessage} />
        </div>
      </main>

      <BottomNav active="media" />
    </div>
  );
}
