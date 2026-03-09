import { buildWhatsNewBriefing, type BrainBriefingItem } from '@/lib/core-brain'
import { liamFilterAndRank } from '@/lib/liam-engine'

export type SwayPulse = {
  generatedAt: string
  headline: string
  items: BrainBriefingItem[]
  nextActions: string[]
}

export async function buildSwayPulse(maxItems = 5): Promise<SwayPulse> {
  const briefing = await buildWhatsNewBriefing(Math.max(maxItems, 7))
  const items = liamFilterAndRank(briefing.items, maxItems)
  const nextActions = items.slice(0, 3).map((item) => item.nextAction)

  return {
    generatedAt: new Date().toISOString(),
    headline: 'Here is what matters now.',
    items,
    nextActions,
  }
}
