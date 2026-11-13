import { handleOfferUpload } from "@/server/offers/upload";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleOfferUpload(req, id, "JOINING_PROOF", (qs) => `/student/offers/${id}?${qs}`);
}
