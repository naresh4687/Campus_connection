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
| **Notice and consent / lawful basis** | **Not built** | There is no consent or notice screen. The public Privacy and Terms pages are developer-written drafts and must be replaced by text reviewed by counsel. A college may rely on a basis other than consent for some processing — a legal question. |
| **Purpose limitation, minimisation** | Partly | Only fields needed for placement are collected. Eligibility uses only verified academic data. AI cannot see student data (the form warns not to paste it). Officers see a registered student's contact details and verified marks only for drives the student registered for; they can open only the résumé (never mark sheets); coordinators cannot see résumés, offers or placements. |
| **Accuracy** | Built | Students submit; coordinators verify or reject with a reason; corrections are resubmissions with full history. |
| **Storage limitation / retention** | **Decision needed (OD-05)** | No retention schedule or automatic deletion exists: records, files, audit entries and notifications are kept indefinitely. A schedule per data class, and a way to apply it, must be decided and built. |
| **Security safeguards** | Built (see DEPLOYMENT.md §4) | Database-enforced tenant isolation; the runtime role cannot write tables directly; private storage with 60-second signed links; strict CSP; hashed sessions and tokens; argon2id passwords; rate limiting; audit log; document access logged (non-owner opens are visible to the student); exports audited. Not done: malware scanning, encryption-at-rest configuration (depends on the hosting provider — confirm), external penetration test. |
| **Breach notification** (Board and affected persons) | Partly | Audit log and backups support investigation; there is no written breach-response plan or contact list. See DEPLOYMENT.md §9 for the technical first steps; the legal timelines must come from counsel. |
| **Data Principal rights**: access / summary | **Not built** | No self-service "download my data". Today an administrator would have to compile it from the database. |
| **Correction and erasure** | Partly | Students can fix academic data by resubmitting and can delete their own unattached documents (bytes removed from storage). There is no workflow to erase a student's account and all personal data, and offers/placements/audit entries are retained by design (history integrity). Erasure vs. retention duties need counsel; an anonymisation procedure would be the likely implementation. |
| **Grievance redressal** | **Not built** | No in-product grievance channel or named officer; the public Contact page only collects inquiries for the platform. |
| **Nomination of another person** (right) | **Not built** | |
| **Children's data** | **Decision needed** | See §1. |
| **Processors and sub-processors** | **Decision needed** | Hosting provider, object-storage provider, optional AI provider each need a contract; the AI provider receives announcement text only. |
| **Cross-border transfer** | **Decision needed (OD-01)** | Choose an India region for database and storage unless counsel advises otherwise; the AI provider (if enabled) is outside India. |
| **Significant Data Fiduciary obligations** (DPO, audits) | Not assessed | Depends on the volume/sensitivity classification of the college and operator; counsel to assess. |

## 4. What I would do next (in order)

1. Counsel review of roles, consent/notice approach, minors, retention and erasure; replace the Privacy and Terms drafts.
2. Decide OD-01/OD-02/OD-05 (hosting region, storage and scanning, retention).
3. Build: consent/notice capture where counsel requires it; retention jobs and an anonymisation procedure; a "my data" export for students; a grievance channel.
4. Write the breach-response plan; run the restore drill and reconciliation on the real environment; arrange an external security review.
