import type { ReactNode } from "react";

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div tabIndex={0} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-border bg-tint text-xs uppercase tracking-wide text-muted">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="mt-1 text-sm text-muted">{children}</p> : null}
    </div>
  );
}
