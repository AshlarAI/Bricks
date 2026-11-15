<script lang="ts">
	import { ScrollArea } from '$lib/components/ui/scroll-area'
	// Left panel: projects with their conversations, the conversations without a project, and search.
	// Entry point mounted by App.svelte with no props. All state lives in `app`.
	import { t } from '$lib/i18n/i18n.svelte';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';
	import Settings from '@lucide/svelte/icons/settings';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { hasActionableUpdate, updateTooltipLabel } from '$lib/features/updates/updates';
	import { app } from '$lib/state/app.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import ConversationList from './ConversationList.svelte';
	import NewConversationButton from './NewConversationButton.svelte';
	import ProjectList from './ProjectList.svelte';

	let adding = $state(false);

	const chats = $derived(app.chatsProject);
	const showUpdateButton = $derived(hasActionableUpdate(app.updateStatus));
	const updateTooltip = $derived(updateTooltipLabel(app.updateStatus));

	async function addProject() {
		if (adding) return;
		adding = true;
		try {
			await app.addProject();
		} catch (error) {
			app.fail(error);
		} finally {
			adding = false;
		}
	}
</script>

<aside
	aria-label={t('navigation.projectsAndConversations')}
	class="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
>
	<div class="flex flex-col gap-0.5 px-2 pt-1 pb-3">
		<NewConversationButton class="w-full justify-start px-2 text-ui" />
	</div>

	<!-- Native scrolling, like shadcn's Sidebar.Content, and scroll-fade: an edge fades only where there is more to see. -->
	<ScrollArea class="min-h-0 flex-1" viewportClass="scroll-fade scroll-fade-6">
		<div class="flex flex-col gap-4 pb-6">
			{#if app.pinnedSessions.length > 0}
				<section class="flex flex-col gap-1 px-2">
					<h2 class="sticky top-0 z-10 bg-sidebar flex h-6 items-center px-2 text-xs font-medium text-muted-foreground">{t('navigation.pinned')}</h2>
					<ConversationList sessions={app.pinnedSessions} label={t('navigation.pinned')} />
				</section>
			{/if}

			<section class="flex flex-col gap-1 px-2">
				<div class="sticky top-0 z-10 bg-sidebar flex h-6 items-center justify-between pr-0.5 pl-2">
					<h2 class="text-xs font-medium text-muted-foreground">{t('navigation.projects')}</h2>
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground hover:text-foreground"
						aria-label={t('navigation.newProject')}
						title={t('navigation.newProject')}
						onclick={addProject}
						disabled={adding}
					>
						<FolderPlus aria-hidden="true" />
					</Button>
				</div>
				{#if app.folders.length > 0}
					<ProjectList />
				{/if}
			</section>

			{#if chats && app.sessionsOf(chats.id).some((s) => !app.isPinned(s.id))}
				<section class="flex flex-col gap-1 px-2">
					<h2 class="sticky top-0 z-10 bg-sidebar flex h-6 items-center px-2 text-xs font-medium text-muted-foreground">{t('navigation.conversations')}</h2>
					<ConversationList projectId={chats.id} label={t('navigation.conversations')} />
				</section>
			{/if}
		</div>
	</ScrollArea>

	<div class="flex items-center gap-1.5 px-2 pt-2 pb-1">
		<Button
			variant="ghost"
			class="min-w-0 flex-1 justify-start text-ui"
			aria-label={t('common.bricksSettings')}
			onclick={() => (ui.settingsOpen = true)}
		>
			<Settings aria-hidden="true" data-icon="inline-start" />
			{t('navigation.settings')}
		</Button>
		{#if showUpdateButton}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="default"
							size="icon-sm"
							class="shrink-0 rounded-full bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-600 dark:hover:bg-emerald-500 [&_svg]:size-3.5"
							aria-label={updateTooltip}
							onclick={() => (ui.updateDialogOpen = true)}
						>
							{#if app.updateStatus.phase === 'downloading'}
								<Spinner aria-hidden="true" />
							{:else}
								<ArrowDownToLine aria-hidden="true" />
							{/if}
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="top" sideOffset={6}>{updateTooltip}</Tooltip.Content>
			</Tooltip.Root>
		{/if}
	</div>
</aside>
