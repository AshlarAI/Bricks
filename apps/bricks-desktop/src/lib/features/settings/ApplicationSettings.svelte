<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import { t } from '$lib/i18n/i18n.svelte';
	import { app } from '$lib/state/app.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { hasActionableUpdate, updateTooltipLabel } from '$lib/features/updates/updates';
	import SettingsGroup from './SettingsGroup.svelte';
	import CopyValue from './CopyValue.svelte';
	import { platformLabel, versionLabel } from './format';

	const info = $derived(app.info);
	const updateStatus = $derived(app.updateStatus);
	const checking = $derived(updateStatus.phase === 'checking');
	const actionable = $derived(hasActionableUpdate(updateStatus));
	const statusLine = $derived(updateTooltipLabel(updateStatus));

	async function onUpdateAction() {
		if (actionable) {
			ui.updateDialogOpen = true;
			return;
		}
		const next = await app.checkForUpdates();
		if (next.phase === 'available' || next.phase === 'ready') {
			ui.updateDialogOpen = true;
		} else if (next.phase === 'up_to_date') {
			toast.success(t('updates.upToDate'));
		} else if (next.phase === 'error') {
			toast.error(t('updates.checkFailed', { message: next.message }));
		}
	}
</script>

<div class="flex flex-col gap-6">
	{#if !info}
		<p class="text-ui text-muted-foreground">{t('settings.informationUnavailable')}</p>
	{:else}
		<SettingsGroup title="Bricks">
			<dl class="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 p-3 text-ui">
				<dt class="text-muted-foreground">{t('settings.name')}</dt>
				<dd class="text-foreground">Bricks</dd>
				<dt class="text-muted-foreground">{t('settings.version')}</dt>
				<dd class="tabular-nums text-foreground" title={info.version}>{versionLabel(info.version)}</dd>
				<dt class="text-muted-foreground">{t('settings.platform')}</dt>
				<dd class="text-foreground">{platformLabel(info.platform)}</dd>
			</dl>
			<div class="flex items-center justify-between gap-3 p-3">
				<span class="min-w-0 truncate text-ui text-muted-foreground">{statusLine}</span>
				<Button
					variant="outline"
					size="sm"
					class="shrink-0"
					disabled={checking}
					onclick={onUpdateAction}
				>
					{#if checking}
						<Spinner data-icon="inline-start" />
						{t('updates.checking')}
					{:else if updateStatus.phase === 'ready'}
						{t('updates.restartToUpdate')}
					{:else if updateStatus.phase === 'available' || updateStatus.phase === 'downloading'}
						{t('updates.viewUpdate')}
					{:else}
						{t('updates.checkForUpdates')}
					{/if}
				</Button>
			</div>
		</SettingsGroup>

		<SettingsGroup title={t('settings.folders')}>
			<div class="flex flex-col gap-2 p-3">
				<span class="text-ui text-muted-foreground" id="settings-bricks-home-label">{t('settings.bricksFolder')}</span>
				<div role="group" aria-labelledby="settings-bricks-home-label">
					<CopyValue label={t('settings.bricksFolder')} value={info.bricks_home} />
				</div>
			</div>
			<div class="flex flex-col gap-2 p-3">
				<span class="text-ui text-muted-foreground" id="settings-sessions-label">{t('settings.conversationsFolder')}</span>
				<div role="group" aria-labelledby="settings-sessions-label">
					<CopyValue label={t('settings.conversationsFolder')} value={info.sessions_dir} />
				</div>
			</div>
		</SettingsGroup>
	{/if}
</div>
