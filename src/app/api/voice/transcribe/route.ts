import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const audioFile = formData.get('audio') as File

    if (!audioFile) {
      return NextResponse.json({ text: '', warning: 'No audio file received' })
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ text: '', warning: 'OPENAI_API_KEY not set; skipping server STT' })
    }

    const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1'

    const buffer = Buffer.from(await audioFile.arrayBuffer())
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: audioFile.type || 'audio/webm' }), audioFile.name || 'audio.webm')
    form.append('model', model)
    form.append('response_format', 'json')

    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Transcription failed: ${res.status} ${text}`)
    }

    const data = await res.json()
    return NextResponse.json({ text: data.text })
  } catch (error) {
    console.error('Transcription API Error:', error)
    return NextResponse.json({ text: '', warning: error instanceof Error ? error.message : 'Failed to transcribe audio' })
  }
}
