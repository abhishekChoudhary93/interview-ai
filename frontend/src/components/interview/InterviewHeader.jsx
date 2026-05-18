import { useEffect, useState } from 'react';
import {
  MessageSquare,
  Mic,
  Video,
  PauseCircle,
  ClipboardCheck,
  Loader2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

function ModeBadge({ mode }) {
  const Icon = mode === 'video' ? Video : mode === 'audio' ? Mic : MessageSquare;
  const label = mode === 'video' ? 'Video' : mode === 'audio' ? 'Audio' : 'Chat';
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function effectiveElapsedMs(startedAt, totalPausedMs = 0, pausedAtMs = null) {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const pausedAccum = Number(totalPausedMs) || 0;
  const activePause =
    pausedAtMs != null && Number.isFinite(Number(pausedAtMs))
      ? Math.max(0, Date.now() - Number(pausedAtMs))
      : 0;
  return Math.max(0, Date.now() - start - pausedAccum - activePause);
}

function ElapsedClock({ startedAt, totalPausedMs = 0, pausedAtMs = null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt, totalPausedMs, pausedAtMs]);
  void tick;
  if (!startedAt) return null;
  const total = Math.max(0, Math.floor(effectiveElapsedMs(startedAt, totalPausedMs, pausedAtMs) / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return (
    <span className="text-xs text-muted-foreground tabular-nums" title="Elapsed">
      {m}:{s}
    </span>
  );
}

export default function InterviewHeader({
  interview,
  problemTitle,
  onPause,
  onEndAndReport,
  isProcessing,
  isEndingSession,
  canEndEarly,
  voices = [],
  voiceName = '',
  onVoiceChange,
  voiceMuted = false,
  onToggleVoiceMute,
  showVoiceControls = false,
}) {
  const mode = interview.interview_mode || 'chat';
  const sessionState = interview.session_state || {};
  const totalPausedMs = sessionState.total_paused_ms ?? 0;
  const pausedAtMs = sessionState.paused_at_ms ?? null;

  return (
    <div className="sticky top-0 z-10 border-b border-border/50 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-7xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {problemTitle ? (
            <p className="text-sm text-foreground font-semibold truncate">{problemTitle}</p>
          ) : null}
          <p
            className={cn(
              'truncate',
              problemTitle
                ? 'text-xs text-muted-foreground mt-0.5'
                : 'text-sm text-foreground font-medium'
            )}
          >
            {interview.role_title}
            {interview.company ? <span> · {interview.company}</span> : null}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <ModeBadge mode={mode} />
            <ElapsedClock
              startedAt={interview.session_started_at}
              totalPausedMs={totalPausedMs}
              pausedAtMs={pausedAtMs}
            />
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {showVoiceControls && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleVoiceMute}
                title={voiceMuted ? 'Unmute interviewer' : 'Mute interviewer'}
                className={cn('rounded-xl', voiceMuted && 'text-rose-500')}
              >
                {voiceMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
              {voices.length > 0 && (
                <Select value={voiceName} onValueChange={onVoiceChange}>
                  <SelectTrigger className="h-9 w-[140px] rounded-xl text-xs hidden md:inline-flex">
                    <SelectValue placeholder="Voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {voices.map((v) => (
                      <SelectItem key={v.name} value={v.name} className="text-xs">
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}

          {(interview.status === 'in_progress' || interview.status === 'paused') && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onEndAndReport}
              disabled={isProcessing || isEndingSession || !canEndEarly}
              className="rounded-xl gap-1.5 border-border text-foreground hover:bg-accent hover:text-accent-foreground hover:border-accent"
              title={
                canEndEarly
                  ? 'Finish now and open your scored report'
                  : 'Reply to at least one question first'
              }
            >
              {isEndingSession ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ClipboardCheck className="w-4 h-4" />
              )}
              <span className="hidden sm:inline text-xs font-medium">End &amp; report</span>
            </Button>
          )}

          {(interview.status === 'in_progress' || interview.status === 'paused') && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onPause}
              disabled={isProcessing || isEndingSession}
              className="rounded-xl gap-1.5 text-muted-foreground hover:text-foreground"
              title="Pause and resume later"
            >
              <PauseCircle className="w-5 h-5" />
              <span className="hidden sm:inline text-xs font-medium">Pause</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
