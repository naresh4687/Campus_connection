# Push notifications

Three things are separate and independent: **in-app notifications** (the inbox, always on), **browser notifications** (shown by the service worker) and **remote push** (a message from the browser vendor's push service that wakes the service worker when CampusConnect is closed). This document covers the third; it sits on top of the existing inbox (`db/migrations/0014_notifications.sql`) without changing it.

## Architecture
```
workflow event ──► existing trigger ──► notifications row (the single "intent")
                                          │  AFTER INSERT trigger push.on_notification (same transaction)
                                          ▼
                                     push_jobs (outbox, one per notification, unique)
                                          │  scheduler calls POST /api/push/dispatch  (or: npm run push:worker)
                                          ▼
              push.claim (FOR UPDATE SKIP LOCKED, re-checks preferences) ──► web-push ──► browser push service ──► service worker ──► OS notification
                                          │
                 push.record / push.finish: delivery log, retry with backoff, expired devices switched off
```
Nothing is sent inside a user request. A push exists only if its notification was committed (same transaction); recipients are exactly the users the existing triggers already chose (college, department, role), so there is no client-supplied recipient anywhere. Platform administrators have no college and no inbox, so they have no push either.

## Configuration
```
npm run push:vapid          # prints a public/private key pair (once)
```
Set on the server only (see `.env.example`):
* `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or `https:` contact)
* `PUSH_WORKER_SECRET` (32+ random characters): the bearer secret for `/api/push/dispatch`. Unset = the endpoint answers 404 to everyone.

Missing or malformed values never crash the app: push is reported unavailable (the preferences page says so) and in-app notifications continue. The private key is read only in `src/server/push/config.ts`; the browser receives only the public key as a prop. `.env*`, `*.pem`, `*.key`, backups and subscription exports are git-ignored.

## Running the worker
* Serverless/scheduled: call `POST /api/push/dispatch` with `Authorization: Bearer $PUSH_WORKER_SECRET` every minute (Vercel Cron sends `CRON_SECRET`; set both to the same value, or use any external cron). Add `?purge=1` about once an hour. The response is the pass summary plus queue health. **No cron is configured in `vercel.json`; that is your deployment decision.**
* Server/container: `npm run push:worker` (loop every `PUSH_WORKER_INTERVAL_SECONDS`, default 10; purges hourly).
Any number of workers may run at once.

## Subscription lifecycle
1. A person presses **Turn on notifications** (never automatically). The browser asks for permission; refusal is explained and not re-requested.
2. The page subscribes with the public key and POSTs it to `/api/push/subscribe` (same origin, signed in, rate-limited). The database function `push.subscribe` stores it for the **session's** user and college (nothing from the body names a user), validates it, audits it, and keeps at most 10 active devices per account.
3. Only after the server confirms does the UI say "on". Failures are shown with a retry; a subscription made in the browser but not saved is dropped.
4. Each page load re-checks (`/api/push/status`) and quietly re-saves a subscription the browser kept but the server lost.
5. **Turn off** (this device), **Remove** (any listed device) or the account **pause** switch stop delivery. Sign-out switches the leaving account's device off.
6. Endpoints that answer 404/410 are deactivated. Devices with 10 consecutive failures are deactivated. Inactive devices and finished jobs are purged after 30 days.
An endpoint already active for another account is never taken over (`409`); the browser then makes a fresh subscription for the new account.

## Delivery rules
* Retry: attempts at +30 s, +2 min, +8 min, +32 min, then terminal `FAILED` (visible in `/api/push/dispatch` health). A device that already received a push for a job is never sent it again (unique `SENT` log row); the push `Topic` is the notification id so repeats replace instead of stacking.
* Error classes: 404/410 expired (device off); network, 408, 429, 5xx, 401/403 retry; other 4xx permanent.
* At delivery time the worker re-checks: account active, account switch on, category not switched off (offers and placement cannot be), and the notification not already read in the app.
* A worker that dies leaves a lock that expires after 2 minutes; the job is then claimed again.

## What a push contains
Only a notification id and generic words chosen by category (`src/lib/push-copy.ts`), for example "Offer Update — Your placement offer status has been updated." No drive, company, student name, mark or package ever appears. The service worker builds the destination itself as `/notifications/<id>/open` from the validated id; **a URL in a payload is never used**. That route requires sign-in, checks the notification belongs to the signed-in user, marks it read and redirects to the stored in-app link, where the destination page applies its own authorisation. A closed app opens a window; an open app has the existing window focused and navigated (no duplicates); a malformed id opens `/app`.

## Which events push
Every event that already creates an inbox notification, for the same recipients: new drive published, registration open/pending reminders, rounds announced and results released, selection, offers (issued, extended, withdrawn), offer responses (officers), joining and placement verification, academic and document reviews, achievements, announcements, password-change requests, external-registration evidence. Categories: DRIVES, ROUNDS, OFFERS, PLACEMENT, ACADEMICS, DOCUMENTS, TASKS, ANNOUNCEMENTS.

**Not built:** events for College Administrators and Platform Administrators (they have no notification categories today, and platform administrators have no college to own a subscription); an "eligibility changed / became ineligible" notification and a "registration confirmed/cancelled" notification do not exist in the inbox either, so they have no push. Adding them means adding the inbox trigger; push then follows automatically.

## Security notes
* Subscription endpoint and keys are never returned to any client; `push.my_devices()` returns id, label and dates only.
* The runtime role cannot read or write any push table; everything goes through `SECURITY DEFINER` functions owned by `cc_auth` (checked by `db/tests/catalog-audit.test.ts` and the reviewed function snapshot). No new database role was created.
* **Endpoint allowlist (SSRF):** the server later requests the stored URL, so only `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com` and `*.notify.windows.com` over https on the default port without credentials are accepted — in the API schema, in the database (`CHECK` and function) and again before sending. A new vendor push service needs an explicit addition to `src/lib/push-endpoint.ts` and `0039`-style migration.
* The worker functions (`push.claim/record/finish/health/purge`) are callable by the runtime role like the rest of the app's code; only the dispatch route (bearer secret, constant-time compare) and `scripts/push-worker.ts` call them. They take no recipient input and cannot send anything.
* No user can send arbitrary pushes: a push exists only for an inbox notification created by a workflow trigger.
* Not tested on real vendor push services from this repo (see below).

## Troubleshooting
* "Temporarily unavailable" on the preferences page: VAPID values missing or malformed (the server log says which, never the key).
* Nothing arrives: check `/api/push/dispatch` health (`pending` growing = no scheduler; `failed` = terminal failures; `expired_24h` = browsers dropped devices). Check the device is listed under Notification preferences, the account switch is "on", and the notification was not already read.
* iPhone: push needs the app added to the Home Screen and opened from there.
* Blocked permission: re-allow Notifications in the browser's site settings, then reload.

## Adding the email channel later
Email is **not available** today and nothing sends or promises email. The seam: `src/server/email/index.ts` (`EmailProvider`, `emailProvider()` returns `null`) and `src/server/notifications/channels.ts` (`channelAvailability()` drives what the UI shows). To enable: (1) choose a provider and add its server settings; (2) implement `EmailProvider` and return it; (3) add an email outbox like `push_jobs` (trigger on `notifications` → job → worker; keep `accepted` and `delivered` as separate states; generic templates); (4) add an EMAIL preference and show it only when `channelAvailability().email`; (5) replace `src/server/push/push.test.ts`'s "email unavailable" assertions and `e2e/pwa-push.spec.ts`'s "no email actions" test with provider tests.
