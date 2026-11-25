import { config } from "../config";

/** Holds the short-lived "password accepted, code still needed" token. */
export const mfaCookieName = () => `${config().AUTH_COOKIE_SECURE ? "__Host-" : ""}cc_mfa`;
