import { redirect } from "next/navigation";

/** Older links: sign-in is now one page. Keeps the welcome / reset notices. */
export default async function Page({ searchParams }: { searchParams: Promise<{ welcome?: string; reset?: string }> }) {
  const sp = await searchParams;
  redirect(sp.welcome ? "/login?welcome=1" : sp.reset ? "/login?reset=1" : "/login");
}
