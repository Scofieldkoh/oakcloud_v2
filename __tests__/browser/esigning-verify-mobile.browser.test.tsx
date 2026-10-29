import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { EsigningVerifyPage } from '@/components/esigning/esigning-verify-page';
import '@/app/globals.css';

vi.mock('next/navigation', () => ({
  useParams: () => ({ certificateId: 'cert-mobile-spacing' }),
}));

const certificate = {
  certificateId: 'cert-mobile-spacing',
  envelopeId: 'envelope-1',
  title: 'Share Sale and Purchase Agreement',
  status: 'IN_PROGRESS',
  completedAt: null,
  tenantName: 'Oaktree',
  companyName: 'Bistec Global Pte. Ltd.',
  documents: [
    {
      id: 'document-1',
      fileName: 'agreement.pdf',
      hash: 'a'.repeat(64),
      hasSignedCopy: false,
    },
  ],
  recipients: [
    {
      id: 'recipient-1',
      name: 'Tan Wei Jie',
      emailMasked: 'w*********@oaktreesolutions.com.sg',
      type: 'SIGNER',
      status: 'SIGNED',
      accessMode: 'MANUAL_LINK',
      accessModeLabel: 'Manual signing link',
      signingOrder: null,
      viewedAt: '2026-09-17T00:55:00.000Z',
      consentedAt: '2026-09-17T00:55:00.000Z',
      consentIp: '182.19.215.72',
      consentDevice: 'Google Chrome on Windows (Desktop)',
      signedAt: '2026-09-17T00:55:00.000Z',
      signedIp: '182.19.215.72',
      signedDevice: 'Google Chrome on Windows (Desktop)',
    },
    {
      id: 'recipient-2',
      name: 'Marlon Luke De Cruz',
      emailMasked: '',
      type: 'SIGNER',
      status: 'NOTIFIED',
      accessMode: 'MANUAL_LINK',
      accessModeLabel: 'Manual signing link',
      signingOrder: null,
      viewedAt: null,
      consentedAt: null,
      consentIp: null,
      consentDevice: null,
      signedAt: null,
      signedIp: null,
      signedDevice: null,
    },
    {
      id: 'recipient-3',
      name: 'Koh Zhi Yong',
      emailMasked: 'z*********@oaktreesolutions.com.sg',
      type: 'SIGNER',
      status: 'SIGNED',
      accessMode: 'MANUAL_LINK',
      accessModeLabel: 'Manual signing link',
      signingOrder: null,
      viewedAt: '2026-09-17T00:57:00.000Z',
      consentedAt: '2026-09-17T00:57:00.000Z',
      consentIp: '119.234.5.89',
      consentDevice: 'Safari on iOS (Mobile)',
      signedAt: '2026-09-17T00:58:00.000Z',
      signedIp: '111.65.49.183',
      signedDevice: 'Safari on iOS (Mobile)',
    },
  ],
  events: [],
};

async function waitUntil(check: () => boolean, timeout = 4000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) {
      throw new Error('Timed out waiting for verification page');
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
  }
}

function getRecipientsSection(host: HTMLElement): HTMLElement {
  const heading = Array.from(host.querySelectorAll('h2')).find(
    (node) => node.textContent === 'Signatories & Recipients'
  );
  const section = heading?.closest('section');
  if (!(section instanceof HTMLElement)) {
    throw new Error('Recipients section not found');
  }
  return section;
}

describe('E-signing verification recipient spacing', () => {
  let host: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren(host);
    root = createRoot(host);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/public-bootstrap/verify/cert-mobile-spacing')) {
          return new Response(JSON.stringify({ certificate }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    host.remove();
  });

  it('gives recipient identity and badges separate rows on mobile without horizontal overflow', async () => {
    await page.viewport(390, 844);
    await act(async () => root.render(<EsigningVerifyPage />));
    await waitUntil(() => Boolean(host.querySelector('h2')));

    const section = getRecipientsSection(host);
    expect(getComputedStyle(section).paddingLeft).toBe('12px');
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);

    const firstCard = Array.from(section.querySelectorAll('div')).find(
      (node) => node.textContent?.includes('Tan Wei Jie') && node.classList.contains('overflow-hidden')
    );
    if (!(firstCard instanceof HTMLElement)) throw new Error('Recipient card not found');

    const header = firstCard.firstElementChild;
    if (!(header instanceof HTMLElement)) throw new Error('Recipient header not found');
    expect(getComputedStyle(header).flexWrap).toBe('wrap');
    expect(getComputedStyle(header).paddingLeft).toBe('12px');

    const badges = header.lastElementChild;
    if (!(badges instanceof HTMLElement)) throw new Error('Recipient badges not found');
    expect(getComputedStyle(badges).width).not.toBe('auto');
    expect(getComputedStyle(badges).paddingLeft).toBe('48px');
  });

  it('keeps the compact desktop arrangement at tablet-and-up widths', async () => {
    await page.viewport(1024, 900);
    await act(async () => root.render(<EsigningVerifyPage />));
    await waitUntil(() => Boolean(host.querySelector('h2')));

    const section = getRecipientsSection(host);
    expect(getComputedStyle(section).paddingLeft).toBe('24px');

    const firstCard = Array.from(section.querySelectorAll('div')).find(
      (node) => node.textContent?.includes('Tan Wei Jie') && node.classList.contains('overflow-hidden')
    );
    if (!(firstCard instanceof HTMLElement)) throw new Error('Recipient card not found');

    const header = firstCard.firstElementChild;
    if (!(header instanceof HTMLElement)) throw new Error('Recipient header not found');
    expect(getComputedStyle(header).flexWrap).toBe('nowrap');
    expect(getComputedStyle(header).paddingLeft).toBe('16px');

    const badges = header.lastElementChild;
    if (!(badges instanceof HTMLElement)) throw new Error('Recipient badges not found');
    expect(getComputedStyle(badges).paddingLeft).toBe('0px');
  });
});
