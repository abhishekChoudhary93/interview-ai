import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Mic, MicOff, KeyRound, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { cn } from '@/lib/utils';

/**
 * Bottom composer. Three behaviors based on `mode`:
 *
 * - chat   : plain textarea + Send (Enter to submit, Shift+Enter newline)
 * - audio  : tap-to-talk with live STT, editable interim transcript bubble,
 *            text fallback always available via "Type instead"
 * - video  : same composer behavior as audio (the camera feed lives in the
 *            video tile — composer just runs STT)
 *
 * Send is disabled while the parent is streaming; abort is exposed via the
 * onAbort prop in case the parent wants to support stop-mid-reply.
 */
export default function Composer({
  mode,
  isSending,
  isStreaming,
  onSubmit,
  onRecordingChange,
  onAbort,
  micEnabled = true,
}) {
  const [text, setText] = useState('');
  const [textFallback, setTextFallback] = useState(mode === 'chat');
  const taRef = useRef(null);

  const speech = useSpeechRecognition();

  useEffect(() => {
    setTextFallback(mode === 'chat' || !speech.supported);
  }, [mode, speech.supported]);

  // Bubble the recording state up so the parent can drive the user-tile
  // pulse animation in the video shell.
  useEffect(() => {
    onRecordingChange?.(speech.isRecording);
  }, [speech.isRecording, onRecordingChange]);

  // Keep textarea synced with STT-final buffer so the user can edit it
  // before pressing Send. This is the "interim STT with editable transcript"
  // behavior the plan calls for.
  useEffect(() => {
    if (mode !== 'chat' && !textFallback) {
      setText(speech.final);
    }
  }, [speech.final, mode, textFallback]);

  // If the user toggles the mic off while typing in voice mode, leave any
  // pending text in place (don't blow away their work).
  useEffect(() => {
    if (!micEnabled && speech.isRecording) {
      speech.stop();
    }
  }, [micEnabled, speech]);

  const submit = () => {
    const v = text.trim();
    if (!v || isSending || isStreaming) return;
    onSubmit(v);
    setText('');
    speech.reset();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const showInterim = !!speech.interim && speech.isRecording;

  return (
    <div className="border-t border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-4">
        {showInterim && (
          <div className="mb-2 rounded-xl border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs text-foreground/80 italic">
            <span className="font-semibold uppercase tracking-wide text-[10px] text-amber-500/90 mr-2">
              Hearing
            </span>
            {speech.interim}
          </div>
        )}

        {speech.error && (
          <p className="mb-2 text-xs text-destructive">{speech.error}</p>
        )}

        <div className="flex items-end gap-2">
          {mode !== 'chat' && speech.supported && (
            <Button
              type="button"
              variant={speech.isRecording ? 'default' : 'outline'}
              size="icon"
              disabled={isSending || isStreaming || !micEnabled}
              onClick={() => (speech.isRecording ? speech.stop() : speech.start())}
              className={cn(
                'h-11 w-11 rounded-xl shrink-0',
                speech.isRecording && 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
              )}
              title={speech.isRecording ? 'Stop talking' : 'Tap to talk'}
            >
              {speech.isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}

          {mode !== 'chat' && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setTextFallback((v) => !v)}
              className="h-11 w-11 rounded-xl shrink-0 text-muted-foreground"
              title={textFallback ? 'Switch back to voice' : 'Type instead'}
            >
              {textFallback ? <Mic className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            </Button>
          )}

          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'chat'
                ? 'Type your reply…'
                : speech.isRecording
                  ? 'Speaking… (you can edit before sending)'
                  : textFallback
                    ? 'Type your reply…'
                    : 'Tap the mic to talk, or use the keyboard'
            }
            className="flex-1 min-h-[44px] max-h-40 resize-none rounded-xl bg-background border-border/60 text-sm leading-relaxed"
            disabled={isSending || isStreaming}
            rows={1}
          />

          {isStreaming && onAbort ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onAbort}
              className="h-11 w-11 rounded-xl shrink-0"
              title="Stop reply"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={submit}
              disabled={!text.trim() || isSending || isStreaming}
              className="h-11 px-4 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground shrink-0 gap-2"
              title="Send (Enter)"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  <span className="hidden sm:inline text-sm font-semibold">Send</span>
                </>
              )}
            </Button>
          )}
        </div>

        {mode !== 'chat' && !micEnabled && (
          <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1">
            <MicOff className="h-3 w-3" />
            Microphone is muted from the call controls. Unmute or use the keyboard.
          </p>
        )}
      </div>
    </div>
  );
}
