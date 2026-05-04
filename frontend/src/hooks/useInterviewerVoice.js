import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sentence-buffered TTS for the streaming interviewer reply.
 *
 * Background: speechSynthesis can't smoothly stream tokens — each call to
 * `speak()` interrupts whatever is currently playing. To get natural
 * voice-call pacing, we accumulate streaming tokens, slice on sentence
 * boundaries (`[.!?]\s+`), and queue each slice as its own utterance. The
 * first sentence usually starts speaking within ~1s of the first token rather
 * than after the full message is assembled.
 *
 * Returns:
 *   - supported : boolean — `speechSynthesis` available
 *   - voices    : SpeechSynthesisVoice[] (filtered to en-* + a few accepted accents)
 *   - voiceName : currently-selected voice name
 *   - setVoiceName(name)
 *   - isSpeaking : boolean
 *   - feedTokens(delta) — accumulate tokens; emits sentences as they complete
 *   - flushPending() — speak whatever is left in the buffer (call on stream end)
 *   - cancel() — stop everything immediately and clear queue
 */
export function useInterviewerVoice({ enabled }) {
  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);

  const bufferRef = useRef('');
  const queueRef = useRef([]);
  const speakingRef = useRef(false);

  // Discover and pick a voice. Browsers populate getVoices() asynchronously
  // on a `voiceschanged` event.
  useEffect(() => {
    if (!supported) return undefined;
    const refresh = () => {
      const all = window.speechSynthesis.getVoices() || [];
      const enVoices = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
      setVoices(enVoices);
      setVoiceName((prev) => {
        if (prev && enVoices.some((v) => v.name === prev)) return prev;
        // Prefer Aria / Samantha / Google US English when present.
        const preferred =
          enVoices.find((v) => /aria/i.test(v.name)) ||
          enVoices.find((v) => /samantha/i.test(v.name)) ||
          enVoices.find((v) => /google.*us english/i.test(v.name)) ||
          enVoices.find((v) => v.lang === 'en-US') ||
          enVoices[0];
        return preferred?.name || '';
      });
    };
    refresh();
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', refresh);
    };
  }, [supported]);

  const pump = useCallback(() => {
    if (!supported) return;
    if (speakingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      speakingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    speakingRef.current = true;
    setIsSpeaking(true);
    const utt = new window.SpeechSynthesisUtterance(next);
    utt.rate = 0.98;
    utt.pitch = 1;
    if (voiceName) {
      const v = window.speechSynthesis.getVoices().find((x) => x.name === voiceName);
      if (v) utt.voice = v;
    }
    const finish = () => {
      speakingRef.current = false;
      pump();
    };
    utt.onend = finish;
    utt.onerror = finish;
    window.speechSynthesis.speak(utt);
  }, [supported, voiceName]);

  const enqueueSentence = useCallback(
    (sentence) => {
      const s = sentence.trim();
      if (!s) return;
      queueRef.current.push(s);
      pump();
    },
    [pump]
  );

  /**
   * Append streamed tokens to the buffer; whenever a sentence terminator is
   * detected, drain that sentence to the TTS queue.
   */
  const feedTokens = useCallback(
    (delta) => {
      if (!supported || !enabled || !delta) return;
      bufferRef.current += delta;
      // Match a sentence ending followed by whitespace.
      const re = /([.!?]+["')\]]?\s+)/g;
      let lastEnd = 0;
      let match;
      while ((match = re.exec(bufferRef.current)) !== null) {
        const end = match.index + match[0].length;
        const sentence = bufferRef.current.slice(lastEnd, end);
        enqueueSentence(sentence);
        lastEnd = end;
      }
      if (lastEnd > 0) {
        bufferRef.current = bufferRef.current.slice(lastEnd);
      }
    },
    [enabled, enqueueSentence, supported]
  );

  /** Speak whatever is left in the buffer (called when the stream completes). */
  const flushPending = useCallback(() => {
    if (!supported || !enabled) return;
    const tail = bufferRef.current.trim();
    bufferRef.current = '';
    if (tail) enqueueSentence(tail);
  }, [enabled, enqueueSentence, supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    queueRef.current = [];
    bufferRef.current = '';
    speakingRef.current = false;
    setIsSpeaking(false);
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }, [supported]);

  useEffect(() => {
    return () => {
      if (supported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [supported]);

  return {
    supported,
    voices,
    voiceName,
    setVoiceName,
    isSpeaking,
    feedTokens,
    flushPending,
    cancel,
  };
}
