import { KEPEK_ROOT } from "@/lib/kepek";
import { folderZipHandler } from "@/lib/zip-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return folderZipHandler(request, KEPEK_ROOT, "Képek");
}
