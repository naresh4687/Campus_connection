import { PublicShell } from "@/components/layout/public-shell";
import { NotFoundLink, NotFoundPanel, NotFoundPrimaryLink } from "@/components/not-found-panel";

// Unmatched URLs, and notFound() outside the signed-in portal. Replaces Next's built-in 404, whose inline styles the CSP blocks.
// "/" sends a signed-in user on to their own dashboard.
export default function NotFound() {
  return (
    <PublicShell>
      <main className="px-4">
        <NotFoundPanel>
          <NotFoundPrimaryLink href="/">Go to the home page</NotFoundPrimaryLink>
          <NotFoundLink href="/contact">Contact us</NotFoundLink>
        </NotFoundPanel>
      </main>
    </PublicShell>
  );
}
