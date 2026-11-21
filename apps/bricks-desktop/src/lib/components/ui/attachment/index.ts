import { AttachmentAction } from "./attachment-action"
import { AttachmentActions } from "./attachment-actions"
import { AttachmentContent } from "./attachment-content"
import { AttachmentDescription } from "./attachment-description"
import { AttachmentGroup } from "./attachment-group"
import {
  AttachmentMedia,
  attachmentMediaVariants,
  type AttachmentMediaVariant,
} from "./attachment-media"
import { AttachmentTitle } from "./attachment-title"
import { AttachmentTrigger } from "./attachment-trigger"
import {
  Attachment,
  attachmentVariants,
  type AttachmentOrientation,
  type AttachmentSize,
  type AttachmentState,
} from "./attachment"

export {
  Attachment as Root,
  AttachmentGroup as Group,
  AttachmentMedia as Media,
  AttachmentContent as Content,
  AttachmentTitle as Title,
  AttachmentDescription as Description,
  AttachmentActions as Actions,
  AttachmentAction as Action,
  AttachmentTrigger as Trigger,
  attachmentVariants,
  attachmentMediaVariants,
  type AttachmentSize,
  type AttachmentOrientation,
  type AttachmentState,
  type AttachmentMediaVariant,
  //
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
}
