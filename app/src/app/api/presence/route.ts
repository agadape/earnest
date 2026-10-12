/**
 * Who is in the museum right now. Every open museum page tells this route once a second where
 * its visitor stands, and gets back where everyone else is.
 *
 * It is kept in Vercel's runtime cache: one entry per visitor that expires by itself when the
 * page stops calling, and one list of who to look up. Nothing is written to a database and
 * nothing outlives a visit. A visitor is a random id made in the browser, a display name and a
 * point on the floor; a connected wallet shows its short address as the name, a guest shows
 * "Guest". None of it is checked, so a name here proves nothing about who someone is.
 */
import { getCache } from "@vercel/functions";

const SECONDS_KEPT = 20;
// Someone not heard from for this long has left, whatever the cache still holds.
const GONE_AFTER_MS = 6_000;
const MOST = 40;
const INDEX = "museum:visitors";
const key = (id: string) => `museum:visitor:${id}`;

interface Visitor {
  id: string;
  name: string;
  wallet: boolean;
  x: number;
  z: number;
  at: number;
}

const finite = (value: unknown, low: number, high: number): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : null;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(body.id) ? body.id : null;
  if (!body || !id) return Response.json({ error: "A visitor id is needed." }, { status: 400 });

  const cache = getCache();
  const listed = ((await cache.get(INDEX)) as string[] | null) ?? [];

  if (body.leave === true) {
    await cache.delete(key(id));
    await cache.set(INDEX, listed.filter((other) => other !== id), { ttl: SECONDS_KEPT });
    return Response.json({ others: [], here: 0 });
  }

  const x = finite(body.x, -40, 40);
  const z = finite(body.z, -40, 40);
  if (x === null || z === null) return Response.json({ error: "A place on the floor is needed." }, { status: 400 });
  // Shown to other people, so only what a short address or the word Guest can contain.
  const name =
    typeof body.name === "string" ? body.name.replace(/[^A-Za-z0-9 .…]/g, "").slice(0, 14) || "Guest" : "Guest";
  const now = Date.now();
  const self: Visitor = { id, name, wallet: body.wallet === true, x, z, at: now };
  await cache.set(key(id), self, { ttl: SECONDS_KEPT });

  const ids = listed.includes(id) ? listed : [...listed, id].slice(-MOST);
  const found = await Promise.all(
    ids.filter((other) => other !== id).map(async (other) => (await cache.get(key(other))) as Visitor | null),
  );
  const others = found.filter((visitor): visitor is Visitor => visitor !== null && now - visitor.at < GONE_AFTER_MS);

  // The list heals itself: whoever is still calling puts themselves back, whoever left drops out.
  const current = [id, ...others.map((visitor) => visitor.id)];
  if (current.length !== listed.length || current.some((entry) => !listed.includes(entry))) {
    await cache.set(INDEX, current, { ttl: SECONDS_KEPT });
  }

  return Response.json({
    others: others.map(({ id: other, name: label, wallet, x: ox, z: oz }) => ({ id: other, name: label, wallet, x: ox, z: oz })),
    here: others.length + 1,
  });
}
