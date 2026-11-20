import { NotFoundPanel, NotFoundPrimaryLink } from "@/components/not-found-panel";

// notFound() inside the portal (unknown ids, or another college's records). Renders inside the portal shell, so the user keeps their navigation.
// "/" redirects a signed-in user to their role's home.
export default function PortalNotFound() {
  return (
    <NotFoundPanel>
      <NotFoundPrimaryLink href="/">Back to your dashboard</NotFoundPrimaryLink>
    </NotFoundPanel>
  );
}
