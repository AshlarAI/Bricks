// Right panel « Modifications »: what the conversation changed, what the
// project's journal recorded, and the Git state of the project folder.
// Owner: Haiku 7 (changes feature).
import { useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs'
import ConversationChanges from './ConversationChanges'
import HistoryChanges from './HistoryChanges'
import GitChanges from './GitChanges'

export function ChangesPanel() {
  useLanguage()
  const [tab, setTab] = useState('conversation')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <h2 className="px-3 pt-3 pb-2 text-ui font-medium">{t('common.changes')}</h2>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-3 grid grid-cols-3">
          <TabsTrigger value="conversation" className="min-w-0 truncate text-xs">
            {t('common.conversation')}
          </TabsTrigger>
          {/* The visible label is short for the 280 px panel; the full name stays
              accessible and still contains the visible word (WCAG 2.5.3). */}
          <TabsTrigger
            value="historique"
            className="min-w-0 truncate text-xs"
            aria-label={t('changes.projectHistory')}
            title={t('changes.projectHistory')}
          >
            {t('changes.history')}
          </TabsTrigger>
          <TabsTrigger value="git" className="min-w-0 truncate text-xs">
            Git
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conversation" className="min-h-0 flex-1 outline-none">
          <ScrollArea className="h-full">
            <div className="px-3 pt-3 pb-3">
              <ConversationChanges />
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="historique" className="min-h-0 flex-1 outline-none">
          <ScrollArea className="h-full">
            <div className="px-3 pt-3 pb-3">
              <HistoryChanges />
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="git" className="min-h-0 flex-1 outline-none">
          <ScrollArea className="h-full">
            <div className="px-3 pt-3 pb-3">
              <GitChanges />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ChangesPanel
