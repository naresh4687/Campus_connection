# CampusConnect — data-protection checklist (India, DPDP Act 2023)

**This is an engineering checklist written by the developer, not legal advice.** The Act's rules, commencement dates and the roles of the parties must be confirmed with qualified counsel before go-live; I have not verified the current text of the Rules. Statuses: **Built** (implemented and tested), **Partly**, **Not built**, **Decision needed**.

## 1. Who is who (to confirm with counsel)

A college that uses CampusConnect decides why and how student data is processed, so it is likely the **Data Fiduciary**; whoever operates CampusConnect for it is likely a **Data Processor** and needs a written contract with each college. Students are **Data Principals**. Staff are also Data Principals (their name/email/role). Many students are 17–22 years old; **some may be under 18**, which the Act treats specially (verifiable consent of a parent/guardian, no tracking/targeted advertising). → *Decision needed*: how the college collects consent for minors.

## 2. Personal data inventory

| Data | Who it is about | Where | Purpose |
|---|---|---|---|
| Name, college email, register number, department, degree, batch; optional personal email and phone | students | `students`, `users` | identify the student; invitations; contact by placement office |
| Academic values (CGPA, 10th/12th/diploma %, backlogs, arrears) and verification history | students | `academic_submissions` | eligibility for drives (deterministic engine) |
| Mark sheets, certificates, résumés, offer letters, joining proofs | students | private object storage (+ metadata tables) | verification; placement process; verified placement |
| Registrations, round results, selections, offers, placement records | students | workflow tables | the placement process itself |
| Staff name, email, role, last sign-in | staff | `users` | access control |
| Audit records (who did what; hashed IP) | all | `audit_log` | accountability and security |
| Notifications (generic text) | all | `notifications` | in-app messages |
| Announcement text pasted into the optional AI helper | companies (not students) | sent to the AI provider only if enabled; **not stored** | drafting a drive |

No special categories (health, biometrics) are collected. Mark sheets and joining letters may incidentally contain more than the fields above.

## 3. Principles and duties — current position

| Duty | Status | Notes |
|---|---|---|
| **Notice and consent / lawful basis** | Partly | Forms that collect personal data link to the privacy page; there is no consent capture. The public Privacy and Terms pages are developer-written drafts and must be replaced by text reviewed by counsel. A college may rely on a basis other than consent for some processing — a legal question. |
| **Purpose limitation, minimisation** | Partly | Only fields needed for placement are collected. Eligibility uses only verified academic data. AI cannot see student data (the form warns not to paste it). Officers see a registered student's contact details and verified marks only for drives the student registered for; they can open only the résumé (never mark sheets); coordinators cannot see résumés, offers or placements. |
| **Accuracy** | Built | Students submit; coordinators verify or reject with a reason; corrections are resubmissions with full history. |
| **Storage limitation / retention** | **Proposed, not applied (OD-05)** | The privacy page states a *proposed* schedule (student records: three years after the passing year; unsuccessful applications and messages: one year; logs: three years). Nothing is deleted automatically; the schedule needs agreement and counsel review before a job applies it. |
| **Security safeguards** | Built (see DEPLOYMENT.md §4) | Database-enforced tenant isolation; the runtime role cannot write tables directly; private storage with 60-second signed links; strict CSP; hashed sessions and tokens; argon2id passwords; two-step sign-in (built, **switched off** until `TWO_STEP_SIGN_IN=on`); rate limiting; audit log; document access logged (non-owner opens are visible to the student); exports audited. Not done: malware scanning, encryption-at-rest configuration (depends on the hosting provider — confirm), external penetration test. |
| **Breach notification** (Board and affected persons) | Partly | Audit log and backups support investigation; there is no written breach-response plan or contact list. See DEPLOYMENT.md §9 for the technical first steps; the legal timelines must come from counsel. |
| **Data Principal rights**: access / summary | Partly | Students download their own data as JSON (“My data”). Staff and applicants ask through the privacy contact. |
| **Correction and erasure** | Partly | Students correct contact details, links and academic records. They can ask for deletion; a college administrator approves, which anonymises identifying data and removes uploaded files (migration 0047). **Retained:** the append-only audit log (account ids, keyed hashes), anonymous marks and placement outcomes, and free text staff wrote on drives or announcements that may mention a person. Erased students still appear as “Erased student” in lists and counts. No erasure flow for staff or applicants. Backups keep old data until they expire. |
| **Grievance redressal** | **Draft** | The privacy and terms pages show a complaints contact from `PRIVACY_CONTACT_EMAIL` (else the contact form). No named officer, tracking or response time. |
| **Nomination of another person** (right) | **Not built** | |
| **Children's data** | **Draft rule** | Stated on the privacy and terms pages: the college obtains guardian consent before creating an account for a student under 18. The product collects no age and enforces nothing; counsel to confirm this is enough. |
| **Processors and sub-processors** | **Decision needed** | Hosting provider, object-storage provider, optional AI provider each need a contract; the AI provider receives announcement text only. |
| **Cross-border transfer** | **Decision needed (OD-01)** | Choose an India region for database and storage unless counsel advises otherwise; the AI provider (if enabled) is outside India. |
| **Significant Data Fiduciary obligations** (DPO, audits) | Not assessed | Depends on the volume/sensitivity classification of the college and operator; counsel to assess. |

## 4. What I would do next (in order)

1. Counsel review of roles, consent/notice approach, minors, retention and erasure; replace the Privacy and Terms drafts.
2. Decide OD-01/OD-02/OD-05 (hosting region, storage and scanning, retention).
3. Build: consent capture where counsel requires it; retention jobs once the schedule is agreed; a tracked grievance channel.
4. Write the breach-response plan; run the restore drill and reconciliation on the real environment; arrange an external security review.
