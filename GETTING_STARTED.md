# CampusConnect — getting started (complete walkthrough)

## Why only the login page worked
Nobody can sign up on their own, and a fresh database has **no users**. The very first account, the **platform super admin**, must be created once from the command line. Every other account is created by invitation from someone above them.

## 1. Start everything (local)
```bash
cd /home/naresh/projects/campus_connection
docker compose up -d            # PostgreSQL (127.0.0.1:5433) + private file store (127.0.0.1:9000)
npm run db:migrate              # creates all tables/functions
npm run storage:init            # creates the private bucket
npm run dev                     # http://localhost:3000
```

## 2. The super admin (where it is, how to create it)
Created for you in the dev database:
- URL: http://localhost:3000/login
- Email: `admin@campusconnect.local`
- Password: `Campus-Admin-15355bd1!`  (local throwaway; change it under **Account** after signing in)

To create it yourself on another database (only one platform admin is allowed):
```bash
PLATFORM_ADMIN_PASSWORD='a-long-password' npm run admin:create -- you@example.com "Your Name"
```

The super admin only runs the platform: reviews college applications, approves or suspends colleges, invites each college's first administrator, reads the platform audit log. It cannot see student data.

## 3. The flow, step by step (who does what)
1. **A college applies** (public page `/apply`). It receives a private status link.
2. **Super admin** → *Applications* → open it → *Start review* → **Approve**. Approving shows a **one-time invitation link** for the college's administrator, once. Copy it and send it to that person (email is not built). If you lose it, open the college under *Colleges* and use its invite form to issue a new one.
3. **College administrator** opens the link, sets a password, signs in. Then, in this order:
   - *Departments* → add departments.
   - *Staff* → invite **Placement officers** and **Coordinators** (one-time link each); assign each coordinator to departments.
   - *Students* → add students or *Import from CSV*, then *Invite* each student (one-time link each).
4. **Student** opens the link, sets a password. *Academics* → submit marks (+ evidence); *Documents* → upload résumé.
5. **Coordinator** → *Verification* → verify or reject (with reason). Only verified marks count for eligibility.
6. **Placement officer**: *Companies* → add company; *Drives* → create (optionally "Fill from an announcement" if AI is enabled), set criteria, **Publish**. Students see it under *Drives*, check eligibility, **Register**.
7. After the deadline (or **Close drive**): *Rounds and results* → add rounds, record results, **Release** (students see results only after release).
8. *Selections and offers* → select final students, upload offer letter, **Issue offer**. Student **accepts/declines** under *Offers*.
9. Student records **joining + proof**; officer verifies under *Placements*; the college administrator can override with a reason. Only **verified** placements count.
10. *Reports* (officer/admin): numbers, charts, CSV export, print.

## 4. Troubleshooting
| Symptom | Fix |
|---|---|
| Login says wrong password / locked | 8 failed attempts per 15 min lock an account; wait 15 minutes. |
| `admin:create` says an admin exists | Only one platform admin is allowed; use that account. |
| App won't start in production | It refuses development secrets; see `DEPLOYMENT.md`. |
| Uploads fail | `docker compose up -d` and `npm run storage:init`. |
| Forgot a user's password | College admin → Staff/Students → issue a one-time password-reset link. |
| Forgot the super admin password | Recreate the database user is not supported; reset by an operator with database access (see `DEPLOYMENT.md` §9). |

Tests use a separate database (`campusconnect_test`) with synthetic users; never use those for real work.
