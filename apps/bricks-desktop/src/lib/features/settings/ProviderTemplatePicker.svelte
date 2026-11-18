<script lang="ts">
	// « Ajouter un fournisseur », in the right column: the providers Bricks adds in one step (a card
	// each, grouped by brand), then « Créer un fournisseur personnalisé » (the provider form).
	// A card opens its key form; « Ajouter » writes the provider with its current models.
	import { t } from '$lib/i18n/i18n.svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Plus from '@lucide/svelte/icons/plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Item from '$lib/components/ui/item';
	import * as Field from '$lib/components/ui/field';
	import { Spinner } from '$lib/components/ui/spinner';
	import type { ProviderTemplate } from '$lib/ipc/bindings/ProviderTemplate';
	import { cn } from '$lib/utils';
	import ProviderLogo from './ProviderLogo.svelte';
	import { keyProblem, protocolLabel } from './models';

	let {
		templates,
		loadError,
		canGoBack,
		onBack,
		onCustom,
		onCreate
	}: {
		templates: ProviderTemplate[] | null;
		loadError: string | null;
		canGoBack: boolean;
		onBack: () => void;
		onCustom: () => void;
		/** Resolves with an error message, or null once the provider is written. */
		onCreate: (template: ProviderTemplate, apiKey: string) => Promise<string | null>;
	} = $props();

	const uid = $props.id();
	let chosen = $state<ProviderTemplate | null>(null);
	let apiKey = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const brands = $derived.by(() => {
		const out: { brand: string; templates: ProviderTemplate[] }[] = [];
		for (const template of templates ?? []) {
			let group = out.find((g) => g.brand === template.brand);
			if (!group) {
				group = { brand: template.brand, templates: [] };
				out.push(group);
			}
			group.templates.push(template);
		}
		return out;
	});

	function choose(template: ProviderTemplate) {
		chosen = template;
		apiKey = '';
		error = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!chosen || busy) return;
		const problem = keyProblem(apiKey);
		if (problem) {
			error = problem;
			return;
		}
		busy = true;
		error = await onCreate(chosen, apiKey.trim());
		busy = false;
	}
</script>

<section class="flex flex-col gap-5" aria-labelledby={`${uid}-title`}>
	<header class="flex items-center gap-2">
		{#if chosen || canGoBack}
			<Button
				variant="ghost"
				size="icon-sm"
				class="shrink-0 text-muted-foreground"
				aria-label={chosen ? t('settings.addAProvider') : t('settings.backToProviders')}
				onclick={() => (chosen ? (chosen = null) : onBack())}
				disabled={busy}
			>
				<ArrowLeft />
			</Button>
		{/if}
		<h4 id={`${uid}-title`} class="text-base font-semibold text-foreground">
			{chosen ? chosen.name : t('settings.addAProvider')}
		</h4>
	</header>

	{#if chosen}
		<form class="flex flex-col gap-4" onsubmit={submit}>
			<div class="flex items-center gap-3">
				<ProviderLogo logo={chosen.logo} class="size-9" />
				<div class="flex min-w-0 flex-col">
					<span class="truncate font-mono text-xs text-foreground">{chosen.endpoint}</span>
					<span class="text-xs text-muted-foreground">{protocolLabel(chosen.protocol)}</span>
				</div>
			</div>

			<Field.Field>
				<div class="flex items-center justify-between gap-2">
					<Field.Label for={`${uid}-key`}>{t('settings.apiKey')}</Field.Label>
					<Button variant="link" size="sm" class="h-auto p-0" onclick={() => chosen && void openUrl(chosen.key_url)}>
						{t('settings.createAKey')}
						<ExternalLink data-icon="inline-end" />
					</Button>
				</div>
				<Input
					id={`${uid}-key`}
					type="password"
					autocomplete="off"
					spellcheck={false}
					class="font-mono"
					bind:value={apiKey}
					disabled={busy}
				/>
			</Field.Field>

			{#if error}
				<Alert.Root variant="destructive">
					<TriangleAlert />
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="flex justify-end">
				<Button type="submit" disabled={busy}>
					{#if busy}
						<Spinner data-icon="inline-start" />
					{/if}
					{t('common.add')}
				</Button>
			</div>
		</form>
	{:else}
		{#if loadError}
			<Alert.Root variant="destructive">
				<TriangleAlert aria-hidden="true" />
				<Alert.Description>{loadError}</Alert.Description>
			</Alert.Root>
		{/if}

		{#each brands as group (group.brand)}
			<div class="flex flex-col gap-2">
				<h5 class="text-ui text-muted-foreground">{group.brand}</h5>
				<Item.Group class="grid grid-cols-1 gap-2 perspective-midrange sm:grid-cols-2">
					{#each group.templates as template (template.id)}
						<Item.Root
							variant="outline"
							class="bg-card shadow-xs transition-[box-shadow,translate,rotate] duration-200 ease-out transform-3d hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-x-6"
						>
							{#snippet child({ props })}
								<button {...props} type="button" class={cn(props.class as string | undefined, 'text-left')} onclick={() => choose(template)}>
									<Item.Media>
										<ProviderLogo logo={template.logo} class="size-8" />
									</Item.Media>
									<Item.Content>
										<Item.Title>{template.name}</Item.Title>
									</Item.Content>
									<Item.Actions>
										<ChevronRight class="text-muted-foreground" />
									</Item.Actions>
								</button>
							{/snippet}
						</Item.Root>
					{/each}
				</Item.Group>
			</div>
		{/each}

		<div class="flex flex-col gap-2">
			<h5 class="text-ui text-muted-foreground">{t('settings.otherProviders')}</h5>
			<Item.Group class="grid grid-cols-1 gap-2 perspective-midrange sm:grid-cols-2">
				<Item.Root
							variant="outline"
							class="bg-card shadow-xs transition-[box-shadow,translate,rotate] duration-200 ease-out transform-3d hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-x-6"
						>
					{#snippet child({ props })}
						<button {...props} type="button" class={cn(props.class as string | undefined, 'text-left')} onclick={onCustom}>
							<Item.Media variant="icon" class="size-8 rounded-md bg-muted">
								<Plus />
							</Item.Media>
							<Item.Content>
								<Item.Title>{t('settings.createCustomProvider')}</Item.Title>
							</Item.Content>
							<Item.Actions>
								<ChevronRight class="text-muted-foreground" />
							</Item.Actions>
						</button>
					{/snippet}
				</Item.Root>
			</Item.Group>
		</div>
	{/if}
</section>
