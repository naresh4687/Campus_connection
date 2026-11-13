import { headers } from "next/headers";
import { config } from "../config";

/** Origin for one-time links. Production: APP_BASE_URL only (never the Host header). Development: falls back to the request host. */
export async function appBaseUrl(): Promise<string> {
  const configured = config().APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}

export const invitationLink = async (token: string) => `${await appBaseUrl()}/accept-invite?token=${token}`;
export const resetLink = async (token: string) => `${await appBaseUrl()}/reset-password?token=${token}`;
