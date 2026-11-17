<script lang="ts">
	// A provider's logo: the brand's official square (light or dark with the theme), or a box.
	import Package from '@lucide/svelte/icons/package';
	import { theme } from '$lib/theme/theme.svelte';
	import { cn } from '$lib/utils';
	import opencodeLight from '../../../assets/provider-icons/opencode-light.svg';
	import opencodeDark from '../../../assets/provider-icons/opencode-dark.svg';

	let { logo, class: className }: { logo: string | null | undefined; class?: string } = $props();

	const LOGOS: Record<string, { light: string; dark: string }> = {
		opencode: { light: opencodeLight, dark: opencodeDark }
	};

	const src = $derived.by(() => {
		const asset = logo ? LOGOS[logo] : undefined;
		if (!asset) return null;
		return theme.resolved === 'dark' ? asset.dark : asset.light;
	});
</script>

{#if src}
	<img {src} alt="" aria-hidden="true" class={cn('shrink-0 rounded-[22%] object-contain', className)} />
{:else}
	<Package class={cn('shrink-0 text-muted-foreground', className)} aria-hidden="true" />
{/if}
