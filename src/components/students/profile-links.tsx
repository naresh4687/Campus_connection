import type { ReactNode } from "react";

type L = { github_url: string | null; leetcode_url: string | null; linkedin_url: string | null };
const ITEMS: [keyof L, string][] = [["github_url", "GitHub"], ["leetcode_url", "LeetCode"], ["linkedin_url", "LinkedIn"]];

/** The student's public profiles as links (staff views). */
export function ProfileLinks({ st, empty = "Not added" }: { st: L; empty?: ReactNode }) {
  const shown = ITEMS.filter(([k]) => st[k]);
  if (shown.length === 0) return <span className="text-muted">{empty}</span>;
  return <span className="flex flex-wrap gap-x-4 gap-y-1">{shown.map(([k, label]) => <a key={k} href={st[k]!} target="_blank" rel="noopener noreferrer nofollow" className="underline">{label}</a>)}</span>;
}
