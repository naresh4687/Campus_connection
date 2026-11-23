import Link from "next/link";
import { scopedHref } from "@/lib/portals";
import { CATEGORIES_FOR, CATEGORY_HELP, CATEGORY_LABEL, ESSENTIAL } from "@/lib/notifications";
import { channelAvailability } from "@/server/notifications/channels";
import { requireSession } from "@/server/auth/session";
import { preferenceMap } from "@/server/notifications/queries";
import { PrefToggle } from "./pref-toggle";
import { InstallCard } from "@/components/pwa/install-card";
import { PushControls } from "@/components/pwa/push-controls";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { removePushDeviceAction, setPushEnabledAction } from "@/server/notifications/actions";
import { pushPublicKey } from "@/server/push/config";
import { listDevices, pushEnabled } from "@/server/push/subscriptions";

export const metadata = { title: "Notification preferences — CampusConnect" };

export default async function Preferences() {
  const s = await requireSession();
  const cats = CATEGORIES_FOR[s.role] ?? [];
  const prefs = await preferenceMap(s);
  const ch = channelAvailability();
  const canPush = !!s.collegeId;
  const [devices, master] = canPush && ch.push ? await Promise.all([listDevices(s), pushEnabled(s)]) : [[], true];
  const channelText = ch.push ? "Notifications appear inside CampusConnect, and as push alerts on the devices where you turn them on." : "Notifications appear inside CampusConnect.";
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href={scopedHref("/notifications", s.slot)} className="underline">← Notifications</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Notification preferences</h1>
      {canPush ? (
        <div className="space-y-4">
          <PushControls publicKey={pushPublicKey()} slot={s.slot} />
          {ch.push && devices.length > 0 ? (
            <section aria-label="Your devices" className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold">Push alerts for your account: <span data-testid="push-master">{master ? "on" : "paused"}</span></p>
                <form action={setPushEnabledAction}><input type="hidden" name="enabled" value={master ? "no" : "yes"} /><Button type="submit" variant="secondary">{master ? "Pause all devices" : "Resume all devices"}</Button></form>
              </div>
              <ul className="divide-y divide-border" aria-label="Devices with push alerts">
                {devices.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>{d.device_label ?? "Device"} <span className="text-muted">· added {fmtDateTime(d.created_at)}</span></span>
                    <form action={removePushDeviceAction}><input type="hidden" name="id" value={d.id} /><Button type="submit" variant="secondary">Remove</Button></form>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
      <InstallCard variant="inline" />
      {cats.length === 0 ? <p className="text-sm text-muted">There are no notification categories for your role.</p> : (
        <ul className="divide-y divide-border card" aria-label="Notification categories">
          {cats.map((c) => <PrefToggle key={c} category={c} label={CATEGORY_LABEL[c]} help={CATEGORY_HELP[c]} enabled={prefs[c] ?? true} essential={ESSENTIAL.has(c)} />)}
        </ul>
      )}
      <p className="text-xs text-muted">{channelText} Offer and placement notifications cannot be turned off because they carry deadlines and decisions.</p>
    </div>
  );
}
