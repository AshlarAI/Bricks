// @vitest-environment happy-dom
// A top-level code block of a message (markdown/CodeFence.tsx): its file or language in the
// header, numbered lines, wrap, download through the save dialog, and copy. Mounted in happy-dom.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushReact, mountReact, tickReact, type MountedComponent } from './react-test-utils';
import CodeFence, { type CodeFenceProps } from '../../src/lib/features/conversation/markdown/CodeFence';
import { formatElapsed } from '../../src/lib/features/conversation/format';

const saveTextFile = vi.hoisted(() => vi.fn(async (_name: string, _contents: string) => null));

vi.mock('@tauri-apps/api/core', () => {
	class Channel {
		onmessage: ((event: unknown) => void) | null = null;
	}
	return { Channel, invoke: vi.fn() };
});
vi.mock('$lib/ipc/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/ipc/client')>()),
	saveTextFile
}));

let app: MountedComponent<CodeFenceProps> | null = null;
let target: HTMLDivElement | null = null;

function show(props: CodeFenceProps): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	app = mountReact(CodeFence, { target, props });
	return target;
}

afterEach(() => {
	app?.unmount();
	app = null;
	target?.remove();
	target = null;
	saveTextFile.mockClear();
});

describe('CodeFence', () => {
	it('names the file of its info string, with its icon, and numbers every line', () => {
		const root = show({ source: 'print(1)\nprint(2)\n', lang: 'ts src/app.py', complete: true });
		const title = root.querySelector('[data-slot="code-block-title"]')!;
		expect(title.textContent).toBe('src/app.py');
		expect(title.querySelector('img')?.getAttribute('src')).toMatch(/python\.svg$/);
		expect(root.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(2);
		expect(root.querySelector('[data-slot="code-block-content"]')?.hasAttribute('data-numbered')).toBe(true);
	});

	it('names its language when no file is given, and « text » when there is none', () => {
		expect(show({ source: 'ls', lang: 'bash', complete: true }).textContent).toContain('bash');
		app?.unmount();
		target?.remove();
		expect(show({ source: 'x', lang: '', complete: true }).textContent).toContain('texte');
	});

	it('wraps its lines on demand', () => {
		const root = show({ source: 'a', lang: 'rust', complete: true });
		const wrap = root.querySelector<HTMLButtonElement>('button[aria-label="Retour à la ligne"]')!;
		const content = root.querySelector('[data-slot="code-block-content"]')!;
		expect(wrap.getAttribute('aria-pressed')).toBe('false');
		expect(content.hasAttribute('data-wrap')).toBe(false);
		flushReact(() => wrap.click());
		expect(wrap.getAttribute('aria-pressed')).toBe('true');
		expect(content.hasAttribute('data-wrap')).toBe(true);
	});

	it('downloads its source under its file name, or code.<extension>, once complete', async () => {
		let root = show({ source: 'fn main() {}', lang: 'rust', complete: false });
		let download = root.querySelector<HTMLButtonElement>('button[aria-label="Télécharger"]')!;
		expect(download.disabled).toBe(true);
		app?.unmount();
		target?.remove();

		root = show({ source: 'fn main() {}', lang: 'rust', complete: true });
		download = root.querySelector<HTMLButtonElement>('button[aria-label="Télécharger"]')!;
		flushReact(() => download.click());
		await tickReact();
		expect(saveTextFile).toHaveBeenCalledWith('code.rs', 'fn main() {}');
		app?.unmount();
		target?.remove();

		root = show({ source: 'x', lang: 'ts app/api/chat/route.ts', complete: true });
		flushReact(() => root.querySelector<HTMLButtonElement>('button[aria-label="Télécharger"]')!.click());
		await tickReact();
		expect(saveTextFile).toHaveBeenLastCalledWith('route.ts', 'x');
	});
});

describe('a long CodeFence', () => {
	it('is framed as an artifact past 30 lines, with its size in lines', () => {
		const long = Array.from({ length: 31 }, (_, i) => `let v${i} = ${i};`).join('\n');
		let root = show({ source: long, lang: 'rust', complete: true });
		expect(root.querySelector('[data-slot="artifact"]')).not.toBeNull();
		expect(root.querySelector('[data-slot="artifact-description"]')?.textContent).toBe('31 lignes');
		expect(root.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(31);
		app?.unmount();
		target?.remove();
		root = show({ source: 'let a = 1;', lang: 'rust', complete: true });
		expect(root.querySelector('[data-slot="artifact"]')).toBeNull();
	});
});

describe('formatElapsed', () => {
	it('reads from its largest unit down to seconds', () => {
		expect(formatElapsed(0)).toBe('0s');
		expect(formatElapsed(32_400)).toBe('32s');
		expect(formatElapsed(61_000)).toBe('1m 1s');
		expect(formatElapsed(3_692_000)).toBe('1h 1m 32s');
		expect(formatElapsed(3_600_000)).toBe('1h 0m 0s');
		expect(formatElapsed(90_061_000)).toBe('1j 1h 1m 1s');
		expect(formatElapsed(-5)).toBe('0s');
	});
});
