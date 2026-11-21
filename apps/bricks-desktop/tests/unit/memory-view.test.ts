// Static checks of the memory view (source read, not rendered): pages of 50 notes,
// debounced search dropping stale answers, scope rules, independent reading, inline
// editing and deletion with confirmation.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatInt } from '../../src/lib/features/inspect/format';
import { bound, call } from './french-keys';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const VIEW = 'lib/features/inspect/MemoryView.tsx';
const view = src(VIEW);

describe('pages', () => {
	it('reads 50 notes a page, the engine maximum', () => {
		expect(view).toContain('const PAGE = 50');
		expect(view).toMatch(/offset,\s*PAGE,/);
	});

	it('moves back and forth by one page, never before the first entry', () => {
		expect(view).toContain('onClick={() => setOffset((prev) => Math.max(0, prev - PAGE))}');
		expect(view).toContain('onClick={() => setOffset((prev) => prev + PAGE)}');
		expect(view).toContain('disabled={offset === 0}');
		expect(view).toContain('disabled={offset + PAGE >= page.total}');
	});

	it('says which entries the page shows out of the total', () => {
		expect(view).toContain("t('inspect.of', {");
		expect(view).toContain('value: formatInt(offset + 1)');
		expect(view).toContain('entries: formatInt(offset + page.entries.length)');
		expect(view).toContain('total: formatInt(page.total)');
		expect(formatInt(1)).toBe(new Intl.NumberFormat('fr-FR').format(1));
		expect(formatInt(1234.4)).toBe(new Intl.NumberFormat('fr-FR').format(1234));
	});

	it('goes back to the first page when the scope or the search changes', () => {
		expect(view).toContain('const nextQuery = event.currentTarget.value');
		expect(view).toContain('choose(() => setQuery(nextQuery))');
		expect(view).toContain('choose(() => setScopeState({ key: scopeKey, value: v as MemoryScope }))');
	});
});

describe('search', () => {
	it('waits 250 ms after typing, and reads at once with no search text', () => {
		expect(view).toContain('}, trimmedQuery ? 250 : 0)');
	});

	it('drops an answer that a newer request has replaced', () => {
		const count = view.split('if (cancelled || id !== requestRef.current) return').length - 1;
		expect(count).toBe(2);
	});

	it('labels the search field for screen readers', () => {
		expect(view).toContain(bound('aria-label', 'Rechercher dans la mémoire'));
	});
});

describe('scope', () => {
	it('reads the global memory when asked for it, or when no project is open', () => {
		expect(view).toContain(
			"const defaultScope: MemoryScope = args.scope === 'global' || !project ? 'global' : 'project'",
		);
	});

	it('sends the project only for the project scope', () => {
		expect(view).toContain("scope === 'project' ? projectId : null");
	});

	it('disables the project tab when there is no project, and never reads conversations without one', () => {
		expect(view).toMatch(/<TabsTrigger value="project" disabled=\{!project\}>\s*\{t\('common\.project'\)\}\s*<\/TabsTrigger>/);
		expect(view).toContain('const project = app.currentProject && !app.currentProject.chats ? app.currentProject : null');
	});
});

describe('reading is independent of the switch', () => {
	it('never checks whether the memory is on', () => {
		expect(view).not.toContain('memory_enabled');
		expect(view).not.toContain('setMemoryEnabled');
	});
});

describe('notes', () => {
	it('labels notes and shows their timestamp', () => {
		expect(view).toContain(`<Badge variant="secondary">{${call('Note')}}</Badge>`);
		expect(view).toContain('<time dateTime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>');
	});

	it('says where a global note comes from: its project, then its conversation', () => {
		const start = view.indexOf('function source(');
		const body = view.slice(start, view.indexOf('return (', start));
		expect(body).toContain("parts.push(t('inspect.project', { projectId: e.project_name ?? e.project_id }))");
		expect(body).toContain(`parts.push(conversation(e.session_id) ?? ${call('Conversation fermée')})`);
		expect(body.indexOf("t('inspect.project'")).toBeLessThan(body.indexOf("t('inspect.closedConversation'"));
	});

	it('names an untitled conversation of the loaded lists', () => {
		expect(view).toContain(`return found.title || ${call('Sans titre')}`);
	});
});

describe('empty and failed reads', () => {
	it('says there is no memory when the page is empty, and shows a failed read as an alert', () => {
		expect(view).toContain(`<p className="text-ui text-muted-foreground">{${call('Aucune mémoire')}}</p>`);
		expect(view).toMatch(/<p role="alert" className="text-ui text-pretty text-destructive">\s*\{loadError\}\s*<\/p>/);
	});

	it('shows placeholders until the first page arrives', () => {
		expect(view).toContain(') : page === null ? (');
		expect(view).toContain('<Skeleton className="h-14 w-full" />');
	});
});

describe('note editing and deletion', () => {
	it('supports inline editing with 280-char limit and saves via memoryUpdateNote', () => {
		expect(view).toMatch(/import\s*\{[^}]*\bPencilIcon\b[^}]*\}\s*from 'lucide-react'/);
		expect(view).toContain('const NOTE_MAX_CHARS = 280');
		expect(view).toContain('await ipc.memoryUpdateNote(targetScope, targetProjectId, entry.id, trimmed)');
	});

	it('offers an easy delete button per note with inline confirmation via shadcn Button', () => {
		expect(view).toMatch(/import\s*\{[^}]*\bTrash2Icon\b[^}]*\}\s*from 'lucide-react'/);
		expect(view).toContain(bound('aria-label', 'Supprimer cette entrée mémoire'));
		expect(view).toContain("await ipc.memoryDeleteEntry(targetScope, targetProjectId, 'note', entry.id)");
		expect(view).toMatch(/<Button\s+variant="destructive"\s+size="sm"/);
		expect(view).toMatch(/<p role="alert" className="text-ui text-pretty text-destructive">\s*\{actionError\}\s*<\/p>/);
	});
});
