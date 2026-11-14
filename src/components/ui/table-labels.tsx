"use client";

import { useEffect, useRef } from "react";

/**
 * Copies each column heading onto the cells below it (data-label), so the stacked "card" layout on narrow screens can show which value is which.
 * Attributes are set through the DOM, not inline styles, so the strict CSP is unaffected. Without JavaScript the table still works; cells just have no labels.
 */
export function TableLabels() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const wrap = marker.current?.closest(".rtable");
    if (!wrap) return;
    const label = () => {
      const heads = Array.from(wrap.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
      wrap.querySelectorAll("tbody tr").forEach((tr) => {
        Array.from(tr.children).forEach((cell, i) => {
          if (cell.tagName === "TD" && heads[i] && cell.getAttribute("data-label") !== heads[i]) cell.setAttribute("data-label", heads[i]);
        });
      });
    };
    label();
    const body = wrap.querySelector("tbody");
    if (!body) return;
    const observer = new MutationObserver(label);
    observer.observe(body, { childList: true });
    return () => observer.disconnect();
  }, []);
  return <span ref={marker} hidden />;
}
