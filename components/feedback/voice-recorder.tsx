"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mic, Pause, Play, Square, Trash2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Voice-note recorder for feedback reports.
 *
 * Records audio with MediaRecorder (browser picks the container — webm/opus on
 * Chrome/Firefox, mp4 on Safari) and exposes playback + duration. The actual
 * speech-to-text happens through the browser SpeechRecognition dictation in
 * the report form; this recorder captures the audio attachment admins can
 * review. Degrades gracefully where MediaRecorder is unavailable.
 */
export interface RecordedAudio {
  blob: Blob
  mimeType: string
  durationSeconds: number
  url: string
}

export function useVoiceRecorder(maxSeconds: number) {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audio, setAudio] = useState<RecordedAudio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const pausedAccumRef = useRef(0)
  const pauseStartedRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const supported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    analyserRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setLevel(0)
  }, [])

  const startMeter = useCallback(async (stream: MediaStream) => {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i]
        setLevel(Math.sqrt(sum / buf.length) / 255)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      /* meter is cosmetic */
    }
  }, [])

  const start = useCallback(async () => {
    if (!supported) {
      setError("Audio recording isn't supported in this browser. You can still type your report.")
      return
    }
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current - pausedAccumRef.current) / 1000))
        if (blob.size > 0) {
          setAudio({ blob, mimeType: blob.type, durationSeconds, url: URL.createObjectURL(blob) })
        }
        cleanup()
        setRecording(false)
        setPaused(false)
        setElapsed(0)
      }
      recorderRef.current = recorder
      recorder.start(250)
      startedAtRef.current = Date.now()
      pausedAccumRef.current = 0
      setElapsed(0)
      setRecording(true)
      setPaused(false)
      void startMeter(stream)
    } catch {
      setError("Microphone access was denied. You can still type your report.")
      cleanup()
    }
  }, [cleanup, startMeter, supported])

  // Elapsed ticker + auto-stop at the cap.
  useEffect(() => {
    if (!recording || paused) return
    const t = window.setInterval(() => {
      const activeMs = Date.now() - startedAtRef.current - pausedAccumRef.current
      setElapsed(Math.floor(activeMs / 1000))
      if (activeMs >= maxSeconds * 1000) stop()
    }, 500)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, paused, maxSeconds])

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause()
      pauseStartedRef.current = Date.now()
      setPaused(true)
    }
  }, [])

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      pausedAccumRef.current += Date.now() - pauseStartedRef.current
      recorderRef.current.resume()
      setPaused(false)
    }
  }, [])

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop()
    } else {
      cleanup()
      setRecording(false)
      setPaused(false)
    }
  }, [cleanup])

  const cancel = useCallback(() => {
    if (audio?.url) URL.revokeObjectURL(audio.url)
    setAudio(null)
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.onstop = null; recorderRef.current.stop() } catch { /* noop */ }
    }
    cleanup()
    setRecording(false)
    setPaused(false)
    setElapsed(0)
    setError(null)
  }, [audio, cleanup])

  const discard = useCallback(() => {
    if (audio?.url) URL.revokeObjectURL(audio.url)
    setAudio(null)
  }, [audio])

  useEffect(() => cleanup, [cleanup])

  return { supported, recording, paused, elapsed, audio, error, level, start, pause, resume, stop, cancel, discard }
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

export function VoiceRecorderPanel({
  recorder,
  maxSeconds,
}: {
  recorder: ReturnType<typeof useVoiceRecorder>
  maxSeconds: number
}) {
  const { recording, paused, elapsed, audio, error, level, start, pause, resume, stop, cancel, discard } = recorder

  if (!recorder.supported) return null

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-3">
        {!recording && !audio ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void start()} className="gap-1.5">
            <Mic className="size-3.5" /> Record a voice note
          </Button>
        ) : null}

        {recording ? (
          <>
            <Button
              type="button"
              variant={paused ? "default" : "outline"}
              size="icon-sm"
              onClick={paused ? resume : pause}
              aria-label={paused ? "Resume recording" : "Pause recording"}
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={stop} aria-label="Stop recording">
              <Square className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={cancel} aria-label="Cancel recording">
              <Trash2 className="size-3.5" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className={cn("size-2 rounded-full", paused ? "bg-amber-500" : "animate-pulse bg-red-500")} />
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatTime(elapsed)} / {formatTime(maxSeconds)}
              </span>
              <div className="flex h-6 flex-1 items-end gap-0.5 overflow-hidden" aria-hidden>
                {Array.from({ length: 24 }).map((_, i) => {
                  const h = recording ? 15 + Math.min(85, level * 300 + Math.sin(i * 1.7 + elapsed) * 10 + 20) : 15
                  return <span key={i} className="w-1 flex-1 rounded-sm bg-primary/60" style={{ height: `${h}%` }} />
                })}
              </div>
            </div>
          </>
        ) : null}

        {audio && !recording ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <audio controls src={audio.url} className="h-8 min-w-0 flex-1" />
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatTime(audio.durationSeconds)}</span>
            <Button type="button" variant="ghost" size="icon-sm" onClick={discard} aria-label="Remove recording">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {audio ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Voice note attached — admins can listen when reviewing. For the written report, use “Dictate” to speak your description.
        </p>
      ) : null}
      {recording ? <Loader2 className="hidden" /> : null}
    </div>
  )
}
