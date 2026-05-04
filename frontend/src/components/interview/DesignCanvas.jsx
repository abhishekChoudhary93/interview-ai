import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pencil, Check, Loader2 } from 'lucide-react';
import { canvasToText } from '@/utils/canvasToText.js';

// Excalidraw 0.17.x bundles its CSS into the JS — no separate stylesheet
// import needed.
//
// Excalidraw is heavy (~1MB) and its CJS entry pokes at process.env. Lazy-load
// it so the rest of the interview page renders instantly and so the bundle is
// only paid by candidates who open a system-design interview.
const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((mod) => ({ default: mod.Excalidraw }))
);

/**
 * Design canvas for system-design interviews. Mirrors the Scratchpad's
 * autosave contract:
 *
 *   - Hydrates from `initialScene` on mount.
 *   - On every Excalidraw change, debounces 800ms then calls `onPersist({
 *     canvas_scene, canvas_text })`. The text summary is what the LLM sees
 *     each turn (see backend/src/services/interviewSystemPrompt.js
 *     `formatCanvasSnapshot`).
 *   - Exposes a `flushPending()` method via ref. Callers (the chat-send
 *     handler in Interview.jsx) await this before kicking off a turn so any
 *     in-flight debounced save lands BEFORE the backend reads the interview
 *     row — otherwise a candidate who drew + sent within 800ms would have
 *     their drawing missed by the LLM.
 *
 * @param {{
 *   initialScene: { elements?: any[], appState?: object, files?: object } | null,
 *   onPersist: (patch: { canvas_scene: object, canvas_text: string }) => Promise<void>,
 * }} props
 */
const DesignCanvas = forwardRef(function DesignCanvas({ initialScene, onPersist }, ref) {
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);
  const lastPersistedTextRef = useRef('');
  const skipNextChangeRef = useRef(true);
  // Latest (elements, appState, files) from onChange. Used by flushPending to
  // persist whatever the candidate has on the canvas right now without
  // waiting for the debounce.
  const latestSceneRef = useRef(null);
  // Single in-flight persist promise, so flushPending and the debounced save
  // can dedupe each other if they fire close together.
  const inFlightRef = useRef(null);

  // Excalidraw is uncontrolled — feed it a stable initial scene the first
  // time. Subsequent rerenders should not pass a new initialData (that would
  // reset the candidate's drawing).
  const initialData = useMemo(() => {
    if (!initialScene || typeof initialScene !== 'object') return null;
    return {
      elements: Array.isArray(initialScene.elements) ? initialScene.elements : [],
      appState: { ...(initialScene.appState || {}), collaborators: new Map() },
      files: initialScene.files || {},
    };
    // We deliberately memo on first-render-only — Excalidraw is uncontrolled
    // and re-passing initialData would wipe the candidate's drawing.
  }, []);

  useEffect(() => {
    lastPersistedTextRef.current = canvasToText(initialScene || { elements: [] });
  }, [initialScene]);

  async function persistNow() {
    const scene = latestSceneRef.current;
    if (!scene) return;
    const text = canvasToText(scene);
    if (text === lastPersistedTextRef.current && (scene.elements?.length ?? 0) === 0) {
      return;
    }
    setSaving(true);
    try {
      await onPersist({ canvas_scene: scene, canvas_text: text });
      lastPersistedTextRef.current = text;
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  function scheduleSave(elements, appState, files) {
    // Excalidraw fires onChange once on mount; ignore that one so we don't
    // spuriously persist an empty scene over a hydrated one. The earlier
    // implementation skipped the FIRST onChange unconditionally, which
    // dropped the candidate's first stroke when Excalidraw delivered the
    // user's edit before its own mount-time echo (a race on initial
    // hydration). The fix: only skip when the incoming scene is the
    // mount-time echo, which is recognizable by element count <= the
    // initial scene's count. A real first stroke increments the count.
    if (skipNextChangeRef.current) {
      const initialCount = Array.isArray(initialScene?.elements)
        ? initialScene.elements.length
        : 0;
      const incomingCount = Array.isArray(elements) ? elements.length : 0;
      if (incomingCount <= initialCount) {
        skipNextChangeRef.current = false;
        return;
      }
      // First user stroke arrived before/instead of the mount-time echo.
      // Capture it and flip the skip flag off so subsequent onChanges
      // proceed normally.
      skipNextChangeRef.current = false;
    }
    latestSceneRef.current = {
      elements,
      appState: stripVolatileAppState(appState),
      files,
    };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      // Coalesce with any flushPending that may have fired concurrently.
      if (!inFlightRef.current) {
        inFlightRef.current = persistNow().finally(() => {
          inFlightRef.current = null;
        });
      }
    }, 800);
  }

  useImperativeHandle(
    ref,
    () => ({
      /**
       * Cancel the pending debounce and persist the current canvas state
       * synchronously. Awaits the network round-trip so callers can be sure
       * the backend has fresh canvas_text before the next API call.
       */
      async flushPending() {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        if (inFlightRef.current) {
          await inFlightRef.current;
          return;
        }
        if (!latestSceneRef.current) return;
        inFlightRef.current = persistNow().finally(() => {
          inFlightRef.current = null;
        });
        await inFlightRef.current;
      },
    }),
    []
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-2">
        <Pencil className="h-4 w-4 text-accent" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Design canvas
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
      <div className="flex-1 min-h-0 bg-background">
        <Suspense fallback={<CanvasFallback />}>
          <Excalidraw
            initialData={initialData}
            onChange={scheduleSave}
            UIOptions={{
              canvasActions: {
                saveToActiveFile: false,
                loadScene: false,
                export: false,
                toggleTheme: false,
              },
            }}
          />
        </Suspense>
      </div>
      <p className="border-t border-border/40 bg-muted/20 px-3 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
        The interviewer reads a textual summary on every turn — they can react to what you draw.
      </p>
    </div>
  );
});

export default DesignCanvas;

function CanvasFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Trim the volatile parts of Excalidraw's `appState` before persisting, so
 * the saved JSON doesn't balloon with cursor positions, scroll offsets, and
 * Map instances that don't survive JSON.stringify cleanly.
 */
function stripVolatileAppState(appState) {
  if (!appState || typeof appState !== 'object') return {};
  const {
    collaborators: _collab,
    selectedElementIds: _sel,
    cursorButton: _cb,
    scrollX: _sx,
    scrollY: _sy,
    zenModeEnabled: _zm,
    ...rest
  } = appState;
  return rest;
}
