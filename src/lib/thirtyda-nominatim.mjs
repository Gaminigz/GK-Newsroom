/**
 * 30+DA · the one line to OpenStreetMap's Nominatim, shared by every lookup the server makes there: the area name of a
 * point (src/lib/thirtyda-geo.mjs) and the place search of a meeting (src/lib/thirtyda-places.mjs).
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/): a real User-Agent that says who
 * we are, at most 1 request a second from the whole application, and cache the answers. One queue for both callers
 * keeps the whole server under that second.
 */

export const NOMINATIM_UA = "30DA/1.0 (gk.smart@ggmt.sg)";
export const NOMINATIM_ORIGIN = "https://nominatim.openstreetmap.org";

/** What turn() gives back for a job it skipped (its `skip()` said true before it started). */
export const SKIPPED = Symbol("skipped");

/**
 * A queue that starts at most one job per `gapMs`: turn(fn) waits its turn, then runs fn() (the next job waits until
 * this one settled AND the gap has passed since it started). turn(fn, { skip }) does not run fn — and uses up no gap —
 * when skip() is true at its turn (a caller that stopped waiting): it gives SKIPPED. turn.waiting() = jobs not started
 * yet, every caller's (the area names and the place search share one queue). `now` and `sleep` are for the tests.
 */
export function makeThrottle({ gapMs = 1000, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let queue = Promise.resolve();
  let last = -Infinity;
  let waiting = 0;
  const turn = (fn, { skip = null } = {}) => {
    waiting++;
    const run = queue.then(async () => {
      try {
        if (skip?.()) return SKIPPED;
        const wait = last + gapMs - now();
        if (wait > 0) await sleep(wait);
        if (skip?.()) return SKIPPED;
        last = now();
      } finally {
        waiting--;
      }
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  };
  turn.waiting = () => waiting;
  return turn;
}

/** The server's one Nominatim queue. */
export const nominatimTurn = makeThrottle();
