import { createCn } from "cn/config";
import { defaultConfig } from "tailwind-variants";

/**
 * The font sizes of the theme (`text-ui`, `text-caption`…) are sizes, not colours: without this,
 * merging `text-compact` with `text-primary-foreground` drops the colour.
 */
const twMergeConfig = {
	extend: {
		classGroups: {
			"font-size": [{ text: ["ui", "caption", "code", "compact"] }]
		}
	}
};

export const cn = createCn(twMergeConfig);

// The variants of the UI components (`tv()`, e.g. buttonVariants) merge with the same rule. Every
// component imports `cn` from here before it calls `tv()`, so this runs first.
defaultConfig.twMergeConfig = twMergeConfig;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
