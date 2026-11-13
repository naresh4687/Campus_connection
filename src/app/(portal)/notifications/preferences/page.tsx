import Link from "next/link";
import { CATEGORIES_FOR, CATEGORY_HELP, CATEGORY_LABEL, ESSENTIAL } from "@/lib/notifications";
import { requireSession } from "@/server/auth/session";
import { preferenceMap } from "@/server/notifications/queries";
import { PrefToggle } from "./pref-toggle";

export const metadata = { title: "Notification preferences — CampusConnect" };

export default async function Preferences() {
  const s = await requireSession();
  const cats = CATEGORIES_FOR[s.role] ?? [];
  const prefs = await preferenceMap(s);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/notifications" className="underline">← Notifications</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Notification preferences</h1>
      {cats.length === 0 ? <p className="text-sm text-muted">There are no notification categories for your role.</p> : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface" aria-label="Notification categories">
          {cats.map((c) => <PrefToggle key={c} category={c} label={CATEGORY_LABEL[c]} help={CATEGORY_HELP[c]} enabled={prefs[c] ?? true} essential={ESSENTIAL.has(c)} />)}
        </ul>
      )}
      <p className="text-xs text-muted">Notifications appear inside CampusConnect only; nothing is sent by email or SMS. Offer and placement notifications cannot be turned off because they carry deadlines and decisions.</p>
    </div>
  );
}
