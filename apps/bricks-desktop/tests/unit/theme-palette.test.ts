// The default theme stays readable. These are the readability invariants of the former palette
// tests (body text, muted text, the text on the primary colour and the focus ring), now read from
// the ZCode neutrals of tokens.json. The custom colours that the palette used to set are gone.
import { describe, expect, it } from 'vitest';
import tokens from '../../src/lib/theme/tokens.json';

type Mode = 'light' | 'dark';
type Oklch = readonly [number, number, number];

const MODES = ['light', 'dark'] as const;

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

/** WCAG relative luminance of an OKLCH colour: OKLab to linear sRGB, weighted by the sRGB primaries. */
function luminance([lightness, chroma, hue]: Oklch): number {
	const radians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(radians);
	const b = chroma * Math.sin(radians);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
function contrast(a: Oklch, b: Oklch): number {
	const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (lighter + 0.05) / (darker + 0.05);
}

describe('the default theme is readable', () => {
	it('the body text keeps more than 12:1 on the light background and more than 10:1 on the dark one', () => {
		expect(contrast(token('light', 'foreground'), token('light', 'background'))).toBeGreaterThan(12);
		expect(contrast(token('dark', 'foreground'), token('dark', 'background'))).toBeGreaterThan(10);
	});

	it('the muted text keeps more than 4.5:1 on the light background', () => {
		expect(contrast(token('light', 'muted-foreground'), token('light', 'background'))).toBeGreaterThan(4.5);
	});

	it.each(MODES)('the text on the primary colour keeps 4.5:1 or more in %s mode', (mode) => {
		expect(contrast(token(mode, 'primary-foreground'), token(mode, 'primary'))).toBeGreaterThanOrEqual(4.5);
	});

	it.each(MODES)('the focus ring is seen on the background at 3:1 or more in %s mode', (mode) => {
		expect(contrast(token(mode, 'ring'), token(mode, 'background'))).toBeGreaterThanOrEqual(3);
	});
});
