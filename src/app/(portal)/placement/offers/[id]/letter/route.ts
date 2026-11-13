import { handleOfferUpload } from "@/server/offers/upload";
import { uuidSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const u = new URL(req.url).searchParams.get("drive") ?? "";
  const drive = uuidSchema.safeParse(u);
  return handleOfferUpload(req, id, "OFFER_LETTER", (qs) => (drive.success ? `/placement/drives/${drive.data}/offers?${qs}` : `/placement/drives?${qs}`));
}
