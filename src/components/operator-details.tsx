import Link from "next/link";
import { operatorDetails } from "@/lib/operator";

export function OperatorDetails() {
  const o = operatorDetails();
  return (
    <>
      {o.name ? <p>CampusConnect is operated by <strong>{o.name}</strong>{o.address ? `, ${o.address}` : ""}.</p> : null}
      <p>Questions or complaints about your data: {o.email ? <a href={`mailto:${o.email}`} className="underline">{o.email}</a> : <>use the <Link href="/contact" className="underline">contact form</Link></>}. Students can also raise them with their college’s placement office or administrator.</p>
    </>
  );
}
