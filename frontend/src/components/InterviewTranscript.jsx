import { useEffect, useRef } from "react";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ongoing transcript for chat, audio, and video sessions.
 * Uses native overflow scrolling so flex layouts get a real scroll height (Radix ScrollArea often does not).
 */
export default function InterviewTranscript({
  messages,
  className = "",
  title = "Conversation",
  subtitle = "Live transcript",
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 overflow-hidden rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm",
        messages.length > 0 && "min-h-[160px]",
        "max-h-[min(400px,52dvh)]",
        className
      )}
    >
      <div className="px-4 py-3 border-b border-border/50 bg-muted/30 flex-shrink-0">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 scroll-smooth [scrollbar-gutter:stable]">
        <div className="space-y-3 pr-1">
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Messages appear here as you go.</p>
          ) : (
            messages.map((m, i) => (
              <div
                key={`${i}-${m.role}-${String(m.content).slice(0, 24)}`}
                className={`flex gap-2 ${m.role === "candidate" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    m.role === "interviewer"
                      ? "bg-accent/15 text-accent"
                      : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {m.role === "interviewer" ? (
                    <Bot className="w-4 h-4" />
                  ) : (
                    <User className="w-4 h-4" />
                  )}
                </div>
                <div
                  className={`rounded-xl px-3 py-2 max-w-[92%] text-sm leading-relaxed ${
                    m.role === "interviewer"
                      ? "bg-muted/80 text-foreground border border-border/40"
                      : "bg-accent/10 text-foreground border border-accent/20"
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70 mb-1">
                    {m.role === "interviewer" ? "Interviewer" : "You"}
                  </p>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
