import { describe, expect, it } from 'vitest';
import { getCompanyFolderName, getCompanyFolderSearchTerm } from '@/lib/sharepoint/company-folder-search';

describe('getCompanyFolderSearchTerm', () => {
  it.each([
    ['AI 4 Solution Pte Ltd', 'AI 4 Solution'],
    ['Meridian Advisory Pte. Ltd.', 'Meridian Advisory'],
    ['Acme Private Limited', 'Acme'],
    ['Acme Holdings LLP', 'Acme Holdings'],
    ['Acme Co., Ltd.', 'Acme'],
  ])('strips terminal legal suffixes from %s', (companyName, expected) => {
    expect(getCompanyFolderSearchTerm(companyName)).toBe(expected);
  });

  it('keeps a name that consists only of a legal suffix', () => {
    expect(getCompanyFolderSearchTerm('Pte Ltd')).toBe('Pte Ltd');
  });

  it.each([
    ['Meridian Advisory Pte. Ltd.', 'Meridian Advisory Pte. Ltd'],
    ['AI 4 Solution Pte Ltd', 'AI 4 Solution Pte Ltd'],
  ])('keeps the full company name while removing SharePoint-invalid terminal periods from %s', (companyName, expected) => {
    expect(getCompanyFolderName(companyName)).toBe(expected);
  });
});
