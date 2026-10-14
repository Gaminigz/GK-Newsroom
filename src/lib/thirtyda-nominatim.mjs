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

/**
 * A queue that starts at most one job per `gapMs`: turn(fn) waits its turn, then runs fn() (the next job waits until
 * this one settled AND the gap has passed since it started). turn.waiting() = jobs not started yet. `now` and `sleep`
 * are for the tests.
 */
export function makeThrottle({ gapMs = 1000, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let queue = Promise.resolve();
  let last = -Infinity;
  let waiting = 0;
  const turn = (fn) => {
    waiting++;
    const run = queue.then(async () => {
      try {
        const wait = last + gapMs - now();
        if (wait > 0) await sleep(wait);
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
