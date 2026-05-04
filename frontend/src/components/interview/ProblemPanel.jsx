import { Target } from 'lucide-react';

function ProblemBlock({ problem }) {
  if (!problem) return null;
  if (typeof problem === 'string') {
    return (
      <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{problem}</p>
    );
  }
  return (
    <div className="space-y-3">
      {problem.title && (
        <p className="text-sm font-semibold text-foreground">{problem.title}</p>
      )}
      {problem.brief && (
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {problem.brief}
        </p>
      )}
    </div>
  );
}

/**
 * Right-rail "what we're working on" panel: persona + problem statement.
 * Section progress was removed — the LLM (Planner) drives transitions
 * verbally and the application no longer tracks section advancement.
 *
 * Reads v3 shape: `config.interviewer.{name,title,company,style_note}` and
 * `config.problem.{title,brief}`. Falls back to the legacy v2 shape
 * (`interviewer_persona`, `primary_question`) so old in-flight rows still
 * render until they expire.
 */
export default function ProblemPanel({ config }) {
  if (!config) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card/40 p-4">
        <p className="text-xs text-muted-foreground">No problem context.</p>
      </div>
    );
  }

  const interviewer = config.interviewer || config.interviewer_persona || null;
  const problem = config.problem || config.primary_question || null;

  return (
    <div className="space-y-4">
      {interviewer?.name && (
        <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Your interviewer
          </p>
          <p className="text-sm font-semibold text-foreground">{interviewer.name}</p>
          {(interviewer.title || interviewer.company) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {[interviewer.title, interviewer.company].filter(Boolean).join(' · ')}
            </p>
          )}
          {(interviewer.style_note || interviewer.style) && (
            <p className="text-xs text-foreground/80 mt-2 leading-relaxed">
              {interviewer.style_note || interviewer.style}
            </p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-accent" />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            The problem
          </p>
        </div>
        <ProblemBlock problem={problem} />
      </div>
    </div>
  );
}
