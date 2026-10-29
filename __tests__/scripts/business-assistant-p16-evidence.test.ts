import { describe, expect, it } from 'vitest';
import {
  P16_CHECKS,
  calculateManifestChecksum,
  createEvidenceManifest,
  evaluateEvidenceManifest,
  recordEvidenceCheck,
  sealEvidenceManifest,
  setSafetyAssertions,
  validateEvidenceManifest,
} from '../../scripts/lib/business-assistant-p16-evidence.mjs';

const APP_SHA = 'a'.repeat(40);
const OBSERVED_AT = '2026-09-10T15:00:00.000Z';
const COMPLETED_AT = '2026-09-10T16:00:00.000Z';
const EVIDENCE_SHA = 'b'.repeat(64);

function evidenceFor(source: 'CI' | 'STAGING' | 'OPERATOR' = 'STAGING') {
  return [{
    source,
    uri: source === 'CI' ? 'github://actions/run/123' : 'artifact:p16/example.json',
    sha256: EVIDENCE_SHA,
    observedAt: OBSERVED_AT,
    description: 'Immutable P16 validation output.',
  }];
}

function completeManifest() {
  let manifest = createEvidenceManifest({
    appSha: APP_SHA,
    operator: 'p16-staging-operator',
    runId: 'p16-test-run',
    startedAt: OBSERVED_AT,
  });

  for (const check of P16_CHECKS) {
    const source = check.evidenceSources[0] as 'CI' | 'STAGING' | 'OPERATOR';
    manifest = recordEvidenceCheck(manifest, {
      id: check.id,
      status: 'PASS',
      evidence: evidenceFor(source),
    });
  }

  manifest = setSafetyAssertions(manifest, {
    productionGatesUnchanged: true,
    productionDefaultsDisabled: true,
    killSwitchRestored: true,
    rollbackRehearsed: true,
  });

  return manifest;
}

describe('Business Assistant P16 evidence contract', () => {
  it('starts fail-closed with every required gate NOT_RUN', () => {
    const manifest = createEvidenceManifest({
      appSha: APP_SHA,
      operator: 'operator',
      runId: 'run-001',
      startedAt: OBSERVED_AT,
    });

    const status = evaluateEvidenceManifest(manifest, { expectedAppSha: APP_SHA });
    expect(status.valid).toBe(true);
    expect(status.totalChecks).toBe(P16_CHECKS.length);
    expect(status.notRun).toHaveLength(P16_CHECKS.length);
    expect(status.readyForSeparateProductionGateReview).toBe(false);
  });

  it('rejects PASS without immutable evidence', () => {
    const manifest = createEvidenceManifest({ appSha: APP_SHA, operator: 'operator' });
    expect(() => recordEvidenceCheck(manifest, {
      id: P16_CHECKS[0].id,
      status: 'PASS',
      evidence: [],
    })).toThrow(/requires immutable evidence/);
  });

  it('rejects CI evidence for a staging-only gate', () => {
    const manifest = createEvidenceManifest({ appSha: APP_SHA, operator: 'operator' });
    expect(() => recordEvidenceCheck(manifest, {
      id: 'provider.throttling',
      status: 'PASS',
      evidence: evidenceFor('CI'),
    })).toThrow(/source must be one of STAGING/);
  });

  it('requires an explanatory note for BLOCKED evidence', () => {
    const manifest = createEvidenceManifest({ appSha: APP_SHA, operator: 'operator' });
    expect(() => recordEvidenceCheck(manifest, {
      id: 'provider.throttling',
      status: 'BLOCKED',
    })).toThrow(/BLOCKED requires a note/);
  });

  it('refuses to seal while required gates remain incomplete', () => {
    const manifest = createEvidenceManifest({
      appSha: APP_SHA,
      operator: 'operator',
      startedAt: OBSERVED_AT,
    });
    expect(() => sealEvidenceManifest(manifest, { completedAt: COMPLETED_AT })).toThrow(/cannot seal incomplete evidence/);
  });

  it('refuses to seal all-PASS evidence until every safety assertion is true', () => {
    const manifest = setSafetyAssertions(completeManifest(), { rollbackRehearsed: false });
    expect(() => sealEvidenceManifest(manifest, { completedAt: COMPLETED_AT })).toThrow(/cannot seal incomplete evidence/);
  });

  it('never treats a complete unsealed manifest as release-review ready', () => {
    const status = evaluateEvidenceManifest(completeManifest());
    expect(status.complete).toBe(false);
    expect(status.integrityValid).toBe(false);
    expect(status.readyForSeparateProductionGateReview).toBe(false);
  });

  it('becomes eligible only after all evidence, safety assertions and sealing', () => {
    const sealed = sealEvidenceManifest(completeManifest(), { completedAt: COMPLETED_AT });
    const status = evaluateEvidenceManifest(sealed, { expectedAppSha: APP_SHA });
    expect(status.valid).toBe(true);
    expect(status.pass).toHaveLength(P16_CHECKS.length);
    expect(status.blocked).toEqual([]);
    expect(status.fail).toEqual([]);
    expect(status.notRun).toEqual([]);
    expect(status.safetySatisfied).toBe(true);
    expect(status.integrityValid).toBe(true);
    expect(status.readyForSeparateProductionGateReview).toBe(true);
  });

  it('detects checksum tampering after sealing', () => {
    const sealed = sealEvidenceManifest(completeManifest(), { completedAt: COMPLETED_AT });
    const tampered = structuredClone(sealed);
    tampered.checks[0].note = 'changed after sealing';

    const validation = validateEvidenceManifest(tampered);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('integrity.manifestSha256 does not match the manifest payload');
  });

  it('binds evidence to the exact staged application SHA', () => {
    const sealed = sealEvidenceManifest(completeManifest(), { completedAt: COMPLETED_AT });
    const validation = validateEvidenceManifest(sealed, { expectedAppSha: 'c'.repeat(40) });
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('run.appSha does not match the expected application SHA');
  });

  it('refuses to mutate a sealed evidence record', () => {
    const sealed = sealEvidenceManifest(completeManifest(), { completedAt: COMPLETED_AT });
    expect(() => setSafetyAssertions(sealed, { rollbackRehearsed: false })).toThrow(/sealed evidence is immutable/);
    expect(() => recordEvidenceCheck(sealed, {
      id: P16_CHECKS[0].id,
      status: 'FAIL',
      evidence: evidenceFor('CI'),
    })).toThrow(/sealed evidence is immutable/);
  });

  it('produces a stable checksum independent of object key order', () => {
    const manifest = createEvidenceManifest({ appSha: APP_SHA, operator: 'operator', runId: 'stable-run', startedAt: OBSERVED_AT });
    const reordered = {
      checks: manifest.checks,
      safety: manifest.safety,
      run: manifest.run,
      schemaVersion: manifest.schemaVersion,
    };
    expect(calculateManifestChecksum(reordered)).toBe(calculateManifestChecksum(manifest));
  });
});
