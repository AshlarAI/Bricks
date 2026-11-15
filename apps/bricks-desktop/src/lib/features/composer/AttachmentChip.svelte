<script lang="ts">
  // An attachment of the draft: its thumbnail or file icon, its name, its state (copying, refused)
  // and a button to remove it.
  import { t } from '$lib/i18n/i18n.svelte'
  import type { DraftAttachment } from '$lib/state/conversation.svelte'
  import * as Attachment from '$lib/components/ui/attachment'
  import { Spinner } from '$lib/components/ui/spinner'
  import FileIcon from '$lib/features/file-icons/FileIcon.svelte'
  import XIcon from '@lucide/svelte/icons/x'
  import { attachmentKind } from '$lib/features/conversation/format'

  let {
    attachment,
    error,
    onRemove,
  }: {
    attachment: DraftAttachment
    /** Error to show on the chip: a backend refusal or a modality refusal. */
    error: string | null
    onRemove: () => void
  } = $props()

  const state = $derived(error !== null ? 'error' : attachment.importing ? 'uploading' : 'done')
  const description = $derived(
    error ?? (attachment.importing ? t('composer.copying') : attachmentKind(attachment.kind, attachment.name)),
  )
</script>

<Attachment.Root
  {state}
  size="sm"
  class="max-w-64 min-w-0"
  aria-busy={attachment.importing ? 'true' : undefined}
  data-kind={attachment.kind}
  title={attachment.path || attachment.name}
>
  {#if attachment.previewUrl}
    <Attachment.Media variant="image">
      <img src={attachment.previewUrl} alt="" />
    </Attachment.Media>
  {:else}
    <Attachment.Media>
      {#if attachment.importing}
        <Spinner />
      {:else}
        <FileIcon path={attachment.path || attachment.name} kind={attachment.kind === 'folder' ? 'folder' : 'file'} />
      {/if}
    </Attachment.Media>
  {/if}
  <Attachment.Content>
    <Attachment.Title>{attachment.name}</Attachment.Title>
    <Attachment.Description role={error ? 'alert' : undefined}>{description}</Attachment.Description>
  </Attachment.Content>
  <Attachment.Actions>
    <Attachment.Action aria-label={t('composer.remove', { name: attachment.name })} onclick={onRemove}>
      <XIcon aria-hidden="true" />
    </Attachment.Action>
  </Attachment.Actions>
</Attachment.Root>
