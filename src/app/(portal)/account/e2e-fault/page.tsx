import { throwDeliberateFault } from "@/server/e2e-fault";

// Test-only: crashes on purpose so e2e/error-pages.spec.ts can check the portal error page. A 404 unless E2E_FAULT_ROUTES is set.
export default function E2ePortalFaultPage() {
  throwDeliberateFault("portal");
}
