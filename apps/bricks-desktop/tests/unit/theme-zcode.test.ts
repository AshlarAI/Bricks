// The ZCode look of the theme, read from src/lib/theme/tokens.json and from the styles that use it:
// neutral surfaces with no hue, a near-black primary in light and a near-white one in dark, one
// blue brand for links, the elevation scale of base.css, and the Tailwind names that wire them.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tokens from '../../src/lib/theme/tokens.json';

type Mode = 'light' | 'dark';
type Oklch = readonly [number, number, number];

const MODES = ['light', 'dark'] as const;

/** The surface and text tokens of the neutral scale: none of them has a hue. */
const NEUTRAL_TOKENS = [
	'background',
	'foreground',
	'card',
	'popover',
	'primary',
	'secondary',
	'muted',
	'accent',
	'sidebar',
	'input',
	'ring',
	'code-bg',
] as const;

const ELEVATIONS = ['xs', 'sm', 'md', 'lg', 'composer'] as const;

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Whether a value is an OKLCH triple: lightness, chroma and hue. */
function isOklch(value: unknown): value is Oklch {
	return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number');
}

/** A colour token of tokens.json, as its OKLCH triple. */
function token(mode: Mode, name: string): Oklch {
	const value: unknown = (tokens.colors[mode] as Record<string, unknown>)[name];
	if (!isOklch(value)) throw new Error(`${mode} ${name} is not an OKLCH triple`);
	return value;
}

/** The declarations of the first block that starts with `selector {` on its own line. */
function blockOf(css: string, selector: string): string {
	const start = new RegExp(`(^|\\n)\\s*${selector.replace(/\./g, '\\.')}\\s*\\{`).exec(css);
	if (!start) throw new Error(`no block ${selector}`);
	const open = css.indexOf('{', start.index);
	let depth = 0;
	for (let i = open; i < css.length; i++) {
		if (css[i] === '{') depth += 1;
		else if (css[i] === '}') {
			depth -= 1;
			if (depth === 0) return css.slice(open + 1, i);
		}
	}
	throw new Error(`unclosed block ${selector}`);
}

/** Whether a block declares the custom property `name`. */
function declares(block: string, name: string): boolean {
	return new RegExp(`(^|[;\\s{])${name}\\s*:`, 'm').test(block);
}

/** Every TypeScript and React source file under src/lib. */
function libFiles(dir: string = fileURLToPath(new URL('../../src/lib', import.meta.url))): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return libFiles(path);
		return /\.(ts|tsx|js)$/.test(entry.name) ? [path] : [];
	});
}

describe('neutral surfaces stay neutral or subtly cool-slate', () => {
	it('every neutral token has chroma 0 in light mode', () => {
		const hued = NEUTRAL_TOKENS.filter((name) => token('light', name)[1] !== 0);
		expect(hued).toEqual([]);
	});

	it('dark neutral tokens stay within a subtle cool-slate chroma (<= 0.015)', () => {
		const saturated = NEUTRAL_TOKENS.filter((name) => token('dark', name)[1] > 0.015);
		expect(saturated).toEqual([]);
	});
});

describe('primary is near black in light and near white in dark', () => {
	it('is near black in light mode', () => {
		expect(token('light', 'primary')[0]).toBeLessThanOrEqual(0.2);
	});

	it('is near white in dark mode', () => {
		expect(token('dark', 'primary')[0]).toBeGreaterThanOrEqual(0.9);
	});
});

describe('brand is the one blue of the links', () => {
	it.each(MODES)('exists in %s mode with a blue hue, from 230 to 245, and some chroma', (mode) => {
		const [, chroma, hue] = token(mode, 'brand');
		expect(chroma).toBeGreaterThan(0);
		expect(hue).toBeGreaterThanOrEqual(230);
		expect(hue).toBeLessThanOrEqual(245);
	});
});

describe('base.css defines the elevations for both modes', () => {
	const base = read('src/styles/base.css');

	it.each([':root', '.dark'])('%s declares the five elevations', (selector) => {
		const block = blockOf(base, selector);
		expect(ELEVATIONS.filter((name) => !declares(block, `--elevation-${name}`))).toEqual([]);
	});
});

describe('the styles wire the names to the tokens', () => {
	const tailwind = read('src/styles/tailwind.css');

	it.each(ELEVATIONS)('--shadow-%s maps to its elevation', (name) => {
		expect(tailwind).toMatch(new RegExp(`--shadow-${name}:\\s*var\\(--elevation-${name}\\)`));
	});

	it('--color-brand maps to --brand, which the generated CSS declares in both modes', () => {
		expect(tailwind).toMatch(/--color-brand:\s*var\(--brand\)/);
		const generated = read('src/styles/tokens.generated.css');
		expect(blockOf(generated, ':root')).toMatch(/--brand:/);
		expect(blockOf(generated, '.dark')).toMatch(/--brand:/);
	});

	it('the markdown links use text-brand, not the primary colour', () => {
		const source = read('src/lib/features/conversation/markdown/render.ts');
		const linkClass = /const LINK_CLASS =\s*'([^']*)'/.exec(source)?.[1];
		expect(linkClass).toBeDefined();
		const classes = (linkClass ?? '').split(/\s+/);
		expect(classes).toContain('text-brand');
		expect(classes).not.toContain('text-primary');
	});

	it('no file under src/lib imports the removed palette', () => {
		const importing = libFiles()
			.filter((path) => /['"][^'"\n]*theme\/palette['"]/.test(readFileSync(path, 'utf8')))
			.map((path) => path.split('/src/lib/')[1]);
		expect(importing).toEqual([]);
	});
});
