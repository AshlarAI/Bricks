<script lang="ts">
	import { ScrollArea } from '$lib/components/ui/scroll-area'
	import { toast } from 'svelte-sonner';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Progress } from '$lib/components/ui/progress';
	import { Spinner } from '$lib/components/ui/spinner';
	import { t } from '$lib/i18n/i18n.svelte';
	import { errorMessage } from '$lib/ipc/client';
	import { app } from '$lib/state/app.svelte';
	import { downloadPercent, formatDownloadProgress, formatPubDate, metadataOf } from './updates';

	let { open = $bindable(false) }: { open: boolean } = $props();

	let busy = $state(false);
	let actionError = $state<string | null>(null);

	const status = $derived(app.updateStatus);
	const meta = $derived(metadataOf(status));
	const pubDate = $derived(formatPubDate(meta?.pub_date));
	const percent = $derived(
		status.phase === 'downloading'
			? downloadPercent(status.downloaded_bytes, status.total_bytes)
			: null
	);
	const progressText = $derived(
		status.phase === 'downloading'
			? formatDownloadProgress(status.downloaded_bytes, status.total_bytes)
			: ''
	);

	async function handleCheck() {
		if (busy) return;
		busy = true;
		actionError = null;
		try {
			await app.checkForUpdates();
		} catch (e) {
			actionError = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function handleDownload() {
		if (busy) return;
		busy = true;
		actionError = null;
		try {
			await app.downloadUpdate();
		} catch (e) {
			actionError = errorMessage(e);
			toast.error(t('updates.checkFailed', { message: actionError }));
		} finally {
			busy = false;
		}
	}

	async function handleCancel() {
		if (busy) return;
		busy = true;
		actionError = null;
		try {
			await app.cancelUpdateDownload();
		} catch (e) {
			actionError = errorMessage(e);
		} finally {
			busy = false;
		}
	}

	async function handleIgnore() {
		if (busy || !meta) return;
		busy = true;
		actionError = null;
		try {
			await app.ignoreUpdate(meta.version);
			open = false;
		} catch (e) {
			actionError = errorMessage(e);
			toast.error(actionError);
		} finally {
			busy = false;
		}
	}

	async function handleInstall() {
		if (busy) return;
		busy = true;
		actionError = null;
		try {
			await app.installUpdate();
		} catch (e) {
			actionError = errorMessage(e);
			toast.error(actionError);
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		{#if status.phase === 'downloading' && meta}
			<Dialog.Header>
				<Dialog.Title>{t('updates.downloadingTitle', { version: meta.version })}</Dialog.Title>
				<Dialog.Description>
					{t('updates.versionTransition', {
						current: meta.current_version,
						next: meta.version
					})}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-2 py-2">
				<Progress
					value={percent ?? 100}
					max={100}
					class={percent == null ? 'animate-pulse' : undefined}
				/>
				<p class="text-ui text-muted-foreground tabular-nums">
					{t('updates.downloadProgress', { version: meta.version, progress: progressText })}
				</p>
			</div>
			<Dialog.Footer>
				<Button variant="outline" disabled={busy} onclick={handleCancel}>
					{t('updates.cancelDownload')}
				</Button>
				<Button onclick={() => (open = false)}>
					{t('updates.background')}
				</Button>
			</Dialog.Footer>
		{:else if status.phase === 'ready' && meta}
			<Dialog.Header>
				<Dialog.Title>{t('updates.readyTitle', { version: meta.version })}</Dialog.Title>
				<Dialog.Description>
					{t('updates.versionTransition', {
						current: meta.current_version,
						next: meta.version
					})}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3 py-1">
				<p class="text-ui text-foreground">
					{t('updates.readyPrompt', { version: meta.version })}
				</p>
				{#if app.hasActiveRuns}
					<Alert.Root variant="warning">
						<TriangleAlert aria-hidden="true" />
						<Alert.Description>{t('updates.activeAgentWarning')}</Alert.Description>
					</Alert.Root>
				{/if}
				{#if actionError}
					<Alert.Root variant="destructive">
						<TriangleAlert aria-hidden="true" />
						<Alert.Description>{actionError}</Alert.Description>
					</Alert.Root>
				{/if}
			</div>
			<Dialog.Footer>
				<Button variant="outline" disabled={busy} onclick={() => (open = false)}>
					{t('updates.later')}
				</Button>
				<Button disabled={busy} onclick={handleInstall}>
					{#if busy}
						<Spinner data-icon="inline-start" />
					{:else}
						<RotateCcw aria-hidden="true" data-icon="inline-start" />
					{/if}
					{t('updates.restartToUpdate')}
				</Button>
			</Dialog.Footer>
		{:else if meta}
			<Dialog.Header>
				<Dialog.Title>{t('updates.title')}</Dialog.Title>
				<Dialog.Description>
					{t('updates.versionTransition', {
						current: meta.current_version,
						next: meta.version
					})}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3 py-1">
				{#if pubDate}
					<p class="text-xs text-muted-foreground">
						{t('updates.publishedOn', { date: pubDate })}
					</p>
				{/if}
				<ScrollArea class="rounded-md border border-border bg-muted/40" viewportClass="max-h-56">
					<div class="p-3 text-ui whitespace-pre-wrap text-foreground">
						{meta.notes?.trim() || t('updates.noReleaseNotes')}
					</div>
				</ScrollArea>
				{#if status.phase === 'error'}
					<Alert.Root variant="destructive">
						<TriangleAlert aria-hidden="true" />
						<Alert.Description>{t('updates.checkFailed', { message: status.message })}</Alert.Description>
					</Alert.Root>
				{:else if actionError}
					<Alert.Root variant="destructive">
						<TriangleAlert aria-hidden="true" />
						<Alert.Description>{actionError}</Alert.Description>
					</Alert.Root>
				{/if}
			</div>
			<Dialog.Footer class="sm:justify-between">
				<Button variant="ghost" disabled={busy} onclick={handleIgnore}>
					{t('updates.ignoreVersion')}
				</Button>
				<div class="flex items-center gap-2">
					<Button variant="outline" disabled={busy} onclick={() => (open = false)}>
						{t('updates.later')}
					</Button>
					<Button disabled={busy} onclick={handleDownload}>
						{#if busy}
							<Spinner data-icon="inline-start" />
						{:else}
							<ArrowDownToLine aria-hidden="true" data-icon="inline-start" />
						{/if}
						{status.phase === 'error' ? t('updates.retry') : t('updates.download')}
					</Button>
				</div>
			</Dialog.Footer>
		{:else if status.phase === 'checking'}
			<Dialog.Header>
				<Dialog.Title>{t('updates.title')}</Dialog.Title>
				<Dialog.Description>{t('updates.checkingHint')}</Dialog.Description>
			</Dialog.Header>
			<div class="flex items-center gap-2.5 py-3 text-ui text-muted-foreground">
				<Spinner />
				<span>{t('updates.checking')}</span>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>
					{t('common.close')}
				</Button>
			</Dialog.Footer>
		{:else if status.phase === 'error'}
			<Dialog.Header>
				<Dialog.Title>{t('updates.title')}</Dialog.Title>
			</Dialog.Header>
			<Alert.Root variant="destructive">
				<TriangleAlert aria-hidden="true" />
				<Alert.Description>{t('updates.checkFailed', { message: status.message })}</Alert.Description>
			</Alert.Root>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>
					{t('common.close')}
				</Button>
				<Button disabled={busy} onclick={handleCheck}>
					{t('updates.retry')}
				</Button>
			</Dialog.Footer>
		{:else}
			<Dialog.Header>
				<Dialog.Title>{t('updates.title')}</Dialog.Title>
				<Dialog.Description>
					{t('updates.currentVersionHint', { version: app.info?.version ?? '' })}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex items-center gap-2 py-2 text-ui text-foreground">
				<CheckCircle2 aria-hidden="true" class="size-4 text-emerald-600" />
				<span>{t('updates.upToDate')}</span>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>
					{t('common.close')}
				</Button>
				<Button disabled={busy} onclick={handleCheck}>
					{t('updates.checkForUpdates')}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
