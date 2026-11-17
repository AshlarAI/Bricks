<script lang="ts">
	// The left column of « Modèles »: the providers, those of a known brand first, each with its
	// logo and a dot (green: usable; orange: no key or no model). Narrow, only the logos show.
	import { t } from '$lib/i18n/i18n.svelte';
	import Circle from '@lucide/svelte/icons/circle';
	import { cn } from '$lib/utils';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { ProviderView } from '$lib/ipc/bindings/ProviderView';
	import ProviderLogo from './ProviderLogo.svelte';
	import { displayName, providerGroups, providerReady, providerStatusLabel } from './models';

	let {
		providers,
		selected,
		onSelect
	}: {
		providers: ProviderView[];
		selected: string | null;
		onSelect: (id: string) => void;
	} = $props();

	const groups = $derived(providerGroups(providers));
</script>

<nav class="flex flex-col gap-3 px-1.5 py-2 md:px-2" aria-label={t('settings.providers')}>
	{#each groups as group (group.id)}
		<div class="flex flex-col gap-1 max-md:items-center">
			<h4 class="flex h-7 items-center px-2 text-xs font-semibold text-muted-foreground max-md:sr-only">
				{group.id === 'custom' ? t('settings.customProviders') : group.title}
			</h4>
			{#each group.providers as provider (provider.id)}
				{@const title = displayName(provider.name, provider.id)}
				{@const ready = providerReady(provider)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								aria-current={selected === provider.id ? 'true' : undefined}
								class={cn(
									'relative flex h-8 w-full items-center gap-2 rounded-lg border px-2 text-left text-ui font-medium text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:size-8 max-md:justify-center max-md:px-0',
									selected === provider.id
										? 'border-border-strong bg-element-selected'
										: 'border-transparent hover:border-border hover:bg-element-hover'
								)}
								onclick={() => onSelect(provider.id)}
							>
								<ProviderLogo logo={provider.logo} class="size-4" />
								<span class="min-w-0 flex-1 truncate max-md:sr-only">{title}</span>
								<Circle
									class={cn(
										'size-2 shrink-0 fill-current max-md:absolute max-md:right-0.5 max-md:bottom-0.5',
										ready ? 'text-success' : 'text-warning'
									)}
									aria-label={providerStatusLabel(provider)}
								/>
							</button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right" class="md:hidden">{title}</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		</div>
	{/each}
</nav>
