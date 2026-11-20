import { SignInPage, type SignInSearch } from "../sign-in-page";

export const metadata = { title: "Student sign in — CampusConnect" };

export default function StudentSignIn({ searchParams }: { searchParams: SignInSearch }) {
  return <SignInPage portal="student" searchParams={searchParams} />;
}
