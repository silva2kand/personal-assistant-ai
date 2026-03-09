import type { BrainBriefingItem } from '@/lib/core-brain'

const NOISE_RE =
  /\b(newsletter|promo|promotion|sale|discount|bonanza|new arrivals|one day only|subscribe|webinar|show in|event)\b/i

function priorityRank(value: BrainBriefingItem['priority']): number {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

export function liamFilterAndRank(items: BrainBriefingItem[], maxItems = 5): BrainBriefingItem[] {
  const filtered = items.filter((item) => {
    const text = `${item.title} ${item.detail}`.toLowerCase()
    if (NOISE_RE.test(text) && item.priority !== 'high') return false
    return true
  })

  return filtered
    .sort((a, b) => {
      const p = priorityRank(b.priority) - priorityRank(a.priority)
      if (p !== 0) return p
      const ad = a.sourceDate ? new Date(a.sourceDate).getTime() : 0
      const bd = b.sourceDate ? new Date(b.sourceDate).getTime() : 0
      return bd - ad
    })
    .slice(0, Math.max(1, Math.min(maxItems, 10)))
}
