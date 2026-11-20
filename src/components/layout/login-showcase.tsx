import type { Portal } from "@/lib/portals";

/*
 * The example preview on the sign-in panel: what is waiting after signing in, for this kind of user.
 * Illustration only (aria-hidden, invented names); always drawn on an ink card so it reads the same in both themes.
 */

const CHIP = {
  ok: "bg-brand text-brand-foreground",
  no: "bg-[#ff7a5c] text-[#101210]",
  wait: "border border-[#f2b54a] text-[#f2b54a]",
  info: "border border-white/25 text-[#eef3e8]",
} as const;
type Tone = keyof typeof CHIP;
const STAGGER = ["[--i:0]", "[--i:1]", "[--i:2]", "[--i:3]"];

function Chip({ tone, children, i }: { tone: Tone; children: string; i: number }) {
  return <span className={`stamp inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHIP[tone]} ${STAGGER[i]}`}>{children}</span>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-[#101210] text-[#eef3e8] shadow-[0_24px_48px_-24px_rgb(0_0_0/0.5)] ring-1 ring-white/12">
      <p className="border-b border-white/10 px-5 py-3 text-xs text-[#a0a996]">{title}</p>
      {children}
    </div>
  );
}

const STUDENT: { what: string; detail: string; chip: string; tone: Tone }[] = [
  { what: "Software engineer, Example Tech", detail: "Registration closes Friday", chip: "Eligible", tone: "ok" },
  { what: "Round 2 results released", detail: "Data analyst, Example Labs", chip: "Selected", tone: "ok" },
  { what: "Offer letter received", detail: "Answer by 24 November", chip: "Respond", tone: "wait" },
];

const REGISTER: { name: string; cgpa: string; chip: string; tone: Tone }[] = [
  { name: "Priya R.", cgpa: "8.4", chip: "Eligible", tone: "ok" },
  { name: "Arjun K.", cgpa: "6.7", chip: "Not eligible", tone: "no" },
  { name: "Meena S.", cgpa: "—", chip: "Needs data", tone: "wait" },
  { name: "Rahul V.", cgpa: "7.9", chip: "Eligible", tone: "ok" },
];

const APPLICATIONS: { college: string; place: string; chip: string; tone: Tone }[] = [
  { college: "Example Institute of Technology", place: "Tamil Nadu", chip: "Submitted", tone: "wait" },
  { college: "Example College of Engineering", place: "Karnataka", chip: "Under review", tone: "info" },
  { college: "Example University", place: "Kerala", chip: "Approved", tone: "ok" },
];

export function LoginShowcase({ portal }: { portal: Portal }) {
  if (portal === "student") {
    return (
      <Card title="Example: your updates">
        <ul>
          {STUDENT.map((r, i) => (
            <li key={r.what} className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5 last:border-b-0">
              <span className="min-w-0"><span className="block truncate font-medium">{r.what}</span><span className="block truncate text-sm text-[#a0a996]">{r.detail}</span></span>
              <Chip tone={r.tone} i={i}>{r.chip}</Chip>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  if (portal === "college") {
    return (
      <Card title="Example drive: software engineer, minimum CGPA 7.0">
        <div className="grid grid-cols-[minmax(0,1fr)_3rem_6.5rem] gap-3 border-b border-white/10 px-5 py-2 text-xs text-[#a0a996]"><span>Student</span><span className="text-right">CGPA</span><span className="text-right">Verdict</span></div>
        {REGISTER.map((r, i) => (
          <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_3rem_6.5rem] items-center gap-3 border-b border-white/10 px-5 py-3 text-sm tabular-nums last:border-b-0">
            <span className="truncate font-medium">{r.name}</span><span className="text-right">{r.cgpa}</span><span className="text-right"><Chip tone={r.tone} i={i}>{r.chip}</Chip></span>
          </div>
        ))}
      </Card>
    );
  }
  return (
    <Card title="Example: college applications">
      <ul>
        {APPLICATIONS.map((r, i) => (
          <li key={r.college} className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5 last:border-b-0">
            <span className="min-w-0"><span className="block truncate font-medium">{r.college}</span><span className="block text-sm text-[#a0a996]">{r.place}</span></span>
            <Chip tone={r.tone} i={i}>{r.chip}</Chip>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The outlined capitals band from the landing page, sized for the panel's foot. Stroke colours keep 3:1 against the panel (large-text contrast). */
export function PanelBand({ ink }: { ink: boolean }) {
  const words = "Drive Rounds Offer Joining ";
  return (
    <div aria-hidden="true" className="pointer-events-none select-none overflow-hidden whitespace-nowrap text-[clamp(1.75rem,3.2vw,3rem)]">
      <p className={`display leading-[1.05] ${ink ? "text-brand" : ""}`}>{words.repeat(3)}</p>
      <p className={`display -ml-16 leading-[1.05] type-outline ${ink ? "[-webkit-text-stroke-color:#66735a]" : "[-webkit-text-stroke-color:#526f2c]"}`}>{words.repeat(3)}</p>
    </div>
  );
}
