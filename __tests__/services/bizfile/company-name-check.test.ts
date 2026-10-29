import { describe, expect, it } from 'vitest';
import {
  areCompanyNamesSimilar,
  canonicalizeCompanyName,
  classifyCompanyNameMatch,
  requiresCompanyNameReview,
} from '@/lib/external/company-name-check';

const ABACON = 'ABACON CONSULTING PTE. LTD.';
const OAKTREE = 'OAKTREE ACCOUNTING & CORPORATE SOLUTIONS PTE. LTD.';

describe('Bizfile-style company name assessment', () => {
  describe('identical-name normalization', () => {
    it.each([
      'ABACON CONSULTING',
      'THE ABACON CONSULTING',
      'ABACON-CONSULTING',
      'ABACON CONSULTING SINGAPORE',
      'ABACON CONSULTING SG',
      'ABACON CONSULTING GROUP',
      'ABACON CONSULTING INTERNATIONAL',
      'ABACON CONSULTING ASIA',
      'ABACONCONSULTING',
      'ABA CON CONSULTING',
      'ABACON SINGAPORE CONSULTING',
      'SINGAPORE ABACON CONSULTING',
      "ABACON S'PORE CONSULTING",
      'ABACON CONSULTING GROUP INTERNATIONAL',
      'ABACON CONSULTING INTERNATIONAL GROUP',
      'ABACON CONSULTING SINGAPORE GROUP',
      'ABACON CONSULTING GROUP SINGAPORE',
      'ABACON CONSULTING WORLDWIDE',
      'ABACON CONSULTING HOLDING',
      'ABACON CONSULTING HOLDINGS',
      'ABACON CONSULTING PARTNERS',
      'ABACON CONSULTING TRADING',
      'ABACON CONSULTING ASIA PACIFIC',
      'ABACON CONSULTING.COM',
      'ABACON CONSULTING INTL',
      'ABACON CONSULTING CORP',
      'ABACON CONSULTING CO',
    ])('classifies %s as identical to the ABACON baseline', (proposed) => {
      expect(classifyCompanyNameMatch(proposed, ABACON)).toBe('IDENTICAL');
    });

    it.each([
      'OAKTREE ACCOUNTING & CORPORATE SOLUTION',
      'OAKTREE ACCOUNTINGS & CORPORATE SOLUTIONS',
      "OAKTREE ACCOUNTING & CORPORATE SOLUTION'S",
      'OAKTREE ACCOUNTING AND CORPORATE SOLUTION',
      'OAKTREE ACCOUNTING & CORPORATE SOLUTION SINGAPORE',
      'OAKTREE ACCOUNTING & CORPORATE SOLUTIONS GROUP',
      'OAKTREE ACCOUNTING & CORPORATE SOLUTIONS INTL',
      'OAKTREE ACCOUNTING & CORPORATE SOLUTIONS SG',
    ])('classifies %s as identical to the OAKTREE baseline', (proposed) => {
      expect(classifyCompanyNameMatch(proposed, OAKTREE)).toBe('IDENTICAL');
    });
  });

  describe('similar-name warnings', () => {
    it.each([
      'ABACON CONSULTANT',
      'ABACON CONSULTANCY',
      'ABACON CONSULTATION',
      'ABACON CONSULTATIONS',
      'ABACON CONSULTANTS',
      'ABACON CONSULTANCIES',
    ])('classifies %s as a conservative lexical warning', (proposed) => {
      expect(classifyCompanyNameMatch(proposed, ABACON)).toBe('SIMILAR_WARNING');
      expect(areCompanyNamesSimilar(proposed, ABACON)).toBe(true);
    });
  });

  describe('observed available variants stay unflagged', () => {
    it.each([
      'ABACON CONSULTINGS',
      'ABACON CONSULTING GLOBAL',
      'ABACON CONSULTIN',
      'ABACON CONSULTINGG',
      'ABACON CONSULTANG',
      'ABACON CONSUTLING',
      'ABACON KONSULTING',
      'MY ABACON CONSULTING',
      'ABACON DIGITAL CONSULTING',
      'ABACON CONSULTING SOLUTIONS',
      'CONSULTING ABACON',
      'ABACO CONSULTING',
      'ABACON CONSULTING SERVICES',
      'ABACON ADVISORY',
      'ABACON CONSULTING XYZ',
      'ABACON CONSULT',
      'ABACON CONSULTS',
      'ABACON CONSULTED',
      'ABACON CONSULTATIVE',
      'ABACONS CONSULTING',
      "ABACON'S CONSULTING",
      'ABACONS CONSULTINGS',
      'ABACON CONSULTING(S)',
      'ABACON CONSULTANT SERVICES',
      'ABACON DIGITAL CONSULTANT',
      'MY ABACON CONSULTANT',
      'CONSULTANT ABACON',
      'ABACON GROUP CONSULTING',
      'ABACON INTERNATIONAL CONSULTING',
      'ABACON CONSULTING APAC',
      'ABACON CONSULTING HLDGS',
      'ABACON CONSULTING ASSOC',
      'ABACON CONSULTING SGP',
      'ABACON CONSULTING WW',
      'ABACON SG CONSULTING',
      'SG ABACON CONSULTING',
      'ABACON WORLDWIDE CONSULTING',
    ])('does not over-match %s against ABACON', (proposed) => {
      expect(classifyCompanyNameMatch(proposed, ABACON)).toBeNull();
    });

    it.each([
      'OAKTREES ACCOUNTING & CORPORATE SOLUTIONS',
      'OAKTREE ACCOUNTING & CORPORATES SOLUTIONS',
      'OAKTREE ACCOUNTING & CORPORATE SOLUTIONSS',
      'OAKTREE ACCOUNTING & CORPORATE SOLUTONS',
      'OAKTREE ACCOUNTING & CORPORATE SOLUTIONS GLOBAL',
    ])('does not over-match %s against OAKTREE', (proposed) => {
      expect(classifyCompanyNameMatch(proposed, OAKTREE)).toBeNull();
    });
  });

  it('keeps SG terminal-only while treating literal Singapore as globally disregarded', () => {
    expect(canonicalizeCompanyName('ABACON CONSULTING SG').identicalKey)
      .toBe(canonicalizeCompanyName(ABACON).identicalKey);
    expect(canonicalizeCompanyName('ABACON SG CONSULTING').identicalKey)
      .not.toBe(canonicalizeCompanyName(ABACON).identicalKey);
    expect(canonicalizeCompanyName('ABACON SINGAPORE CONSULTING').identicalKey)
      .toBe(canonicalizeCompanyName(ABACON).identicalKey);
  });

  it('strips ignored terminal expressions iteratively', () => {
    expect(canonicalizeCompanyName('ABACON CONSULTING GROUP INTERNATIONAL').identicalKey)
      .toBe(canonicalizeCompanyName(ABACON).identicalKey);
    expect(canonicalizeCompanyName('ABACON CONSULTING INTERNATIONAL GROUP').identicalKey)
      .toBe(canonicalizeCompanyName(ABACON).identicalKey);
  });

  it('does not implement generic trailing-s or typo matching', () => {
    expect(canonicalizeCompanyName('ABACONS CONSULTING').identicalKey)
      .not.toBe(canonicalizeCompanyName(ABACON).identicalKey);
    expect(canonicalizeCompanyName('ABACON CONSULTINGS').identicalKey)
      .not.toBe(canonicalizeCompanyName(ABACON).identicalKey);
    expect(areCompanyNamesSimilar('ABACON CONSULTANG', ABACON)).toBe(false);
  });

  it('recognizes the empirically confirmed restricted/review token without broad overblocking', () => {
    expect(requiresCompanyNameReview('ABACON CONSULTING INC')).toBe(true);
    expect(requiresCompanyNameReview('ABACON CONSULTING INTERNATIONAL')).toBe(false);
    expect(requiresCompanyNameReview('ABACON CONSULTING APAC')).toBe(false);
  });
});
