import { participationDownload } from "@/components/participation/csv-route";

export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) { return participationDownload(req, (await ctx.params).id, ["COORDINATOR"]); }
