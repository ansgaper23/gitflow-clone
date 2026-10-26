import { useCallback, useRef, useState } from 'react'

// Dictado por voz nativo del navegador (Web Speech API) — sin backend, sin costo, funciona en
// Chrome/Edge. Safari/Firefox no la soportan bien todavía, por eso "supported" existe: el
// botón que lo use debe ocultarse o deshabilitarse si esto da false, en vez de fallar silencioso.
export function useVoiceInput(onResult) {
  const [listening, setListening] = useState(false)
  const [supported] = useState(
    () => typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
  )
  const recognitionRef = useRef(null)

  const start = useCallback(() => {
    if (!supported || listening) return
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'es-ES'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (e) => {
      const transcript = e.results[e.results.length - 1][0].transcript.trim()
      if (transcript) onResult(transcript)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [supported, listening, onResult])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop])

  return { supported, listening, start, stop, toggle }
}
