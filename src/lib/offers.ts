export const OFFER_STATUS_LABEL: Record<string, string> = { NOT_ISSUED: "Selected — offer not issued yet", ISSUED: "Offer issued — awaiting response", ACCEPTED: "Offer accepted", DECLINED: "Offer declined", WITHDRAWN: "Offer withdrawn" };
export const OFFER_TONE: Record<string, string> = { NOT_ISSUED: "NOT_STARTED", ISSUED: "PENDING", ACCEPTED: "APPROVED", DECLINED: "REJECTED", WITHDRAWN: "REJECTED" };
export const PLACEMENT_LABEL: Record<string, string> = { PENDING_VERIFICATION: "Joining awaiting verification", VERIFIED: "Verified placement", REJECTED: "Joining not verified" };
export const PLACEMENT_TONE: Record<string, string> = { PENDING_VERIFICATION: "PENDING", VERIFIED: "APPROVED", REJECTED: "REJECTED" };
export const FILE_KIND_LABEL: Record<string, string> = { OFFER_LETTER: "Offer letter", JOINING_PROOF: "Joining proof" };
/** Server-generated storage key for an offer letter or joining proof. Nothing here is influenced by the client. */
export const offerFileKey = (collegeId: string, selectionId: string, objectId: string) => `c/${collegeId}/o/${selectionId}/${objectId}`;
