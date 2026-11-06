/* Débit en mémoire, par fenêtre glissante. Une tentative refusée ne prolonge pas l'attente. */
const MAX_KEYS = 100_000;

export function createRateLimiter(now = Date.now) {
  const buckets = new Map();

  function store(bucket) {
    let hits = buckets.get(bucket);
    if (!hits) { hits = new Map(); buckets.set(bucket, hits); }
    return hits;
  }

  function sweep() {
    const t = now();
    for (const [bucket, hits] of buckets) {
      for (const [key, entry] of hits) {
        if (entry.stamps[entry.stamps.length - 1] + entry.windowMs <= t) hits.delete(key);
      }
      if (!hits.size) buckets.delete(bucket);
    }
  }

  function inspect(bucket, key, limit, windowMs, record) {
    const hits = store(bucket);
    const t = now();
    let entry = hits.get(key);
    if (!entry) {
      if (!record) return 0;
      if (hits.size >= MAX_KEYS) {
        for (const [oldKey, old] of hits) {
          if (old.stamps[old.stamps.length - 1] + old.windowMs <= t) hits.delete(oldKey);
        }
      }
      if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value);
      entry = { windowMs, stamps: [] };
      hits.set(key, entry);
    }
    while (entry.stamps.length && entry.stamps[0] + windowMs <= t) entry.stamps.shift();
    if (entry.stamps.length >= limit) return Math.max(1, Math.ceil((entry.stamps[0] + windowMs - t) / 1000));
    if (record) entry.stamps.push(t);
    return 0;
  }

  /* Enregistre une tentative. Renvoie 0 si elle est admise, sinon le nombre de secondes à attendre. */
  function hit(bucket, key, limit, windowMs) {
    return inspect(bucket, key, limit, windowMs, true);
  }

  return {
    hit,
    check: (bucket, key, limit, windowMs) => inspect(bucket, key, limit, windowMs, false),
    sweep,
    size: bucket => bucket === undefined ? [...buckets.values()].reduce((sum, hits) => sum + hits.size, 0) : (buckets.get(bucket)?.size ?? 0)
  };
}
