"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

/**
 * The portal's navigation frame. Tablet and up: everything is shown in the sidebar. Phone: a compact top bar (brand, the
 * notifications link and a Menu button) with the navigation folded below it; it closes again on every page change
 * (the inner part is keyed by the path, so its state resets).
 */
export function PortalChrome({ brand, quick, children }: { brand: ReactNode; quick?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  return <Frame key={pathname} brand={brand} quick={quick}>{children}</Frame>;
}

function Frame({ brand, quick, children }: { brand: ReactNode; quick?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        {brand}
        <div className="flex items-center gap-2 md:hidden">
          {quick}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="portal-menu"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      <div id="portal-menu" className={`${open ? "flex" : "hidden"} mt-4 min-h-0 flex-1 flex-col gap-6 md:mt-6 md:flex`}>
        {children}
      </div>
    </>
  );
}
