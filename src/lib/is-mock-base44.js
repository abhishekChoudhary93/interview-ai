/** True when running against in-memory mocks (no Base44 backend). */
export function isMockBase44() {
  return import.meta.env.VITE_USE_MOCK_BASE44 === 'true';
}
