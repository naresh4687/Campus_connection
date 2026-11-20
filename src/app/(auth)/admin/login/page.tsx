import { SignInPage, type SignInSearch } from "../../login/sign-in-page";

// The platform administrator's own sign-in page. Not linked from the public site and kept out of search engines.
export const metadata = { title: "Platform sign in — CampusConnect", robots: { index: false, follow: false } };

export default function PlatformSignIn({ searchParams }: { searchParams: SignInSearch }) {
  return <SignInPage portal="platform" searchParams={searchParams} />;
}
