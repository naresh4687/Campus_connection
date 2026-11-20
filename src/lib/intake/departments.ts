/**
 * Department mapping. The text says "CSE", "Computer Science", "IT"; the college has its own department codes and names. A mention maps to a
 * college department only when BOTH belong to exactly the same set of known branch groups (or the code/name is identical). So "CSE" never maps
 * to a department called "CSE (AI & ML)", and an unknown branch is reported as unmatched instead of guessed — a wrong guess would change who is eligible.
 */
const GROUPS: { id: string; re: RegExp }[] = [
  { id: "cse", re: /\bcse\b|computer science(?! (?:and|&) (?:business|design))(?: (?:and|&) engineering)?|computer engineering/i },
  { id: "it", re: /\binformation technology\b|\bIT\b(?!\s+(?:compan|industr|sector|services|infrastructure|support|park|professional|field|career|jobs?|roles?|hiring|giant|major|firm|team|department of the company))/ },
  { id: "ece", re: /\bece\b|electronics (?:and|&) communication/i },
  { id: "eee", re: /\beee\b|electrical (?:and|&) electronics/i },
  { id: "eie", re: /\beie\b|electronics (?:and|&) instrumentation|instrumentation (?:and|&) control/i },
  { id: "mech", re: /\bmech\b|mechanical/i },
  { id: "civil", re: /\bcivil\b/i },
  { id: "aids", re: /\bai ?(?:&|and|\/) ?ds\b|\baids\b|\bads\b|artificial intelligence (?:and|&) data science/i },
  { id: "aiml", re: /\bai ?(?:&|and|\/) ?ml\b|\baiml\b|artificial intelligence (?:and|&) machine learning/i },
  { id: "csbs", re: /\bcsbs\b|computer science (?:and|&) business systems/i },
  { id: "cyber", re: /cyber ?security/i },
  { id: "chem", re: /chemical/i },
  { id: "biotech", re: /bio ?technology|\bbt\b/i },
  { id: "biomed", re: /bio ?medical/i },
  { id: "auto", re: /automobile|automotive/i },
  { id: "aero", re: /aeronautical|aerospace/i },
  { id: "mba", re: /\bmba\b|management studies/i },
];
const ALL_RE = /\b(?:all|any|every)\s+(?:the\s+)?(?:branches|departments|streams|disciplines|engineering (?:branches|streams|departments))\b|\ball\s+(?:b\.?e\.?|b\.?tech)\b.{0,20}\bbranches\b/i;

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const groupsIn = (s: string): string => GROUPS.filter((g) => g.re.test(s)).map((g) => g.id).sort().join("+");

export type Dept = { id: string; code: string; name: string };

/** All department mentions in one piece of text, as written. */
export function mentionsIn(text: string): string[] {
  const out: string[] = [];
  // a slash/comma list of branch codes ("cse/it/ece") may use lowercase "it", which is otherwise too common a word to trust
  for (const m of text.matchAll(/\b(?:cse|ece|eee|mech|civil|it|aids|aiml)(?:\s*[/,&]\s*(?:cse|ece|eee|mech|civil|it|aids|aiml))+\b/gi)) for (const tok of m[0].split(/[/,&]/)) if (tok.trim().toLowerCase() === "it") out.push("IT");
  for (const g of GROUPS) {
    const flags = g.re.flags.includes("g") ? g.re.flags : `${g.re.flags}g`;
    for (const m of text.matchAll(new RegExp(g.re.source, flags))) out.push(m[0]);
  }
  return [...new Set(out)];
}
export const saysAllBranches = (text: string) => ALL_RE.test(text);

/** Maps mentions to department codes of the college. Mentions that match nothing (or match ambiguously) are returned separately. */
export function mapDepartments(mentions: string[], depts: Dept[]): { codes: string[]; unmatched: string[] } {
  const codes = new Set<string>(); const unmatched: string[] = [];
  for (const m of mentions) {
    const g = groupsIn(m);
    const exact = depts.filter((d) => norm(d.code) === norm(m) || norm(d.name) === norm(m));
    const hits = exact.length ? exact : g ? depts.filter((d) => groupsIn(`${d.code} ${d.name}`) === g) : [];
    if (hits.length === 1) codes.add(hits[0].code);
    else unmatched.push(m);   // none, or several candidates: a person chooses
  }
  return { codes: [...codes], unmatched };
}
