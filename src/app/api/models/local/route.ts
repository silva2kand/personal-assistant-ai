import { NextResponse } from 'next/server'

export async function GET() {
  const results = {
    ollama: false,
    lmstudio: false,
  }

  // Check Ollama (default port 11434)
  try {
    const ollamaResponse = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    results.ollama = ollamaResponse.ok
  } catch (error) {
    results.ollama = false
  }

  // Check LM Studio (default port 1234)
  try {
    const lmstudioResponse = await fetch('http://localhost:1234/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    results.lmstudio = lmstudioResponse.ok
  } catch (error) {
    results.lmstudio = false
  }

  return NextResponse.json(results)
}
