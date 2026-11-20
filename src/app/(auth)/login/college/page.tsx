import { SignInPage, type SignInSearch } from "../sign-in-page";

export const metadata = { title: "College staff sign in — CampusConnect" };

export default function CollegeSignIn({ searchParams }: { searchParams: SignInSearch }) {
  return <SignInPage portal="college" searchParams={searchParams} />;
}
