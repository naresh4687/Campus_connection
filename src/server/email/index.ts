/**
 * The ONE place an email provider will plug in. Email is not available today: nothing in the application sends mail, no screen offers it, and
 * no delivery status is ever recorded. Business code never imports a provider; it creates notifications (the single intent point, see
 * db/migrations/0014_notifications.sql) and a delivery channel decides what to do with them.
 *
 * To enable email later (see PUSH_NOTIFICATIONS.md → "Adding the email channel"):
 *   1. install the chosen provider's SDK and add its server-side settings to config;
 *   2. implement EmailProvider below and return it from emailProvider();
 *   3. add an email outbox the same way push_jobs hangs off notifications (trigger -> job -> worker), with templates that follow the same
 *      "no private content" rule as push-copy.ts;
 *   4. add an EMAIL entry to the preference model and show the control only when channelAvailability().email is true;
 *   5. run the suites; tests/email-unavailable.test.ts must be replaced by provider tests.
 */
export type EmailMessage = { to: string; subject: string; text: string; html?: string; idempotencyKey: string };
/** `accepted` means the provider took the message, NOT that it was delivered. Those are separate states and are recorded separately. */
export interface EmailProvider { send(message: EmailMessage): Promise<{ accepted: boolean; providerMessageId?: string }>; }

/** No provider is configured. This must stay null until a real provider is implemented; nothing may fake one. */
export function emailProvider(): EmailProvider | null { return null; }
