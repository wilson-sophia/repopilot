/** Match Auth.js' URL-based cookie defaults, including its deployment URL override. */
export function usesSecureAuthCookies(request: Request): boolean {
  const configuredURL = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  return new URL(configuredURL || request.url).protocol === "https:";
}
