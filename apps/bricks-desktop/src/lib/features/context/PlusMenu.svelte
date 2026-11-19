<script lang="ts">
	import { Switch } from '$lib/components/ui/switch';
	// « Plus »: the ADK inspectors of the shown conversation, from the top bar.
	import { t } from '$lib/i18n/i18n.svelte';
	import { app } from '$lib/state/app.svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import { ADK_ACCESS_GROUPS } from './adkAccess';

	// The menu opens inspectors that read the shown conversation: none without one.
	const enabled = $derived(app.current !== null);
	const keepAwake = $derived(app.current?.keepAwake ?? false);

	function setKeepAwake(on: boolean) {
		if (app.current) app.current.keepAwake = on;
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class={[buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-muted-foreground']}
		disabled={!enabled}
		aria-label={t('context.more')}
		title={t('context.more')}
	>
		<EllipsisVerticalIcon aria-hidden="true" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="min-w-64">
		{#each ADK_ACCESS_GROUPS as group, i (group.label)}
			{#if i > 0}
				<DropdownMenu.Separator />
			{/if}
			<DropdownMenu.Group>
				<DropdownMenu.Label>{group.label}</DropdownMenu.Label>
				{#each group.items as item (item.view)}
					<DropdownMenu.Item onSelect={() => ui.open(item.view)}>
						{item.label}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Group>
		{/each}
		<DropdownMenu.Separator />
		<DropdownMenuPrimitive.CheckboxItem
			checked={keepAwake}
			onCheckedChange={setKeepAwake}
			closeOnSelect={false}
			class="flex cursor-default items-center gap-3 rounded-sm px-2 py-1.5 outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
		>
			<span class="flex min-w-0 flex-1 flex-col">
				<span class="text-sm">{t('common.keepTheComputerAwake')}</span>
				<span class="text-xs text-muted-foreground">{t('context.onlyForThisSession')}</span>
			</span>
			<!-- The settings' Switch, as the item's picture: the item itself is the control. -->
			<Switch checked={keepAwake} tabindex={-1} aria-hidden="true" class="pointer-events-none" />
		</DropdownMenuPrimitive.CheckboxItem>
	</DropdownMenu.Content>
</DropdownMenu.Root>
