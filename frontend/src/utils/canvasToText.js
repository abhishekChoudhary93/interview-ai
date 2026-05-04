/**
 * Render an Excalidraw scene as a compact textual description for the LLM.
 *
 * The conversational interviewer never sees the actual canvas — it sees this
 * summary, regenerated whenever the candidate edits the diagram and persisted
 * onto `interview.canvas_text`. The summary intentionally trades fidelity for
 * brevity: we want enough so the model can react ("you've put a cache between
 * the API and the DB — what's your eviction story?") without spending a huge
 * chunk of the context window on element positions.
 *
 * Output shape (lines, capped to MAX_CHARS):
 *
 *   Boxes: API Gateway, Cache, Metadata DB
 *   Arrows: API Gateway -> Cache, Cache -> Metadata DB
 *   Arrows: 2 unconnected             (when present)
 *   Sketches: 4 freehand strokes      (when present)
 *   Labels: TTL=60s
 *
 * Returns '' for a fully empty scene. For a scene that has elements but no
 * structured shapes/arrows/text we emit a "<N> hand-drawn elements (no labels
 * yet)" fallback — the LLM needs to know SOMETHING is there even when our
 * summary can't structure it, otherwise it falls back to "I can't see images".
 */

const MAX_CHARS = 600;

const SHAPE_TYPES = new Set(['rectangle', 'ellipse', 'diamond']);
const ARROW_TYPES = new Set(['arrow', 'line']);
const TEXT_TYPES = new Set(['text']);
const FREEDRAW_TYPES = new Set(['freedraw']);

/** Excalidraw text labels are linked to their parent shape via `containerId`
 *  on the text element, plus `boundElements` on the shape. */
function buildLabelMap(elements) {
  const labels = new Map();
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (!TEXT_TYPES.has(el.type)) continue;
    const text = String(el.text || '').trim();
    if (!text) continue;
    if (el.containerId) labels.set(el.containerId, text);
  }
  return labels;
}

function shapeLabel(shape, labelMap, fallbackIdx) {
  const linked = labelMap.get(shape.id);
  if (linked) return linked;
  const inline = String(shape.text || '').trim();
  if (inline) return inline;
  return `Box${fallbackIdx + 1}`;
}

function nodeLookup(nodes) {
  const map = new Map();
  for (const n of nodes) map.set(n.id, n.label);
  return map;
}

function pickFreeText(elements, labelMap) {
  const out = [];
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (!TEXT_TYPES.has(el.type)) continue;
    if (el.containerId && labelMap.has(el.containerId)) continue;
    const text = String(el.text || '').trim();
    if (text) out.push(text);
  }
  return out;
}

function pickArrows(elements, byId) {
  const bound = [];
  let unbound = 0;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (!ARROW_TYPES.has(el.type)) continue;
    const startId = el.startBinding?.elementId;
    const endId = el.endBinding?.elementId;
    const from = startId ? byId.get(startId) : null;
    const to = endId ? byId.get(endId) : null;
    if (from && to) {
      bound.push(`${from} -> ${to}`);
    } else {
      unbound += 1;
    }
  }
  return { bound, unbound };
}

function countFreedraw(elements) {
  let n = 0;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (FREEDRAW_TYPES.has(el.type)) n += 1;
  }
  return n;
}

function countLiveElements(elements) {
  let n = 0;
  for (const el of elements) {
    if (el && !el.isDeleted) n += 1;
  }
  return n;
}

/**
 * @param {{ elements?: Array }} scene Excalidraw scene-like object
 * @returns {string} compact summary or '' if nothing meaningful
 */
export function canvasToText(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  if (elements.length === 0) return '';

  const labelMap = buildLabelMap(elements);

  const shapes = [];
  let idx = 0;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (!SHAPE_TYPES.has(el.type)) continue;
    shapes.push({ id: el.id, label: shapeLabel(el, labelMap, idx) });
    idx += 1;
  }

  const byId = nodeLookup(shapes);
  const { bound: boundArrows, unbound: unboundArrows } = pickArrows(elements, byId);
  const freeText = pickFreeText(elements, labelMap);
  const freedraw = countFreedraw(elements);

  const lines = [];
  if (shapes.length > 0) lines.push(`Boxes: ${shapes.map((s) => s.label).join(', ')}`);
  if (boundArrows.length > 0) lines.push(`Arrows: ${boundArrows.join(', ')}`);
  if (unboundArrows > 0) {
    lines.push(`Arrows: ${unboundArrows} unconnected (no clear endpoints yet)`);
  }
  if (freedraw > 0) {
    lines.push(`Sketches: ${freedraw} freehand stroke${freedraw === 1 ? '' : 's'}`);
  }
  if (freeText.length > 0) lines.push(`Labels: ${freeText.join(' | ')}`);

  // Last-resort fallback. The Executor's "I can't see images" reply is
  // triggered when its prompt has zero canvas info, so we'd rather emit a
  // generic count than nothing — at least the model knows the candidate is
  // drawing and can ask "what does the cluster on the left represent?".
  if (lines.length === 0) {
    const liveCount = countLiveElements(elements);
    if (liveCount === 0) return '';
    return `${liveCount} hand-drawn element${liveCount === 1 ? '' : 's'} (no labels yet)`;
  }

  const joined = lines.join('\n');
  if (joined.length <= MAX_CHARS) return joined;
  return `${joined.slice(0, MAX_CHARS - 1)}…`;
}
