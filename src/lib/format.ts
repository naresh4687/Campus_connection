const IST = "Asia/Kolkata";
export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? `${new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: IST })} IST` : "—";
export const fmtDate = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: IST }) : "—");
