/**
 * @param {import('./templateLoader.js').RoleTemplate} template
 * @param {Record<string, unknown>} adaptation from Layer 2 LLM
 * @param {{ experience_level?: string, role_title?: string }} meta
 */
export function mergeTemplateAndAdaptation(template, adaptation, meta = {}) {
  const experience_level = meta.experience_level || '';

  const sections = (template.sections || [])
    .filter((s) => !shouldSkipSection(s, experience_level))
    .map((s, idx) => ({
      ...s,
      _order: idx,
      pre_loaded_probes: mergeProbesForSection(s, adaptation, template),
    }));

  const opening =
    adaptation.opening_question && typeof adaptation.opening_question === 'object'
      ? adaptation.opening_question
      : {
          chosen: buildDefaultOpening(template, sections),
          reason: 'Template default opening',
        };

  return {
    template_id: template.template_id,
    template_version: template.version,
    total_minutes: template.total_minutes,
    sections,
    opening_question: opening,
    topic_priority_adjustments: adaptation.topic_priority_adjustments || {},
    depth_allocation: adaptation.depth_allocation || {},
    cross_question_seeds: adaptation.cross_question_seeds || [],
    skip_list: adaptation.skip_list || [],
    adaptation_meta: {
      pre_loaded_probes_raw: adaptation.pre_loaded_probes || [],
    },
  };
}

function shouldSkipSection(section, experience_level) {
  const conds = section.skip_conditions || [];
  for (const c of conds) {
    if (typeof c !== 'string') continue;
    if (c.includes('experience_level == lead') && experience_level === 'lead') return true;
    if (c.includes('candidate_level == staff') && experience_level === 'lead') return true;
  }
  return false;
}

function mergeProbesForSection(section, adaptation, template) {
  const probes = adaptation.pre_loaded_probes;
  if (!Array.isArray(probes)) return section.pre_loaded_probes || [];
  const sid = section.id;
  const attachSid =
    template.sections?.find((x) => x.id === 'system_design')?.id ||
    template.sections?.find((x) => x.id === 'product_sense')?.id ||
    template.sections?.[0]?.id;
  return probes.filter((p) => {
    if (p.section_id) return p.section_id === sid;
    return sid === attachSid;
  });
}

function buildDefaultOpening(template, sections) {
  const first = sections[0];
  if (!first) return `Welcome — let's begin your ${template.template_id.replace(/_/g, ' ')} interview.`;
  return `Thanks for joining. We'll start with ${first.name}. Tell me about your recent experience that's most relevant to this area.`;
}
