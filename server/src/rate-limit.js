/* Débit en mémoire, par fenêtre glissante. Une tentative refusée ne prolonge pas l'attente. */
const MAX_KEYS = 100_000;

export function createRateLimiter(now = Date.now) {
  const hits = new Map();

  function sweep() {
    const t = now();
    for (const [key, entry] of hits) {
      if (entry.stamps[entry.stamps.length - 1] + entry.windowMs <= t) hits.delete(key);
    }
  }

  /* Enregistre une tentative. Renvoie 0 si elle est admise, sinon le nombre de secondes à attendre. */
  function hit(bucket, key, limit, windowMs) {
    const t = now();
    const id = `${bucket}:${key}`;
    let entry = hits.get(id);
    if (!entry) {
      if (hits.size >= MAX_KEYS) sweep();
      // Mémoire bornée face à un flot de clés : la plus ancienne cède sa place.
      if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value);
      entry = { windowMs, stamps: [] };
      hits.set(id, entry);
    }
    while (entry.stamps.length && entry.stamps[0] + windowMs <= t) entry.stamps.shift();
    if (entry.stamps.length >= limit) return Math.max(1, Math.ceil((entry.stamps[0] + windowMs - t) / 1000));
    entry.stamps.push(t);
    return 0;
  }

  return { hit, sweep, size: () => hits.size };
}
