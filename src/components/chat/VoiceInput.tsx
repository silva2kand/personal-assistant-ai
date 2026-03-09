'use client'

import * as React from 'react'
import { Mic, MicOff, Square, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useApp } from '@/context/AppContext'

interface VoiceInputProps {
  onTranscript: (text: string) => void
  disabled?: boolean
}

export function VoiceInput({ onTranscript, disabled }: VoiceInputProps) {
  const { isRecording, setIsRecording } = useApp()
  const [audioContext, setAudioContext] = React.useState<AudioContext | null>(null)
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null)
  const [isTranscribing, setIsTranscribing] = React.useState(false)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const recognitionRef = React.useRef<SpeechRecognition | null>(null)

  const speechApiAvailable =
    typeof window !== 'undefined' &&
    (('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window))

  const startBrowserSTT = () => {
    try {
      const SpeechRec: typeof SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      const rec: SpeechRecognition = new SpeechRec()
      rec.lang = 'en-GB'
      rec.continuous = false
      rec.interimResults = false
      rec.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript
        if (transcript) onTranscript(transcript)
        setIsRecording(false)
        recognitionRef.current = null
      }
      rec.onerror = () => {
        setIsRecording(false)
        recognitionRef.current = null
      }
      rec.onend = () => {
        setIsRecording(false)
        recognitionRef.current = null
      }
      recognitionRef.current = rec
      rec.start()
      setIsRecording(true)
    } catch (error) {
      console.error('Browser STT error:', error)
      setIsRecording(false)
    }
  }

  const startRecording = async () => {
    try {
      // If browser STT exists, prefer it and skip hitting the backend
      if (speechApiAvailable) {
        startBrowserSTT()
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyserNode = ctx.createAnalyser()
      analyserNode.fftSize = 256
      source.connect(analyserNode)
      setAudioContext(ctx)
      setAnalyser(analyserNode)
      
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
        stream.getTracks().forEach(track => track.stop())
        ctx.close()
        setAudioContext(null)
        setAnalyser(null)
        
        // Send to ASR API
        setIsTranscribing(true)
        try {
          const formData = new FormData()
          formData.append('audio', audioBlob, 'recording.webm')
          
          const response = await fetch('/api/voice/transcribe', {
            method: 'POST',
            body: formData,
          })
          
          const data = await response.json()
          if (data.text) {
            onTranscript(data.text)
          } else if (speechApiAvailable) {
            // If server couldn't transcribe (missing key, etc.), use browser STT as fallback
            startBrowserSTT()
          }
        } catch (error) {
          console.error('Transcription error:', error)
          if (speechApiAvailable) startBrowserSTT()
        } finally {
          setIsTranscribing(false)
        }
      }
      
      mediaRecorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error('Error starting recording:', error)
    }
  }

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      setIsRecording(false)
      recognitionRef.current = null
      return
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled || isTranscribing}
      onClick={toggleRecording}
      className={cn(
        "relative text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800",
        isRecording && "text-red-500 hover:text-red-400 hover:bg-red-500/10"
      )}
    >
      {isTranscribing ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : isRecording ? (
        <Square className="h-5 w-5" />
      ) : (
        <Mic className="h-5 w-5" />
      )}
      {isRecording && analyser && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-2 border-red-500 animate-ping opacity-50" />
        </div>
      )}
    </Button>
  )
}
