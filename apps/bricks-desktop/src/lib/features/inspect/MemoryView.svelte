<script lang="ts">
	// The long-term memory (`/memory`, `/memory global`, the settings): the notes of the
	// project's or the global memory, 50 per page, searchable, editable in place, and
	// deletable. Reading and editing work whether the memory is on or off.
	import { t, localeTag } from '$lib/i18n/i18n.svelte';
	import type { InspectorState } from '$lib/state/ui.svelte';
	import type { MemoryEntry, MemoryEntryPage, MemoryScope } from '$lib/ipc/client';
	import * as ipc from '$lib/ipc/client';
	import { app } from '$lib/state/app.svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { formatInt } from './format';

	let { args }: { args: InspectorState['args'] } = $props();

	const PAGE = 50;
	const NOTE_MAX_CHARS = 280;

	/** The open project, when it has a memory (not the conversations of no project). */
	const project = $derived(app.currentProject && !app.currentProject.chats ? app.currentProject : null);

	let scope = $derived<MemoryScope>(args.scope === 'global' || !project ? 'global' : 'project');
	let query = $state('');
	let offset = $state(0);
	let page = $state<MemoryEntryPage | null>(null);
	let loadError = $state<string | null>(null);
	let confirmingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let editDraft = $state('');
	let savingId = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	let reloadTick = $state(0);

	// Reads the page for the current scope, search and offset. The search waits for
	// typing to pause; an older answer never replaces a newer one.
	let request = 0;
	$effect(() => {
		const read = {
			scope,
			query: query.trim(),
			offset,
			projectId: project?.id ?? null,
			reloadTick
		};
		const id = ++request;
		const timer = setTimeout(async () => {
			try {
				const result = await ipc.memoryEntries(
					read.scope,
					read.scope === 'project' ? read.projectId : null,
					'notes',
					read.query,
					read.offset,
					PAGE
				);
				if (id !== request) return;
				page = result;
				loadError = null;
			} catch (e) {
				if (id !== request) return;
				loadError = ipc.errorMessage(e);
			}
		}, read.query ? 250 : 0);
		return () => clearTimeout(timer);
	});

	function choose(next: () => void) {
		next();
		offset = 0;
		editingId = null;
		confirmingId = null;
	}

	function startEdit(entry: MemoryEntry) {
		actionError = null;
		confirmingId = null;
		editingId = entry.id;
		editDraft = entry.text;
	}

	function cancelEdit() {
		editingId = null;
		editDraft = '';
		actionError = null;
	}

	async function saveEdit(entry: MemoryEntry) {
		if (savingId !== null) return;
		const trimmed = editDraft.trim();
		if (!trimmed) return;
		const targetScope = scope;
		const targetProjectId = targetScope === 'project' ? (project?.id ?? null) : null;
		savingId = entry.id;
		actionError = null;
		try {
			await ipc.memoryUpdateNote(targetScope, targetProjectId, entry.id, trimmed);
			editingId = null;
			editDraft = '';
			reloadTick += 1;
		} catch (e) {
			actionError = ipc.errorMessage(e);
		} finally {
			savingId = null;
		}
	}

	async function removeEntry(entry: MemoryEntry) {
		if (deletingId !== null) return;
		const targetScope = scope;
		const targetProjectId = targetScope === 'project' ? (project?.id ?? null) : null;
		deletingId = entry.id;
		actionError = null;
		try {
			await ipc.memoryDeleteEntry(targetScope, targetProjectId, 'note', entry.id);
			confirmingId = null;
			if (editingId === entry.id) {
				editingId = null;
			}
			if (page) {
				const nextEntries = page.entries.filter((e) => e.id !== entry.id);
				page = { entries: nextEntries, total: Math.max(0, page.total - 1) };
				if (nextEntries.length === 0 && offset >= PAGE) {
					offset = Math.max(0, offset - PAGE);
				}
			}
			reloadTick += 1;
		} catch (e) {
			actionError = ipc.errorMessage(e);
		} finally {
			deletingId = null;
		}
	}

	function when(at: number): string {
		return new Date(at).toLocaleString(localeTag(), { dateStyle: 'medium', timeStyle: 'short' });
	}

	/** The title of a conversation of the loaded lists, when known. */
	function conversation(sessionId: string): string | null {
		for (const list of app.sessionsByProject.values()) {
			const found = list.find((s) => s.id === sessionId);
			if (found) return found.title || t('common.untitled');
		}
		return null;
	}

	/** Where a note comes from: its project (global memory), its conversation. */
	function source(e: MemoryEntry): string {
		const parts: string[] = [];
		if (scope === 'global' && e.project_id) {
			parts.push(t('inspect.project', { projectId: e.project_name ?? e.project_id }));
		}
		if (e.session_id) parts.push(conversation(e.session_id) ?? t('inspect.closedConversation'));
		return parts.join(' · ');
	}
