<script lang="ts">
	// The right column of « Modèles »: one provider, edited in place. Its URL, API format and key
	// are saved when they change (a field leaves or Enter), then come its models: test, edit,
	// delete and the switch that offers each one in the model lists.
	import { t } from '$lib/i18n/i18n.svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import LockKeyhole from '@lucide/svelte/icons/lock-keyhole';
	import LockKeyholeOpen from '@lucide/svelte/icons/lock-keyhole-open';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash from '@lucide/svelte/icons/trash';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as InputGroup from '$lib/components/ui/input-group';
	import * as Item from '$lib/components/ui/item';
	import * as Select from '$lib/components/ui/select';
	import { Toggle } from '$lib/components/ui/toggle';
	import { modelTest, errorMessage } from '$lib/ipc/client';
	import type { ModelView } from '$lib/ipc/bindings/ModelView';
	import type { ProviderPatch } from '$lib/ipc/bindings/ProviderPatch';
	import type { ProviderView } from '$lib/ipc/bindings/ProviderView';
	import { cn } from '$lib/utils';
	import ModelRow, { type ModelTest } from './ModelRow.svelte';
	import ProviderLogo from './ProviderLogo.svelte';
	import { resolveChatError } from '../conversation/chat-error';
	import {
		KEY_URLS,
		PROTOCOL_OPTIONS,
		keyProblem,
		displayName,
		modelCountLabel,
		protocolLabel,
		providerFieldPatch,
		type WriteOutcome
	} from './models';

	let {
		provider,
		onSave,
		onToggleModel,
		onEditProvider,
		onDeleteProvider,
		onEditModel,
		onDeleteModel,
		onAddModel
	}: {
		provider: ProviderView;
		onSave: (patch: ProviderPatch) => Promise<WriteOutcome>;
		onToggleModel: (model: ModelView, enabled: boolean) => Promise<WriteOutcome>;
		onEditProvider: () => void;
		onDeleteProvider: () => void;
		onEditModel: (model: ModelView) => void;
		onDeleteModel: (model: ModelView) => void;
		onAddModel: () => void;
	} = $props();

	const uid = $props.id();
	const title = $derived(displayName(provider.name, provider.id));
	const keyUrl = $derived(provider.logo ? KEY_URLS[provider.logo] : undefined);

	// The fields start from the file and follow it (another window, a conflict reload); what is
	// typed stays until it is saved or the field leaves.
	const savedEndpoint = $derived(provider.endpoint);
	const savedKey = $derived(provider.api_key ?? '');
	let endpoint = $derived(savedEndpoint);
	let apiKey = $derived(savedKey);
	let revealed = $state(false);
	let saving = $state<'endpoint' | 'protocol' | 'key' | null>(null);
	let fieldError = $state<{ field: 'endpoint' | 'protocol' | 'key'; message: string } | null>(null);
	let toggling = $state<string | null>(null);
	let toggleError = $state<string | null>(null);
	let tests = $state<Record<string, ModelTest>>({});

	async function save(field: 'endpoint' | 'protocol' | 'key', patch: ProviderPatch) {
		if (saving) return;
		saving = field;
		const outcome = await onSave(patch);
		saving = null;
		fieldError = outcome.ok ? null : { field, message: outcome.message };
	}

	function saveEndpoint() {
		const value = endpoint.trim();
		if (value === '' || value === provider.endpoint) {
			endpoint = provider.endpoint;
			return;
		}
		void save('endpoint', providerFieldPatch({ endpoint: value }));
	}

	function saveKey() {
		const value = apiKey.trim();
		if (value === savedKey) return;
		// A provider that needs a key keeps one: clearing the field restores it.
		if (value === '') {
			apiKey = savedKey;
			return;
		}
		const problem = keyProblem(value);
		if (problem) {
			fieldError = { field: 'key', message: problem };
			return;
		}
		void save('key', providerFieldPatch({ api_key: value }));
	}

	function onEnter(event: KeyboardEvent, commit: () => void) {
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			commit();
		}
	}

	async function toggle(model: ModelView, enabled: boolean) {
		toggling = model.id;
		const outcome = await onToggleModel(model, enabled);
		toggling = null;
		toggleError = outcome.ok ? null : outcome.message;
	}

	async function test(model: ModelView) {
		tests[model.id] = { state: 'running' };
		try {
			const ms = await modelTest(provider.id, model.id);
			tests[model.id] = { state: 'passed', ms };
		} catch (e) {
			tests[model.id] = { state: 'failed', error: resolveChatError(errorMessage(e)).message };
		}
	}
</script>

