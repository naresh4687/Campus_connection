/** Public business details for the legal pages, from the server's settings. Anything not set is simply not shown. */
export function operatorDetails(env: Record<string, string | undefined> = process.env) {
  const v = (k: string) => env[k]?.trim() || null;
  return { name: v("OPERATOR_NAME"), address: v("OPERATOR_ADDRESS"), email: v("PRIVACY_CONTACT_EMAIL") };
}
