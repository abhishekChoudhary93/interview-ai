/**
 * Strip paid-only report fields for starter / basic reportLevel.
 * @param {Record<string, unknown>} interviewPlain
 */
export function redactInterviewForReport(interviewPlain) {
  const out = { ...interviewPlain };
  const debrief = out.debrief && typeof out.debrief === 'object' ? { ...out.debrief } : null;

  if (debrief) {
    const summary =
      debrief.summary ||
      debrief.executive_summary ||
      debrief.overall_comment ||
      '';
    out.debrief = {
      verdict: debrief.verdict,
      summary: typeof summary === 'string' ? summary.slice(0, 500) : summary,
    };
  }

  delete out.conversation_turns;
  delete out.canvas_scene;
  delete out.canvas_text;
  if (out.session_state && typeof out.session_state === 'object') {
    const ss = { ...out.session_state };
    delete ss.raw_planner_outputs;
    delete ss.signals;
    out.session_state = ss;
  }

  out._reportRedacted = true;
  return out;
}
