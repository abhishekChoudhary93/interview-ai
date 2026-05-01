/** Human-readable labels for interview configuration stored on the API. */
export function formatInterviewType(type) {
  if (!type) return '';
  const map = {
    system_design: 'System design',
    behavioral: 'Behavioral',
    mixed: 'Mixed',
    behavioral_legacy: 'Behavioral',
    technical: 'Technical',
  };
  return map[type] || String(type).replace(/_/g, ' ');
}

export function formatRoleTrack(track) {
  if (track === 'sdm') return 'Engineering leadership (SDM)';
  if (track === 'ic') return 'Individual contributor (IC)';
  return '';
}
