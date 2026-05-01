const DEFAULT_CAP = 1000;

/**
 * @param {{ role?: string, content?: string }[]} turns
 * @param {number} n
 * @param {number} [maxCharsPerMessage]
 * @returns {string[]}
 */
export function getRecentCandidateContents(turns, n, maxCharsPerMessage = DEFAULT_CAP) {
  if (!Array.isArray(turns) || n < 1) return [];
  const out = [];
  for (let i = turns.length - 1; i >= 0 && out.length < n; i--) {
    const t = turns[i];
    if (t?.role !== 'candidate') continue;
    const c = typeof t.content === 'string' ? t.content.trim() : '';
    if (!c) continue;
    out.push(c.length > maxCharsPerMessage ? `${c.slice(0, maxCharsPerMessage)}…` : c);
  }
  return out.reverse();
}

/**
 * @param {string} label
 * @param {string[]} messages oldest-first (e.g. from getRecentCandidateContents)
 * @returns {string}
 */
export function formatNumberedCandidateBlock(label, messages) {
  if (!messages.length) return `${label}\n(none yet)`;
  const lines = messages.map((m, i) => `${i + 1}. "${m.replace(/"/g, '\\"')}"`);
  return `${label}\n${lines.join('\n')}`;
}
