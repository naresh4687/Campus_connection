import type { Role } from "@/server/db/context";

export type NavItem = { href: string; label: string; group?: string };

/** Only links to pages that exist and work. Grows as modules ship. */
export const NAV: Record<Role, NavItem[]> = {
  PLATFORM_SUPER_ADMIN: [
    { href: "/platform", label: "Overview" },
    { href: "/platform/applications", label: "Applications", group: "Colleges" },
    { href: "/platform/colleges", label: "Colleges", group: "Colleges" },
    { href: "/platform/inquiries", label: "Inquiries", group: "Colleges" },
    { href: "/platform/audit", label: "Audit log", group: "Platform" },
    { href: "/account", label: "Account", group: "You" },
  ],
  COLLEGE_ADMIN: [
    { href: "/college", label: "Dashboard" },
    { href: "/college/departments", label: "Departments", group: "People" },
    { href: "/college/students", label: "Students", group: "People" },
    { href: "/college/academics", label: "Academics", group: "People" },
    { href: "/college/companies", label: "Companies", group: "Placement" },
    { href: "/college/drives", label: "Drives", group: "Placement" },
    { href: "/college/placements", label: "Placements", group: "Placement" },
    { href: "/college/reports", label: "Reports", group: "Placement" },
    { href: "/college/staff", label: "Staff", group: "College" },
    { href: "/college/settings", label: "College profile", group: "College" },
    { href: "/college/audit", label: "Audit log", group: "College" },
    { href: "/account", label: "Account", group: "You" },
  ],
  PLACEMENT_OFFICER: [{ href: "/placement", label: "Home" }, { href: "/placement/companies", label: "Companies", group: "Placement" }, { href: "/placement/drives", label: "Drives", group: "Placement" }, { href: "/placement/campus", label: "On-campus drives", group: "Placement" }, { href: "/placement/announcements", label: "Announcements", group: "Placement" }, { href: "/placement/placements", label: "Placements", group: "Placement" }, { href: "/placement/reports", label: "Reports", group: "Insights" }, { href: "/account", label: "Account", group: "You" }],
  COORDINATOR: [{ href: "/coordinator", label: "Home" }, { href: "/coordinator/students", label: "Students", group: "Department" }, { href: "/coordinator/requests", label: "Sign-up requests", group: "Department" }, { href: "/coordinator/verification", label: "Verification", group: "Department" }, { href: "/coordinator/achievements", label: "Achievements", group: "Department" }, { href: "/coordinator/drives", label: "Drives", group: "Department" }, { href: "/coordinator/companies", label: "Companies", group: "Department" }, { href: "/coordinator/announcements", label: "Announcements", group: "Department" }, { href: "/coordinator/documents", label: "Documents", group: "Department" }, { href: "/account", label: "Account", group: "You" }],
  STUDENT: [{ href: "/student", label: "Home" }, { href: "/student/drives", label: "Drives", group: "Placements" }, { href: "/student/campus", label: "On-campus drives", group: "Placements" }, { href: "/student/offers", label: "Offers", group: "Placements" }, { href: "/student/announcements", label: "Announcements", group: "Placements" }, { href: "/student/academics", label: "Academics", group: "My record" }, { href: "/student/achievements", label: "Achievements", group: "My record" }, { href: "/student/documents", label: "Documents", group: "My record" }, { href: "/student/profile", label: "Profile", group: "My record" }, { href: "/account", label: "Account", group: "You" }],
};
