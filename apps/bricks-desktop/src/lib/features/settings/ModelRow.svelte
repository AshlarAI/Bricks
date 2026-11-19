<script lang="ts">
	// One model of a provider: its API name, its context and Vision badges, then test, edit,
	// delete and the switch that offers it in the model lists. The name expands the details.
	import { localeTag, t } from '$lib/i18n/i18n.svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plug from '@lucide/svelte/icons/plug';
	import Trash from '@lucide/svelte/icons/trash';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Item from '$lib/components/ui/item';
	import { Spinner } from '$lib/components/ui/spinner';
	import { Switch } from '$lib/components/ui/switch';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { ModelView } from '$lib/ipc/bindings/ModelView';
	import { cn } from '$lib/utils';
	import { formatModalities, formatPrice, formatTokens } from './format';
	import { displayName, profileLabel } from './models';
	import { compactCount } from './usage';

	/** Where the last test of the model stands. */
	export type ModelTest = { state: 'running' } | { state: 'passed'; ms: number } | { state: 'failed'; error: string };

	let {
		model,
		test,
		busy = false,
		onTest,
		onEdit,
		onDelete,
		onToggle
	}: {
		model: ModelView;
		test: ModelTest | null;
		busy?: boolean;
		onTest: () => void;
		onEdit: () => void;
		onDelete: () => void;
		onToggle: (enabled: boolean) => void;
	} = $props();

	const uid = $props.id();
	const detailId = `${uid}-detail`;
	const title = $derived(displayName(model.name, model.id));
	const context = $derived(model.max_input_tokens);
	let expanded = $state(false);
</script>

<Item.Root size="sm" class={cn('flex-wrap', !model.enabled && 'opacity-60')}>
	<Item.Content class="min-w-0">
		<Item.Title class="w-full min-w-0">
			<button
				type="button"
				class="min-w-0 truncate rounded-sm text-left font-mono focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				title={title}
				aria-expanded={expanded}
				aria-controls={expanded ? detailId : undefined}
				onclick={() => (expanded = !expanded)}
			>
				{model.api_model}
			</button>
			<Badge variant="outline" title={t('settings.contextTokens', { count: context })}>
				{compactCount(context, localeTag())}
			</Badge>
			{#if model.input_modalities.includes('image')}
				<Badge variant="outline">{t('settings.vision')}</Badge>
			{/if}
		</Item.Title>
	</Item.Content>

	<Item.Actions class="gap-1">
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						class={cn(
							'text-muted-foreground',
							test?.state === 'passed' && 'text-success',
							test?.state === 'failed' && 'text-destructive'
						)}
						aria-label={t('settings.testModel', { title })}
						disabled={test?.state === 'running'}
						onclick={onTest}
					>
						{#if test?.state === 'running'}
							<Spinner />
						{:else if test?.state === 'passed'}
							<CircleCheck />
						{:else if test?.state === 'failed'}
							<CircleX />
						{:else}
							<Plug />
						{/if}
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content class="max-w-sm">
				{#if test?.state === 'passed'}
					{t('settings.testPassed', { ms: test.ms })}
				{:else if test?.state === 'failed'}
					{t('settings.testFailed', { error: test.error })}
				{:else}
					{t('settings.testModel', { title })}
				{/if}
			</Tooltip.Content>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						class="text-muted-foreground"
						aria-label={t('settings.editModel', { id: title })}
						onclick={onEdit}
					>
						<Pencil />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{t('settings.editTheModel')}</Tooltip.Content>
		</Tooltip.Root>

		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						class="text-muted-foreground hover:text-destructive"
						aria-label={t('settings.deleteModel', { title })}
						onclick={onDelete}
					>
						<Trash />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{t('settings.deleteTheModel')}</Tooltip.Content>
		</Tooltip.Root>

		<Switch
			bind:checked={() => model.enabled, onToggle}
			disabled={busy}
			aria-label={t('settings.enableModel', { title })}
		/>
	</Item.Actions>

	{#if expanded}
		<Item.Footer class="basis-full">
			<dl id={detailId} class="grid w-full grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 text-xs">
				<dt class="text-muted-foreground">{t('settings.selection')}</dt>
				<dd class="font-mono break-all text-foreground">{model.selection}</dd>

				<dt class="text-muted-foreground">{t('settings.apiName')}</dt>
				<dd class="font-mono break-all text-foreground">{model.api_model}</dd>

				<dt class="text-muted-foreground">{t('settings.maximumInput')}</dt>
				<dd class="text-foreground tabular-nums">{formatTokens(model.max_input_tokens)}</dd>

				<dt class="text-muted-foreground">{t('settings.maximumOutput')}</dt>
				<dd class="text-foreground tabular-nums">{formatTokens(model.max_output_tokens)}</dd>

				<dt class="text-muted-foreground">{t('settings.acceptedInputs')}</dt>
				<dd class="text-foreground">{formatModalities(model.input_modalities)}</dd>

				<dt class="text-muted-foreground">{t('settings.reasoningLevels')}</dt>
				<dd class="text-foreground">
					{#if model.profiles.length === 0}
						{t('settings.none')}
					{:else}
						{model.profiles.map(profileLabel).join(', ')}
					{/if}
				</dd>

				<dt class="text-muted-foreground">{t('settings.costPerMtok')}</dt>
				<dd class="text-foreground tabular-nums">
					{#if model.pricing}
						{t('settings.inputOutputCache', {
							input: formatPrice(model.pricing.input),
							output: formatPrice(model.pricing.output),
							cacheRead: formatPrice(model.pricing.cache_read)
						})}
					{:else}
						{t('settings.notProvided')}
					{/if}
				</dd>
			</dl>
		</Item.Footer>
	{/if}
</Item.Root>
