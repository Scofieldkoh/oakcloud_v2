/**
 * Get allowed origins from environment or use defaults.
 */
export function getAllowedOrigins(host: string): string[] {
  const origins: string[] = [];

  // Allow same origin (both http and https for local development)
  origins.push(`http://${host}`);
  origins.push(`https://${host}`);

  // Allow localhost variants for development
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    origins.push('http://localhost:3000');
    origins.push('http://127.0.0.1:3000');
    origins.push('https://localhost:3000');
  }

  // Add any additional allowed origins from environment
  const additionalOrigins = process.env.ALLOWED_ORIGINS;
  if (additionalOrigins) {
    origins.push(...additionalOrigins.split(',').map((origin) => origin.trim()));
  }

  return origins;
}

function parseOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Origin headers contain only scheme/host/port. URL#origin also removes
    // default ports and normalizes host casing before comparison.
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Validate an Origin header against the request host and explicit allowlist.
 */
export function isValidOrigin(origin: string | null, host: string): boolean {
  // No origin header - likely same-site navigation or non-browser client
  // This is acceptable as browsers always send Origin for cross-origin requests
  if (!origin) {
    return true;
  }

  const parsedOrigin = parseOrigin(origin);
  if (!parsedOrigin) return false;

  const allowedOrigins = getAllowedOrigins(host)
    .map(parseOrigin)
    .filter((allowed): allowed is string => allowed !== null);

  // Compare parsed origins for exact scheme/host/port equality. Prefix checks
  // would accept lookalikes such as https://trusted.example.evil.
  return allowedOrigins.includes(parsedOrigin);
}
