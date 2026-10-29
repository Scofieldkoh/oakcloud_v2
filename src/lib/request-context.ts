/**
 * Request Context Utilities
 *
 * Provides utilities for extracting and managing request context
 * (IP address, user agent, request ID) for audit logging and tracking.
 */

import { headers } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  sessionId?: string;
  origin?: string;
  referer?: string;
}

// ============================================================================
// Request Context Extraction
// ============================================================================

/**
 * Extract request context from Next.js headers
 * Use this in API routes and server actions
 */
export async function getRequestContext(): Promise<RequestContext> {
  const headersList = await headers();

  // Get IP address (check common proxy headers first)
  const forwardedFor = headersList.get('x-forwarded-for');
  const realIp = headersList.get('x-real-ip');
  const cfConnectingIp = headersList.get('cf-connecting-ip'); // Cloudflare

  let ipAddress: string | null = null;
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs; extract and validate first valid one
    ipAddress = sanitizeForwardedIp(forwardedFor);
  } else if (realIp && isValidIp(realIp)) {
    ipAddress = realIp;
  } else if (cfConnectingIp && isValidIp(cfConnectingIp)) {
    ipAddress = cfConnectingIp;
  }

  // Get user agent
  const userAgent = headersList.get('user-agent');

  // Get or generate request ID
  const requestId =
    headersList.get('x-request-id') ||
    headersList.get('x-correlation-id') ||
    uuidv4();

  // Get optional context
  const origin = headersList.get('origin') || undefined;
  const referer = headersList.get('referer') || undefined;

  return {
    ipAddress,
    userAgent,
    requestId,
    origin,
    referer,
  };
}

/**
 * Get IP address from request
 */
export async function getClientIp(): Promise<string | null> {
  const context = await getRequestContext();
  return context.ipAddress;
}

/**
 * Get user agent from request
 */
export async function getUserAgent(): Promise<string | null> {
  const context = await getRequestContext();
  return context.userAgent;
}

/**
 * Get or generate request ID
 */
export async function getRequestId(): Promise<string> {
  const context = await getRequestContext();
  return context.requestId;
}

// ============================================================================
// Request Context for Audit Logging
// ============================================================================

/**
 * Get minimal request context for audit logging
 * Returns only the fields needed for AuditLog
 */
export async function getAuditRequestContext(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
}> {
  const context = await getRequestContext();
  return {
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId: context.requestId,
  };
}

// ============================================================================
// IP Address Utilities
// ============================================================================

/**
 * Validate IP address format (basic validation)
 * Returns true if the string looks like a valid IPv4 or IPv6 address
 */
export function isValidIp(ip: string): boolean {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^([0-9a-fA-F]{1,4}:)*::([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;

  if (ipv4Pattern.test(ip)) {
    // Validate each octet is 0-255
    const parts = ip.split('.');
    return parts.every((part) => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  return ipv6Pattern.test(ip);
}

/**
 * Sanitize IP address from X-Forwarded-For header
 * Extracts first valid IP and validates format
 */
export function sanitizeForwardedIp(forwardedFor: string): string | null {
  const ips = forwardedFor.split(',').map((ip) => ip.trim());

  for (const ip of ips) {
    // Skip empty strings
    if (!ip) continue;

    // Skip known proxy identifiers that aren't IPs
    if (ip.toLowerCase() === 'unknown') continue;

    // Validate IP format
    if (isValidIp(ip)) {
      return ip;
    }
  }

  return null;
}

/**
 * Check if IP address is from a private/internal network
 */
export function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
  ];

  return privateRanges.some((range) => range.test(ip));
}

/**
 * Anonymize IP address (for privacy compliance)
 * Removes last octet for IPv4, last 80 bits for IPv6
 */
export function anonymizeIp(ip: string): string {
  if (ip.includes(':')) {
    // IPv6: keep first 48 bits (3 groups)
    const parts = ip.split(':');
    if (parts.length >= 3) {
      return `${parts.slice(0, 3).join(':')}::`;
    }
    return ip;
  }

  // IPv4: remove last octet
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts.slice(0, 3).join('.')}.0`;
  }

  return ip;
}

// ============================================================================
// User Agent Parsing (Basic)
// ============================================================================

export interface ParsedUserAgent {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  device: string | null;
  isBot: boolean;
}

/**
 * Parse user agent string (basic parsing)
 * For comprehensive parsing, consider using a library like ua-parser-js
 */
export function parseUserAgent(userAgent: string | null): ParsedUserAgent {
  if (!userAgent) {
    return {
      browser: null,
      browserVersion: null,
      os: null,
      device: null,
      isBot: false,
    };
  }

  const ua = userAgent.toLowerCase();

  // Detect bots
  const isBot =
    ua.includes('bot') ||
    ua.includes('crawler') ||
    ua.includes('spider') ||
    ua.includes('scraper');

  // Detect browser
  let browser: string | null = null;
  let browserVersion: string | null = null;

  if (ua.includes('edg/')) {
    browser = 'Edge';
    const match = userAgent.match(/Edg\/([0-9.]+)/);
    browserVersion = match?.[1] || null;
  } else if (ua.includes('chrome')) {
    browser = 'Chrome';
    const match = userAgent.match(/Chrome\/([0-9.]+)/);
    browserVersion = match?.[1] || null;
  } else if (ua.includes('firefox')) {
    browser = 'Firefox';
    const match = userAgent.match(/Firefox\/([0-9.]+)/);
    browserVersion = match?.[1] || null;
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari';
    const match = userAgent.match(/Version\/([0-9.]+)/);
    browserVersion = match?.[1] || null;
  }

  // Detect OS
  let os: string | null = null;
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  // Detect device type
  let device: string | null = null;
  if (ua.includes('mobile')) device = 'Mobile';
  else if (ua.includes('tablet') || ua.includes('ipad')) device = 'Tablet';
  else device = 'Desktop';

  return {
    browser,
    browserVersion,
    os,
    device,
    isBot,
  };
}