<section class="flex flex-col gap-5" aria-labelledby={`${uid}-name`}>
	<header class="flex items-center gap-2.5">
		<ProviderLogo logo={provider.logo} class="size-6" />
		<h4 id={`${uid}-name`} class="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h4>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						class="text-muted-foreground"
						aria-label={t('settings.moreProviderActions', { title })}
					>
						<Ellipsis />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Group>
					<DropdownMenu.Item onSelect={onEditProvider}>
						<Pencil />
						{t('common.edit')}
					</DropdownMenu.Item>
					<DropdownMenu.Item variant="destructive" onSelect={onDeleteProvider}>
						<Trash />
						{t('common.delete')}
					</DropdownMenu.Item>
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<Field.Group>
		<Field.Field data-invalid={fieldError?.field === 'endpoint' ? 'true' : undefined}>
			<Field.Label for={`${uid}-endpoint`}>{t('settings.apiUrl')}</Field.Label>
			<Input
				id={`${uid}-endpoint`}
				class="font-mono"
				spellcheck={false}
				autocomplete="off"
				bind:value={endpoint}
				disabled={saving === 'endpoint'}
				aria-invalid={fieldError?.field === 'endpoint' ? 'true' : undefined}
				onblur={saveEndpoint}
				onkeydown={(e) => onEnter(e, saveEndpoint)}
			/>
			{#if fieldError?.field === 'endpoint'}
				<Field.Error>{fieldError.message}</Field.Error>
			{/if}
		</Field.Field>

		<Field.Field data-invalid={fieldError?.field === 'protocol' ? 'true' : undefined}>
			<Field.Label for={`${uid}-protocol`}>{t('settings.protocol')}</Field.Label>
			<Select.Root
				type="single"
				bind:value={
					() => provider.protocol,
					(value) => {
						if (value && value !== provider.protocol) void save('protocol', providerFieldPatch({ protocol: value }));
					}
				}
				disabled={saving === 'protocol'}
			>
				<Select.Trigger id={`${uid}-protocol`} class="w-full">{protocolLabel(provider.protocol)}</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each PROTOCOL_OPTIONS as option (option.value)}
							<Select.Item value={option.value}>{option.label}</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
			{#if fieldError?.field === 'protocol'}
				<Field.Error>{fieldError.message}</Field.Error>
			{/if}
		</Field.Field>

		{#if provider.auth !== 'none'}
			<Field.Field data-invalid={fieldError?.field === 'key' ? 'true' : undefined}>
				<div class="flex items-center justify-between gap-2">
					<Field.Label for={`${uid}-key`}>{t('settings.apiKey')}</Field.Label>
					{#if keyUrl}
						<Button variant="link" size="sm" class="h-auto p-0" onclick={() => void openUrl(keyUrl)}>
							{t('settings.createAKey')}
							<ExternalLink data-icon="inline-end" />
						</Button>
					{/if}
				</div>
				<InputGroup.Root>
					<InputGroup.Input
						id={`${uid}-key`}
						type={revealed ? 'text' : 'password'}
						class={cn('font-mono', !revealed && 'text-muted-foreground')}
						spellcheck={false}
						autocomplete="off"
						bind:value={apiKey}
						disabled={saving === 'key'}
						aria-invalid={fieldError?.field === 'key' ? 'true' : undefined}
						onblur={saveKey}
						onkeydown={(e) => onEnter(e, saveKey)}
					/>
					<InputGroup.Addon align="inline-end">
						<Toggle size="icon-sm" aria-label={revealed ? t('settings.hideKey') : t('settings.showKey')} bind:pressed={revealed}>
							{#if revealed}
								<LockKeyholeOpen />
							{:else}
								<LockKeyhole />
							{/if}
						</Toggle>
					</InputGroup.Addon>
				</InputGroup.Root>
				{#if fieldError?.field === 'key'}
					<Field.Error>{fieldError.message}</Field.Error>
				{/if}
			</Field.Field>
		{/if}
	</Field.Group>

	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-baseline gap-2">
				<h5 class="text-ui text-muted-foreground">{t('settings.models')}</h5>
				<span class="text-xs text-muted-foreground tabular-nums">{modelCountLabel(provider.models.length)}</span>
			</div>
			<Button variant="outline" size="sm" aria-label={t('settings.addAModelTo', { title })} onclick={onAddModel}>
				<Plus data-icon="inline-start" />
				{t('settings.addAModel')}
			</Button>
		</div>

		{#if toggleError}
			<p role="alert" class="text-ui text-destructive">{toggleError}</p>
		{/if}

		{#if provider.models.length > 0}
			<Item.Group class="gap-0 rounded-lg border border-border has-data-[size=sm]:gap-0" aria-label={t('settings.modelsOf', { title })}>
				{#each provider.models as model, index (model.id)}
					{#if index > 0}
						<Item.Separator class="my-0" />
					{/if}
					<ModelRow
						{model}
						test={tests[model.id] ?? null}
						busy={toggling === model.id}
						onTest={() => void test(model)}
						onEdit={() => onEditModel(model)}
						onDelete={() => onDeleteModel(model)}
						onToggle={(enabled) => void toggle(model, enabled)}
					/>
				{/each}
			</Item.Group>
		{/if}
	</div>
</section>
