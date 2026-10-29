export const createServiceAgreementClientKey = () =>
  globalThis.crypto?.randomUUID?.()
  ?? `sa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
