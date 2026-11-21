// The timeline a reader test changes: a plain array of timeline items, matching Conversation.items.
import type { TimelineItem } from '../../src/lib/state/conversation';

/** An empty timeline whose changes the reader tests can mutate directly. */
export function timeline(): TimelineItem[] {
	return [];
}
