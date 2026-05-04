import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Web Speech API recognizer wrapper. Exposes a stable API regardless of which
 * vendor prefix the browser uses, and surfaces both the live interim
 * transcript and the accumulated final transcript so the caller can render
 * an editable bubble before submitting.
 *
 * Returns:
 *   - supported   : boolean — is SpeechRecognition available on window?
 *   - isRecording : boolean
 *   - interim     : string  — currently-being-spoken phrase (live, not yet final)
 *   - final       : string  — accumulated final transcript since last reset
 *   - error       : string|null
 *   - start()
 *   - stop()
 *   - reset()     — clear interim+final without changing the recording state
 *   - setFinal(s) — let the parent edit the editable buffer
 */
export function useSpeechRecognition({ lang = 'en-US' } = {}) {
  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const [isRecording, setIsRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const wantsRunRef = useRef(false);

  const start = useCallback(() => {
    if (!supported) {
      setError("Your browser doesn't support speech recognition. Try Chrome or Edge.");
      return;
    }
    if (recognitionRef.current) return;

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (event) => {
      let nextInterim = '';
      let appendedFinal = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          appendedFinal += result[0].transcript;
        } else {
          nextInterim += result[0].transcript;
        }
      }
      setInterim(nextInterim);
      if (appendedFinal) {
        setFinalText((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${appendedFinal.trim()}`);
      }
    };

    rec.onerror = (event) => {
      // 'no-speech' fires every few seconds of silence — not useful to surface.
      if (event.error && event.error !== 'no-speech') {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    rec.onend = () => {
      // Auto-restart while the caller still wants to record (Safari + Chrome
      // both terminate the recognizer after ~30s of speech otherwise).
      if (wantsRunRef.current) {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      } else {
        setIsRecording(false);
      }
    };

    recognitionRef.current = rec;
    wantsRunRef.current = true;
    setError(null);
    setInterim('');
    try {
      rec.start();
      setIsRecording(true);
    } catch (e) {
      // Calling start() on an already-started recognizer throws InvalidStateError.
      setError(e?.message || 'Could not start recognizer');
      recognitionRef.current = null;
      wantsRunRef.current = false;
    }
  }, [lang, supported]);

  const stop = useCallback(() => {
    wantsRunRef.current = false;
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.onend = null;
        rec.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setInterim('');
  }, []);

  const reset = useCallback(() => {
    setFinalText('');
    setInterim('');
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      wantsRunRef.current = false;
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.onend = null;
          rec.stop();
        } catch {
          /* ignore */
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    supported,
    isRecording,
    interim,
    final: finalText,
    setFinal: setFinalText,
    error,
    start,
    stop,
    reset,
  };
}