</script>

<div class="flex min-w-0 flex-col gap-4">
	<div class="flex flex-wrap items-center gap-2">
		<Tabs.Root value={scope} onValueChange={(v) => choose(() => (scope = v as MemoryScope))}>
			<Tabs.List aria-label={t('inspect.memoryShown')}>
				<Tabs.Trigger value="project" disabled={!project}>{t('common.project')}</Tabs.Trigger>
				<Tabs.Trigger value="global">{t('inspect.global')}</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
		<Input
			type="search"
			placeholder={t('common.search')}
			aria-label={t('inspect.searchTheMemory')}
			class="h-8 min-w-40 flex-1 text-ui"
			value={query}
			oninput={(event) => choose(() => (query = event.currentTarget.value))}
		/>
	</div>

	{#if loadError !== null}
		<p role="alert" class="text-ui text-pretty text-destructive">{loadError}</p>
	{:else if page === null}
		<div class="flex flex-col gap-2">
			<Skeleton class="h-14 w-full" />
			<Skeleton class="h-14 w-full" />
		</div>
	{:else if page.entries.length === 0}
		<p class="text-ui text-muted-foreground">{t('inspect.noMemory')}</p>
	{:else}
		{#if actionError !== null}
			<p role="alert" class="text-ui text-pretty text-destructive">{actionError}</p>
		{/if}
		<ul class="flex flex-col divide-y divide-border rounded-lg border border-border">
			{#each page.entries as entry (entry.id)}
				<li class="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
					<div class="flex min-w-0 items-start justify-between gap-2">
						<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
							<Badge variant="secondary">{t('common.note')}</Badge>
							<time datetime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>
							{#if source(entry)}
								<span class="min-w-0 truncate">{source(entry)}</span>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-1">
							{#if confirmingId === entry.id}
								<Button
									variant="destructive"
									size="sm"
									disabled={deletingId !== null}
									onclick={() => void removeEntry(entry)}
								>
									{t('common.delete')}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={deletingId !== null}
									onclick={() => (confirmingId = null)}
								>
									{t('common.cancel')}
								</Button>
							{:else if editingId !== entry.id}
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t('common.edit')}
									title={t('common.edit')}
									disabled={deletingId !== null || savingId !== null}
									onclick={() => startEdit(entry)}
								>
									<Pencil aria-hidden="true" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t('inspect.deleteMemoryEntry')}
									title={t('common.delete')}
									disabled={deletingId !== null || savingId !== null}
									onclick={() => {
										actionError = null;
										confirmingId = entry.id;
									}}
								>
									<Trash2 aria-hidden="true" />
								</Button>
							{/if}
						</div>
					</div>
					{#if editingId === entry.id}
						<form
							class="flex flex-col gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								void saveEdit(entry);
							}}
						>
							<Input
								type="text"
								maxlength={NOTE_MAX_CHARS}
								aria-label={t('common.edit')}
								class="h-8 text-ui"
								bind:value={editDraft}
								disabled={savingId !== null}
							/>
							<div class="flex items-center justify-between gap-2">
								<span class="text-caption tabular-nums text-muted-foreground">
									{editDraft.trim().length}/{NOTE_MAX_CHARS}
								</span>
								<div class="flex items-center gap-1">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={savingId !== null}
										onclick={cancelEdit}
									>
										{t('common.cancel')}
									</Button>
									<Button
										type="submit"
										size="sm"
										disabled={savingId !== null || editDraft.trim().length === 0}
									>
										{t('common.save')}
									</Button>
								</div>
							</div>
						</form>
					{:else}
						<p class="text-ui break-words whitespace-pre-wrap">{entry.text}</p>
					{/if}
				</li>
			{/each}
		</ul>
		<div class="flex items-center justify-between gap-2 text-caption text-muted-foreground">
			<span class="tabular-nums">
				{t('inspect.of', { value: formatInt(offset + 1), entries: formatInt(offset + page.entries.length), total: formatInt(page.total) })}
			</span>
			<div class="flex gap-2">
				<Button
					variant="ghost"
					size="sm"
					disabled={offset === 0}
					onclick={() => (offset = Math.max(0, offset - PAGE))}
				>
					{t('common.previous')}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={offset + PAGE >= page.total}
					onclick={() => (offset += PAGE)}
				>
					{t('common.next')}
				</Button>
			</div>
		</div>
	{/if}
</div>
