import { KOTTAK_ROOT } from "@/lib/kottak";
import { folderZipHandler } from "@/lib/zip-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return folderZipHandler(request, KOTTAK_ROOT, "Kották");
}
