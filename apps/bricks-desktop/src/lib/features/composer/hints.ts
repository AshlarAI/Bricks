// The sentence the empty composer shows: one of a few, picked from the conversation so it stays
// the same while you type or a run starts, and varies from one conversation to the next.

/** How many sentences there are to pick from. */
export const HINT_COUNT = 3

/** A stable pick in `0..count` for `seed` (the conversation id; empty for a new one). */
export function hintIndex(seed: string, count = HINT_COUNT): number {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return count > 0 ? hash % count : 0
}
