import { NextRequest, NextResponse } from 'next/server'
import { toSpeechSafeText } from '@/lib/speech-safe'

// Helper to split long text into chunks
function splitTextIntoChunks(text: string, maxLength = 1000): string[] {
  const chunks: string[] = []
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]

  let currentChunk = ''
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence
    } else {
      if (currentChunk) chunks.push(currentChunk.trim())
      currentChunk = sentence
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim())

  return chunks
}

function isPlaceholderApiKey(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return true
  return (
    normalized.includes('your_key_here') ||
    normalized.includes('your_key*here') ||
    normalized.includes('replace_me') ||
    normalized.includes('changeme')
  )
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    const text = typeof payload?.text === 'string' ? payload.text : ''
    const requestedVoice = typeof payload?.voice === 'string' ? payload.voice : 'alloy'
    const requestedSpeed = typeof payload?.speed === 'number' ? payload.speed : 1.0

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 })
    }

    const allowedVoices = new Set([
      'alloy',
      'ash',
      'ballad',
      'coral',
      'echo',
      'sage',
      'shimmer',
      'verse',
      // Backward-compatible voices.
      'fable',
      'onyx',
      'nova',
    ])
    const voice = allowedVoices.has(requestedVoice) ? requestedVoice : 'alloy'
    const speed = Math.min(1.25, Math.max(0.75, requestedSpeed))

    // Limit text length for single request
    const trimmedText = toSpeechSafeText(text, 1024)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey || isPlaceholderApiKey(apiKey)) {
      return NextResponse.json(
        {
          error:
            'Voice API is not configured. Set a valid OPENAI_API_KEY to enable server TTS. Browser voice fallback is still available.',
        },
        { status: 503 }
      )
    }

    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const model = process.env.OPENAI_TTS_MODEL || 'tts-1'

    const ttsResponse = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: trimmedText,
        voice,
        speed,
        response_format: 'mp3',
      }),
    })

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text()
      const normalized = errorText.toLowerCase()
      const message = normalized.includes('invalid_api_key')
        ? 'OPENAI_API_KEY is invalid. Update your key to enable server TTS.'
        : normalized.includes('insufficient_quota')
          ? 'OpenAI TTS quota exceeded. Check billing/quota or use browser voice fallback.'
          : `TTS request failed (${ttsResponse.status}).`

      return NextResponse.json(
        {
          error: message,
          providerStatus: ttsResponse.status,
          providerError: errorText,
        },
        { status: 502 }
      )
    }

    const arrayBuffer = await ttsResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Return audio as response
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    if (error instanceof Error) {
      console.error('TTS API Error:', error.message)
    } else {
      console.error('TTS API Error')
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate speech' },
      { status: 500 }
    )
  }
}
