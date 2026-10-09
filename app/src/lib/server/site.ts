import "server-only";

function parse(text: string | undefined): URL | null {
  try {
    return text ? new URL(text) : null;
  } catch {
    return null;
  }
}

/**
 * Where this site is reachable from outside. Link previews are fetched by other servers, so
 * every address in them has to be absolute: `NEXT_PUBLIC_SITE_URL` if set, else the production
 * domain Vercel reports, else the local dev server.
 */
export const SITE_URL: URL =
  parse(process.env.NEXT_PUBLIC_SITE_URL) ??
  parse(
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
  ) ??
  new URL("http://localhost:3000");
