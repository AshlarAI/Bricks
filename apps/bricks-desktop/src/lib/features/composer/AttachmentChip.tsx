// An attachment of the draft: its thumbnail or file icon, its name, its state (copying, refused)
// and a button to remove it.
import { t, useLanguage } from '$lib/i18n/i18n'
import type { DraftAttachment } from '$lib/state/conversation'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '$lib/components/ui/attachment'
import { Spinner } from '$lib/components/ui/spinner'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { XIcon } from 'lucide-react'
import { attachmentKind } from '$lib/features/conversation/format'

export interface AttachmentChipProps {
  attachment: DraftAttachment
  /** Error to show on the chip: a backend refusal or a modality refusal. */
  error: string | null
  onRemove: () => void
}

export function AttachmentChip({ attachment, error, onRemove }: AttachmentChipProps) {
  useLanguage()

  const state = error !== null ? 'error' : attachment.importing ? 'uploading' : 'done'
  const description =
    error ?? (attachment.importing ? t('composer.copying') : attachmentKind(attachment.kind, attachment.name))

  return (
    <Attachment
      state={state}
      size="sm"
      className="max-w-64 min-w-0"
      aria-busy={attachment.importing ? 'true' : undefined}
      data-kind={attachment.kind}
      title={attachment.path || attachment.name}
    >
      {attachment.previewUrl ? (
        <AttachmentMedia variant="image">
          <img src={attachment.previewUrl} alt="" />
        </AttachmentMedia>
      ) : (
        <AttachmentMedia>
          {attachment.importing ? (
            <Spinner />
          ) : (
            <FileIcon
              path={attachment.path || attachment.name}
              kind={attachment.kind === 'folder' ? 'folder' : 'file'}
            />
          )}
        </AttachmentMedia>
      )}
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription role={error ? 'alert' : undefined}>{description}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={t('composer.remove', { name: attachment.name })} onClick={onRemove}>
          <XIcon aria-hidden="true" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}

export default AttachmentChip
