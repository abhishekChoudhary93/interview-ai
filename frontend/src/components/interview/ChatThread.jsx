import { useEffect, useLayoutEffect, useRef } from 'react';
import { Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Three little dots that pulse — used while the interviewer's stream hasn't
 * delivered its first token yet. Distinct from interim STT bubbles.
 */
function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1.5" aria-label="Interviewer is thinking">
      {[0, 0.15, 0.3].map((d, i) => (
        <span
          key={i}
          className="block h-2 w-2 rounded-full bg-muted-foreground/60"
          style={{ animation: `typingPulse 1.1s ease-in-out ${d}s infinite` }}
        />
      ))}
      <style>{`@keyframes typingPulse {
        0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
        40% { opacity: 1; transform: translateY(-2px); }
      }`}</style>
    </div>
  );
}

function MessageBubble({ message, isStreaming = false }) {
  const isInterviewer = message.role === 'interviewer';
  const isInterim = message.kind === 'interim_candidate';

  return (
    <div className={cn('flex gap-3', isInterviewer ? '' : 'flex-row-reverse')}>
      <div
        className={cn(
          'h-8 w-8 flex-shrink-0 rounded-lg flex items-center justify-center',
          isInterviewer
            ? 'bg-accent/15 text-accent'
            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
        )}
      >
        {isInterviewer ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
      </div>
      <div className={cn('flex flex-col max-w-[78%]', isInterviewer ? 'items-start' : 'items-end')}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1 px-1">
          {isInterviewer ? 'Interviewer' : 'You'}
          {isInterim && <span className="ml-1.5 text-amber-500/80">(listening…)</span>}
        </p>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed border',
            isInterviewer
              ? 'bg-muted/70 text-foreground border-border/50 rounded-tl-sm'
              : 'bg-accent/15 text-foreground border-accent/30 rounded-tr-sm',
            isInterim && 'bg-amber-500/10 border-amber-500/30 italic text-foreground/80'
          )}
        >
          {message.content || (isStreaming ? <TypingDots /> : null)}
          {isStreaming && message.content ? (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent/70 align-text-bottom animate-pulse" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Scrolling message list for the active interview. Always pins to the bottom
 * unless the user has manually scrolled up — in that case we leave their
 * scroll position alone and they can press End/scroll to catch up.
 */
export default function ChatThread({
  messages,
  pendingCandidate = null,
  streamingInterviewer = null,
  className = '',
}) {
  const containerRef = useRef(null);
  const stickToBottomRef = useRef(true);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pendingCandidate, streamingInterviewer]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const hasContent = messages.length > 0 || pendingCandidate || streamingInterviewer;

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex-1 min-h-0 overflow-y-auto overflow-x-hidden',
        '[scrollbar-gutter:stable] scroll-smooth',
        className
      )}
    >
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 space-y-4">
        {!hasContent && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">Your conversation will appear here.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={`${i}-${m.role}`} message={m} />
        ))}

        {pendingCandidate && (
          <MessageBubble message={{ role: 'candidate', content: pendingCandidate.content, kind: pendingCandidate.kind }} />
        )}

        {streamingInterviewer !== null && (
          <MessageBubble
            message={{ role: 'interviewer', content: streamingInterviewer }}
            isStreaming
          />
        )}
      </div>
    </div>
  );
}
