'use client';

import { useEffect } from 'react';

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const iOSUserAgent = /iPad|iPhone|iPod/.test(userAgent);
  const iPadOSDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  return iOSUserAgent || iPadOSDesktopMode;
}

/**
 * iOS Safari auto-zooms focused form controls in some cases.
 * For iOS only, enforce a viewport config that prevents focus zoom jumps.
 */
export function IOSViewportFix() {
  useEffect(() => {
    if (!isIOSDevice()) return;

    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) return;

    viewportMeta.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover'
    );
  }, []);

  return null;
}

export default IOSViewportFix;
