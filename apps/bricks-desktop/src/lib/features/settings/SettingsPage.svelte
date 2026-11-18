<script lang="ts">
	// Settings of Bricks, over the whole window: on the left « Retour à l'espace de travail », a
	// search and the sections by group; on the right the section, under its title. The workspace
	// stays mounted underneath (its conversations, drafts and scroll wait for the way back).
	import { t } from '$lib/i18n/i18n.svelte';
	import type { Component } from 'svelte';
	import AppWindow from '@lucide/svelte/icons/app-window';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Brain from '@lucide/svelte/icons/brain';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Palette from '@lucide/svelte/icons/palette';
	import Plug from '@lucide/svelte/icons/plug';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import * as InputGroup from '$lib/components/ui/input-group';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { TOP_BAR } from '$lib/layout/constants';
	import { ui } from '$lib/state/ui.svelte';
	import AppearanceSettings from './AppearanceSettings.svelte';
	import ApplicationSettings from './ApplicationSettings.svelte';
	import ExtensionsSettings from './ExtensionsSettings.svelte';
	import GeneralSettings from './GeneralSettings.svelte';
	import MemorySettings from './MemorySettings.svelte';
	import ModelSettings from './ModelSettings.svelte';
	import SkillsSettings from './SkillsSettings.svelte';
	import UsageSettings from './UsageSettings.svelte';

	/** macOS draws its window buttons over the top left corner. */
	let { systemButtons = false }: { systemButtons?: boolean } = $props();

	type SectionId = 'general' | 'appearance' | 'models' | 'application' | 'memory' | 'skills' | 'extensions' | 'usage';

	interface Section {
		id: SectionId;
		label: string;
		icon: Component<{ class?: string }>;
		content: Component;
	}

	const GROUPS: { label: string; sections: Section[] }[] = [
		{
			get label() { return t('settings.groupBasics') },
			sections: [
				{ id: 'general', get label() { return t('settings.general') }, icon: SlidersHorizontal, content: GeneralSettings },
				{ id: 'appearance', get label() { return t('settings.appearance') }, icon: Palette, content: AppearanceSettings },
				{ id: 'models', get label() { return t('settings.models') }, icon: Cpu, content: ModelSettings },
				{ id: 'application', get label() { return t('settings.application') }, icon: AppWindow, content: ApplicationSettings }
			]
		},
		{
			get label() { return t('settings.groupAgent') },
			sections: [
				{ id: 'memory', get label() { return t('common.memory') }, icon: Brain, content: MemorySettings },
				{ id: 'skills', get label() { return t('common.skills') }, icon: Sparkles, content: SkillsSettings },
				{ id: 'extensions', get label() { return t('settings.extensions') }, icon: Plug, content: ExtensionsSettings }
			]
		},
		{
			get label() { return t('settings.groupData') },
			sections: [{ id: 'usage', get label() { return t('common.usage') }, icon: ChartColumn, content: UsageSettings }]
		}
	];
	const SECTIONS = GROUPS.flatMap((g) => g.sections);

	/** The page mounts when the settings open: the section asked for (`/mcp`: the extensions) is taken once. */
	function firstSection(): SectionId {
		const wanted = SECTIONS.find((s) => s.id === ui.settingsSection)?.id;
		ui.settingsSection = null;
		return wanted ?? 'general';
	}

	let section = $state<SectionId>(firstSection());
	let query = $state('');

	/** Lower case, accents removed: « mémoire » matches « memoire ». */
	const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

	const groups = $derived.by(() => {
		const wanted = fold(query.trim());
		if (wanted === '') return GROUPS;
		return GROUPS.map((g) => ({ label: g.label, sections: g.sections.filter((s) => fold(s.label).includes(wanted)) })).filter(
			(g) => g.sections.length > 0
		);
	});

	const current = $derived(SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]);

	function close() {
		ui.settingsSection = null;
		ui.settingsOpen = false;
	}

	/** The workspace behind is inert: focus starts on « Retour à l'espace de travail ». */
	function focusBack(node: HTMLElement) {
		node.querySelector<HTMLElement>('[data-sidebar="menu-button"]')?.focus();
	}

	/** Escape goes back to the workspace; a dialog, menu or list open over the page keeps its own. */
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
		close();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fixed inset-0 z-40 flex bg-sidebar" role="region" aria-label={t('common.bricksSettings')} {@attach focusBack}>
	<Sidebar.Provider class="min-h-0">
		<Sidebar.Root collapsible="none">
			<div
				data-tauri-drag-region
				class="shrink-0"
				style:height="{TOP_BAR.height}px"
				style:margin-left={systemButtons ? `${TOP_BAR.macSystemButtons}px` : undefined}
			></div>
			<Sidebar.Header class="pt-0">
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton onclick={close}>
							<ArrowLeft />
							<span>{t('settings.backToWorkspace')}</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
				<InputGroup.Root class="bg-background">
					<InputGroup.Addon>
						<Search />
					</InputGroup.Addon>
					<InputGroup.Input type="search" placeholder={t('settings.searchSettings')} aria-label={t('settings.searchSettings')} bind:value={query} />
				</InputGroup.Root>
			</Sidebar.Header>
			<Sidebar.Content>
				{#each groups as group (group.label)}
					<Sidebar.Group>
						<Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
						<Sidebar.GroupContent>
							<Sidebar.Menu>
								{#each group.sections as item (item.id)}
									{@const Icon = item.icon}
									<Sidebar.MenuItem>
										<Sidebar.MenuButton isActive={section === item.id} onclick={() => (section = item.id)}>
											<Icon />
											<span>{item.label}</span>
										</Sidebar.MenuButton>
									</Sidebar.MenuItem>
								{/each}
							</Sidebar.Menu>
						</Sidebar.GroupContent>
					</Sidebar.Group>
				{/each}
			</Sidebar.Content>
		</Sidebar.Root>

		<Sidebar.Inset class="m-2 ml-0 min-h-0 overflow-hidden rounded-xl border border-border">
			<div data-tauri-drag-region class="h-8 shrink-0"></div>
			<ScrollArea class="min-h-0 flex-1">
				<div class="mx-auto flex w-full max-w-5xl flex-col gap-8 px-10 pb-16">
					<h1 class="text-3xl font-semibold tracking-tight text-foreground">{current.label}</h1>
					{#key current.id}
						<current.content />
					{/key}
				</div>
			</ScrollArea>
		</Sidebar.Inset>
	</Sidebar.Provider>
</div>
