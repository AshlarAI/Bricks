<script lang="ts">
	import { ScrollArea } from '$lib/components/ui/scroll-area'
	import { t } from '$lib/i18n/i18n.svelte';
	import { cn } from '$lib/utils.js';
	import { parsePatch, type PatchLineKind } from './patch';

	interface Props {
		/** Unified diff text, as produced by Rust. */
		patch: string;
		/** The patch was cut to the size limit. */
		truncated?: boolean;
		/** Binary file: there is no text to show. */
		binary?: boolean;
		/** A patch written in a message: `+`/`-` lines count even without hunk headers. */
		loose?: boolean;
		class?: string;
	}

	let { patch, truncated = false, binary = false, loose = false, class: className }: Props = $props();

	/** Every line of the patch: no page of lines to unfold. */
	const shown = $derived(parsePatch(patch, { loose }));

	// Both markers are on the left: a coloured gutter edge, then the old and
	// new line numbers; the line keeps its own `+` / `-` (not colour only).
	const ROW: Record<PatchLineKind, string> = {
		add: 'bg-diff-add-bg border-l-diff-add',
		del: 'bg-diff-del-bg border-l-diff-del',
		context: 'border-l-transparent',
		hunk: 'bg-muted text-muted-foreground border-l-transparent',
		meta: 'text-muted-foreground border-l-transparent'
	};
</script>

<div
	class={cn(
		'overflow-hidden rounded-md border border-border bg-code-bg text-xs text-code-foreground',
		className
	)}
>
	{#if truncated}
		<p role="status" class="border-b border-border px-2 py-1 text-warning">
			{t('changes.diffTruncatedOnlyTheFirstLines')}
		</p>
	{/if}

	{#if binary}
		<p class="px-2 py-2 text-muted-foreground">{t('changes.binaryFileNoPreviewAvailable')}</p>
	{:else if shown.length === 0}
		<p class="px-2 py-2 text-muted-foreground">{t('changes.noTextChanges')}</p>
	{:else}
		<!-- A named, focusable scroll container: keyboard users must be able to scroll
			it (WCAG 2.1.1). The rule only checks the role, so it is suppressed here. -->
		<ScrollArea class="rounded-sm" viewportClass="max-h-96 outline-none focus-visible:ring-2 focus-visible:ring-ring" orientation="both" viewportProps={{ role: 'region', 'aria-label': t('common.diff'), tabindex: 0 }}>
			<div class="font-mono leading-5">
				<div class="min-w-max py-1">
					{#each shown as line, i (i)}
						<div class={cn('grid grid-cols-[3rem_3rem_minmax(0,1fr)] border-l-[3px]', ROW[line.kind])}>
							<span class="px-1 text-right text-muted-foreground tabular-nums select-none">{line.oldNo ?? ''}</span>
							<span class="px-1 text-right text-muted-foreground tabular-nums select-none">{line.newNo ?? ''}</span>
							<span class="px-2 whitespace-pre">{line.text}</span>
						</div>
					{/each}
				</div>
			</div>
		</ScrollArea>
	{/if}
</div>
