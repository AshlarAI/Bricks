import { t, useLanguage } from '$lib/i18n/i18n'
import type { ApprovalRequest } from '$lib/ipc/engine'

export interface PendingApprovalsProps {
  /** Approvals waiting for a decision in the conversation. */
  approvals: ApprovalRequest[]
}

export function PendingApprovals({ approvals }: PendingApprovalsProps) {
  useLanguage()

  if (approvals.length === 0) return null

  return (
    <section
      aria-labelledby="pending-approvals-title"
      className="rounded-lg border border-warning bg-warning-soft p-3 text-sm text-foreground"
    >
      <h2 id="pending-approvals-title" className="flex items-center gap-2 text-sm font-medium">
        {t('context.pendingApprovals')}
        <span className="font-mono text-xs tabular-nums">{approvals.length}</span>
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {approvals.map((approval) => (
          <li key={approval.approval_id} className="flex min-w-0 flex-col gap-0.5 text-xs">
            <span className="font-mono font-medium break-all">{approval.tool}</span>
            <span className="text-pretty text-muted-foreground">{approval.description}</span>
            {approval.agent_id ? (
              <span className="text-muted-foreground">{t('context.requestedByASubAgent')}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default PendingApprovals
