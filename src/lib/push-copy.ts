/**
 * What a push shows on the lock screen. Deliberately generic: a push never carries drive names, company names, student names, packages or
 * any other content (the real text is in the notification, which the signed-in user opens in the app). Chosen by category only.
 */
export const PUSH_COPY: Record<string, { title: string; body: string }> = {
  DRIVES: { title: "Placement Drive Update", body: "There is a new update about a placement drive. Open CampusConnect for details." },
  ROUNDS: { title: "Recruitment Round Update", body: "A round schedule or result is available. Open CampusConnect to view it." },
  OFFERS: { title: "Offer Update", body: "Your placement offer status has been updated." },
  PLACEMENT: { title: "Placement Status Update", body: "Your placement status has been updated." },
  ACADEMICS: { title: "Academic Update", body: "There is an update on your academic record." },
  DOCUMENTS: { title: "Document Update", body: "There is an update on one of your documents." },
  TASKS: { title: "Action Needed", body: "An item is waiting for your attention in CampusConnect." },
  ANNOUNCEMENTS: { title: "New Announcement", body: "A new announcement has been published." },
};
export const PUSH_FALLBACK = { title: "CampusConnect", body: "You have a new notification." };
export const pushCopy = (category: string) => PUSH_COPY[category] ?? PUSH_FALLBACK;

/** The page a push opens: always our own authenticated redirect for that notification (never a URL taken from anywhere else). */
export const pushUrl = (notificationId: string) => `/notifications/${notificationId}/open`;
