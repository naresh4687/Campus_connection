import { NextResponse } from "next/server";
import { appBaseUrl } from "@/server/auth/links";
import { getSessions, HOME_PATH } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Where the installed app opens: the signed-in user's own home, otherwise the sign-in chooser. Never reveals anything to anonymous callers. */
export async function GET() {
  const base = await appBaseUrl();
  const [first] = await getSessions();
  return NextResponse.redirect(new URL(first ? HOME_PATH[first.role] : "/login", base), 303);
}
