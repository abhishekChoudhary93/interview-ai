import { useEffect, useRef, useState } from 'react';
import { Pencil, Check, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

/**
 * Candidate scratchpad. Persisted to `interview.notes` via PATCH on a debounce
 * so the user gets autosave behavior without spamming the API. Visually quiet
 * — the chat is the focus.
 *
 * @param {{
 *   value: string,
 *   onPersist: (notes: string) => Promise<void>,
 * }} props
 */
export default function Scratchpad({ value, onPersist }) {
  const [draft, setDraft] = useState(value || '');
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);
  const lastPersistedRef = useRef(value || '');

  useEffect(() => {
    setDraft(value || '');
    lastPersistedRef.current = value || '';
  }, [value]);

  useEffect(() => {
    if (draft === lastPersistedRef.current) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await onPersist(draft);
        lastPersistedRef.current = draft;
        setSavedAt(Date.now());
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => clearTimeout(debounceRef.current);
  }, [draft, onPersist]);

  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Pencil className="h-4 w-4 text-accent" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Your notes
        </p>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Saving</span>
            </>
          ) : savedAt ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              <span>Saved</span>
            </>
          ) : null}
        </span>
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Sketch APIs, scribble numbers, list trade-offs… autosaved."
        className="min-h-[140px] resize-y rounded-xl bg-background/60 border-border/50 text-sm font-mono placeholder:text-muted-foreground/60"
      />
    </div>
  );
}
