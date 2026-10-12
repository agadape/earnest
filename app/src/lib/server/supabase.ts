/**
 * The reactions table in Supabase, reached over its REST interface with the server's own key.
 * That key can do anything to the database, so it lives in a server-only variable and nothing
 * in this file is ever sent to a browser. Without the two variables the app runs as before and
 * reads reactions from the chain.
 */
const URL_BASE = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

export const SUPABASE_READY = Boolean(URL_BASE && KEY);

/** One call to the database's REST interface. Throws when it answers with an error. */
export async function supabase(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<unknown> {
  if (!URL_BASE || !KEY) throw new Error("Supabase is not set up");
  const response = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Supabase answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
