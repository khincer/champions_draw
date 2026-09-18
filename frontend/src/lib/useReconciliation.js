/* Observe-only confirmation of the client-computed surfaces against the read-only
   endpoints (task 6.3, task 6.4, spec PR:bounded-triggers / PR:silent-logged-once /
   PR:read-only-semantic-compare).

   The client stays the rendering source of truth: this hook never returns state,
   never gates or delays a render and never disables a control. It issues GETs only,
   compares semantically (reconcile.js) and logs one warning per mismatch.

   Triggers — mount once per surface when a persisted prediction id exists, plus
   once per new bulk-sync revision. Both are rate-limited to one request per surface
   per 30s; edits never trigger a check. `predictionId === null` is a total no-op. */

import { useEffect, useRef } from 'preact/hooks';
import { API_ROOT, apiFetch } from './api.js';
import { compareStandings, comparePlayoffs, compareKnockout } from './reconcile.js';

/* One constant for both the cache TTL and the per-surface rate limit (task 6.4). */
export const RECONCILIATION_TTL_MS = 30000;

const SURFACES = {
  standings: { segment: 'standings', compare: compareStandings },
  playoffs: { segment: 'playoffs', compare: comparePlayoffs },
  knockout: { segment: 'knockout', compare: compareKnockout },
};

/* Module-scope, memory only, no storage and no queue. `cache` holds the last
   successful confirmation per surface so a remount inside the TTL is a no-op;
   `attempts` holds the last attempt per surface so a failure is not retried
   until the next natural trigger. Cleared on any successful bulk sync. */
const cache = new Map(); // surface -> { response, at }
const attempts = new Map(); // surface -> at

export function clearReconciliationCache(surface) {
  if (surface == null) cache.clear();
  else cache.delete(surface);
}

function warn(surface, endpoint, payload) {
  console.warn(`[reconciliation] ${surface}`, { surface, endpoint, ...payload });
}

export function useReconciliation(surface, { predictionId, clientValue, revision } = {}) {
  const surfaceDef = SURFACES[surface];
  const latestValue = useRef(clientValue);
  latestValue.current = clientValue;

  /* Distinguish a fresh mount from a real prediction-id / revision change, so a
     remount inside the TTL can still be served from the module cache. The ref is
     seeded with the mount values (usually a null id) and only updated once an id
     exists. */
  const previous = useRef({ predictionId, revision });

  useEffect(() => {
    if (!predictionId || !surfaceDef) return; // no persisted id: no request at all

    const seen = previous.current;
    const staleRevision = seen.revision !== revision;
    const differentPrediction = seen.predictionId != null && seen.predictionId !== predictionId;
    previous.current = { predictionId, revision };
    if (staleRevision || differentPrediction) clearReconciliationCache(surface); // never serve post-sync stale

    const now = Date.now();
    const cached = cache.get(surface);
    if (cached && now - cached.at < RECONCILIATION_TTL_MS) return;

    const lastAttempt = attempts.get(surface);
    if (lastAttempt && now - lastAttempt < RECONCILIATION_TTL_MS) return; // ≤1 check per surface per 30s

    const endpoint = `${API_ROOT}/predictions/${predictionId}/${surfaceDef.segment}/`;
    attempts.set(surface, now);

    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch(`/predictions/${predictionId}/${surfaceDef.segment}/`);
        if (cancelled) return;
        cache.set(surface, { response, at: Date.now() });
        const { mismatches } = surfaceDef.compare(latestValue.current, response);
        for (const mismatch of mismatches) {
          warn(surface, endpoint, {
            key: mismatch.key,
            clientValue: mismatch.clientValue,
            serverValue: mismatch.serverValue,
            status: 200,
          });
        }
      } catch (error) {
        if (cancelled) return;
        /* Offline / timeout / 502 / non-2xx: one warning, no retry, no UI change.
           The next natural trigger (new revision or remount) retries. */
        warn(surface, endpoint, {
          key: null,
          clientValue: null,
          serverValue: null,
          status: error?.status ?? 0,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [predictionId, revision, surface]); // eslint-disable-line react-hooks/exhaustive-deps
}
