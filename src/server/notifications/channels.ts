import { emailProvider } from "../email";
import { pushConfig } from "../push/config";

export type ChannelId = "IN_APP" | "PUSH" | "EMAIL";
export type ChannelAvailability = Record<"inApp" | "push" | "email", boolean>;

/**
 * Which delivery channels really work in this deployment. The UI asks this instead of assuming, so a control or a sentence about a channel
 * appears only when the channel can actually deliver. In-app notifications are always on; push needs its VAPID settings; email needs a provider.
 */
export function channelAvailability(): ChannelAvailability {
  return { inApp: true, push: pushConfig().ok, email: emailProvider() !== null };
}
export const availableChannels = (): ChannelId[] => { const a = channelAvailability(); return [a.inApp ? "IN_APP" : null, a.push ? "PUSH" : null, a.email ? "EMAIL" : null].filter((c): c is ChannelId => c !== null); };
