import type { ComponentType } from 'react';

/** Heading level a component renders its title with. Pick the level that fits the page outline. */
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

/** Status indicator state used across StatusDot and feature labels. */
export type StatusState = 'idle' | 'running' | 'waiting' | 'success' | 'error' | 'cancelled';

/** A lucide icon component (or any component taking className and aria-hidden). */
export type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/** Layout state that the caller may persist (prefs IPC). Emitted by AppShell after user changes. */
export interface ShellLayout {
	leftOpen: boolean;
	rightOpen: boolean;
	terminalOpen: boolean;
	/** Preferred inline width of the left panel, px. */
	leftWidth: number;
	/** Preferred inline width of the right panel, px. */
	rightWidth: number;
	/** Share of the centre column given to the terminal pane, 0.1–0.8. */
	terminalRatio: number;
}

/**
 * Toggle state and callbacks handed to the topbar. A callback that is
 * undefined means the corresponding pane is not provided, so its toggle is hidden.
 * Spread it onto <TopBar {...controls} />.
 */
export interface ShellControls {
	leftPressed: boolean;
	rightPressed: boolean;
	terminalPressed: boolean;
	onToggleLeft?: () => void;
	onToggleRight?: () => void;
	onToggleTerminal?: () => void;
}
