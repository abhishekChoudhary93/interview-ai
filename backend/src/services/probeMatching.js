/**
 * @param {string} candidateText
 * @param {object[]} probes from execution_plan section or adaptation_meta
 * @param {{ fired_probe_ids: string[] }} state
 * @param {string} sectionId
 * @returns {{ probe: object | null, probeId: string | null }}
 */
export function matchPreloadedProbes(candidateText, probes, state, sectionId) {
  if (!Array.isArray(probes) || !candidateText) return { probe: null, probeId: null };
  const lower = candidateText.toLowerCase();
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i];
    const trig = (p.trigger || '').toLowerCase();
    if (!trig) continue;
    const probeId = `${sectionId}:${i}:${hashTrig(trig)}`;
    if (state.fired_probe_ids.includes(probeId)) continue;
    if (lower.includes(trig) || wordsMatch(lower, trig)) {
      return { probe: p, probeId };
    }
  }
  return { probe: null, probeId: null };
}

function hashTrig(s) {
  return String(s).slice(0, 32).replace(/\s+/g, '_');
}

function wordsMatch(text, triggerPhrase) {
  const words = triggerPhrase.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return words.every((w) => text.includes(w));
}

/**
 * Collect all probes for current section from execution plan.
 */
export function getProbesForCurrentSection(executionPlan, sectionIndex) {
  const sec = executionPlan?.sections?.[sectionIndex];
  if (!sec) return [];
  const fromSection = sec.pre_loaded_probes || [];
  const raw = executionPlan.adaptation_meta?.pre_loaded_probes_raw || [];
  const merged = [...fromSection];
  for (const p of raw) {
    if (!p.section_id || p.section_id === sec.id) merged.push(p);
  }
  return merged;
}
