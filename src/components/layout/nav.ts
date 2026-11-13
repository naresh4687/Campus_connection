import type { Role } from "@/server/db/context";

export type NavItem = { href: string; label: string };

/** Only links to pages that exist and work. Grows as modules ship. */
export const NAV: Record<Role, NavItem[]> = {
  PLATFORM_SUPER_ADMIN: [
    { href: "/platform", label: "Overview" },
    { href: "/platform/applications", label: "Applications" },
    { href: "/platform/colleges", label: "Colleges" },
    { href: "/platform/inquiries", label: "Inquiries" },
    { href: "/platform/audit", label: "Audit log" },
    { href: "/account", label: "Account" },
  ],
  COLLEGE_ADMIN: [
    { href: "/college", label: "Dashboard" },
    { href: "/college/departments", label: "Departments" },
    { href: "/college/students", label: "Students" },
    { href: "/college/academics", label: "Academics" },
    { href: "/college/companies", label: "Companies" },
    { href: "/college/drives", label: "Drives" },
    { href: "/college/placements", label: "Placements" },
    { href: "/college/reports", label: "Reports" },
    { href: "/college/staff", label: "Staff" },
    { href: "/college/settings", label: "College profile" },
    { href: "/college/audit", label: "Audit log" },
    { href: "/account", label: "Account" },
  ],
  PLACEMENT_OFFICER: [{ href: "/placement", label: "Home" }, { href: "/placement/companies", label: "Companies" }, { href: "/placement/drives", label: "Drives" }, { href: "/placement/placements", label: "Placements" }, { href: "/placement/reports", label: "Reports" }, { href: "/account", label: "Account" }],
  COORDINATOR: [{ href: "/coordinator", label: "Home" }, { href: "/coordinator/students", label: "Students" }, { href: "/coordinator/requests", label: "Sign-up requests" }, { href: "/coordinator/verification", label: "Verification" }, { href: "/coordinator/documents", label: "Documents" }, { href: "/account", label: "Account" }],
  STUDENT: [{ href: "/student", label: "Home" }, { href: "/student/drives", label: "Drives" }, { href: "/student/offers", label: "Offers" }, { href: "/student/academics", label: "Academics" }, { href: "/student/documents", label: "Documents" }, { href: "/student/profile", label: "Profile" }, { href: "/account", label: "Account" }],
};
