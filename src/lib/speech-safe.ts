function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function removeMarkdownTables(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    if (line.includes('|') && /^[\s|:\-]+$/.test(line.replace(/[A-Za-z0-9]/g, ''))) {
      continue
    }
    if (line.includes('|') && line.split('|').length > 3) {
      const pieces = line
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean)
      if (pieces.length > 0) out.push(pieces.join('. '))
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

export function toSpeechSafeText(input: string, maxLength = 1024): string {
  let text = input || ''
  text = removeMarkdownTables(text)
  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[|]/g, '. ')
    .replace(/---+/g, ' ')
    .replace(/[_~]/g, ' ')
    .replace(/\s*\n\s*/g, '. ')
  text = collapseWhitespace(text)
  if (text.length > maxLength) text = text.slice(0, maxLength)
  return text
}
