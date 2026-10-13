const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function middleEllipsis(text: string, max: number, tail = 3): string {
  const chars = [...graphemes.segment(text)].map((s) => s.segment)
  if (chars.length <= max) return text
  const keepTail = Math.min(tail, Math.max(0, max - 2))
  const head = Math.max(1, max - keepTail - 1)
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - keepTail).join('')}`
}
