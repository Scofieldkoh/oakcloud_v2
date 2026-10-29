import { describe, expect, it } from 'vitest';
import { prepareCompanyContext, resolvePlaceholders } from '@/lib/placeholder-resolver';
import { buildEachBlock, type TemplateCollection, type TemplateLoopLayout } from '@/components/documents/template-editor/template-builders';

describe('placeholder resolver', () => {
  it('resolves independent selected parties and preparer aliases', () => {
    const result = resolvePlaceholders(
      [
        '{{selectedDirector.name}}|{{selectedDirector.email}}|{{selectedDirector.address.letter}}',
        '{{selectedDirector.role}}|{{selectedShareholder.name}}|{{selectedShareholder.shareClass}}|{{selectedContact.phone}}',
        '{{system.preparerName}}|{{system.generatedBy}}',
      ].join('|'),
      {
        selectedDirector: { id: 'd1', contactId: 'c1', name: 'Alice', detail: 'DIRECTOR', role: 'DIRECTOR', email: 'alice@example.com', phone: null, address: { full: 'One Road', letter: 'One Road' } },
        selectedShareholder: { id: 's1', contactId: 'c2', name: 'Ben', detail: 'ORDINARY', shareClass: 'ORDINARY', email: null, phone: null, address: { full: null, letter: null } },
        selectedContact: { id: 'c3', contactId: 'c3', name: 'Cara', detail: 'Representative', email: null, phone: '+65 6123 4567', address: { full: null, letter: null } },
        system: { currentDate: new Date('2026-07-16'), preparerName: 'Test User', generatedBy: 'Test User' },
      }
    );
    expect(result.resolved).toContain('Alice|alice@example.com|One Road');
    expect(result.resolved).toContain('DIRECTOR|Ben|ORDINARY|+65 6123 4567|Test User|Test User');
    expect(result.missing).toEqual([]);
  });

  it('adds contact fields to current director and shareholder loops', () => {
    const context = prepareCompanyContext({
      id: 'company-1',
      name: 'Sample',
      uen: '202600001A',
      officers: [{
        name: 'Alice', role: 'DIRECTOR', address: 'One Road', isCurrent: true,
        contact: { id: 'c1', fullAddress: null, contactDetails: [{ detailType: 'EMAIL', value: 'alice@example.com', companyId: null }] },
      }],
      shareholders: [{
        name: 'Ben', numberOfShares: 1, address: 'Two Road', isCurrent: true,
        contact: { id: 'c2', fullAddress: null, contactDetails: [{ detailType: 'PHONE', value: '+65 6000 0000', companyId: null }] },
      }],
    });
    const result = resolvePlaceholders(
      '{{#each directors}}{{email}}|{{letterAddress}}{{/each}}/{{#each shareholders}}{{phone}}|{{letterAddress}}{{/each}}',
      context
    );
    expect(result.resolved).toBe('alice@example.com|One Road/+65 6000 0000|Two Road');
  });

  it('renders letter-address newlines as safe HTML breaks', () => {
    const result = resolvePlaceholders(
      '{{company.address.letter}}',
      {
        company: {
          id: 'company-1',
          name: 'Sample',
          uen: '202600001A',
          address: {
            block: '21',
            street: 'Bukit Batok Crescent',
            level: '25',
            unit: '72',
            building: 'WCEGA <Tower>',
            postalCode: '658065',
            letter: 'WCEGA <Tower>\n21 Bukit Batok Crescent, #25-72\nSingapore  658065',
          },
        },
      }
    );
    expect(result.resolved).toBe('WCEGA &lt;Tower&gt;<br>21 Bukit Batok Crescent, #25-72<br>Singapore  658065');
  });

  it('derives company letter address from structured preview fields', () => {
    const result = resolvePlaceholders(
      '{{company.address.letter}}',
      {
        company: {
          id: 'company-1',
          name: 'Sample Company Pte Ltd',
          uen: '202600001A',
          registeredAddress: '123 Sample Street, #01-01, Sample Building, Singapore 123456',
          address: {
            block: '123',
            street: 'Sample Street',
            level: '01',
            unit: '01',
            building: 'Sample Building',
            postalCode: '123456',
          },
        },
      },
    );

    expect(result.resolved).toBe(
      'Sample Building<br>123 Sample Street, #01-01<br>Singapore  123456',
    );
    expect(result.missing).toEqual([]);
  });

  it('derives company letter address from the document-template preview address collection', () => {
    const result = resolvePlaceholders(
      '{{company.address.letter}}',
      {
        company: {
          id: 'company-1',
          name: 'Sample Company Pte Ltd',
          uen: '202600001A',
          registeredAddress: '123 Sample Street, #01-01, Sample Building, Singapore 123456',
          addresses: [{
            addressType: 'REGISTERED_OFFICE',
            fullAddress: '123 Sample Street, #01-01, Sample Building, Singapore 123456',
            isCurrent: true,
            block: '123',
            streetName: 'Sample Street',
            level: '01',
            unit: '01',
            buildingName: 'Sample Building',
            postalCode: '123456',
            country: 'Singapore',
          }],
        },
      },
    );

    expect(result.resolved).toBe(
      'Sample Building<br>123 Sample Street, #01-01<br>Singapore  123456',
    );
    expect(result.missing).toEqual([]);
  });

  it.each([
    ['directors', 'paragraphs'], ['directors', 'bullets'], ['directors', 'table'],
    ['shareholders', 'paragraphs'], ['shareholders', 'bullets'], ['shareholders', 'table'],
  ] as Array<[TemplateCollection, TemplateLoopLayout]>)('resolves generated %s %s loops without raw syntax or escaped structural HTML', (collection, layout) => {
    const fields = collection === 'directors'
      ? ['name', 'identificationNumber', 'nationality', 'role', 'address']
      : ['name', 'identificationNumber', 'nationality', 'shareClass', 'numberOfShares', 'percentageHeld'];
    const template = buildEachBlock({ collection, fields, layout });
    const result = resolvePlaceholders(template, {
      directors: [{ name: 'Alice Director', identificationNumber: 'D1', nationality: 'SG', role: 'Director', address: 'One Road' } as never],
      shareholders: [{ name: 'Bob Shareholder', identificationNumber: 'S1', nationality: 'SG', shareClass: 'Ordinary', numberOfShares: 10, percentageHeld: 100 } as never],
    });

    expect(result.resolved).toContain(collection === 'directors' ? 'Alice Director' : 'Bob Shareholder');
    expect(result.resolved).not.toContain('{{');
    expect(result.resolved).not.toContain('&lt;table');
    expect(result.resolved).not.toContain('&lt;ul');
    expect(result.missing).toEqual([]);
  });

  it('expands a sanitizer-safe table row-group loop for authorised representatives', () => {
    const result = resolvePlaceholders(
      '<table><tbody data-template-each="authorizedRepresentatives"><tr><td>{{this.name}}</td><td>{{this.email}}</td></tr></tbody></table>',
      {
        authorizedRepresentatives: [
          { id: 'c1', name: 'Alex Tan', role: 'Director', email: 'alex@example.com', phone: null },
          { id: 'c2', name: 'Bea Lim', role: 'Manager', email: 'bea@example.com', phone: null },
        ] as never,
      },
    );

    expect(result.resolved).toBe(
      '<table><tbody><tr><td>Alex Tan</td><td>alex@example.com</td></tr></tbody><tbody><tr><td>Bea Lim</td><td>bea@example.com</td></tr></tbody></table>',
    );
    expect(result.missing).toEqual([]);
  });
  it('supports one-based @number inside each blocks', () => {
    const result = resolvePlaceholders(
      '{{#each directors}}<p>{{@number}}. {{name}}</p>{{/each}}',
      {
        directors: [
          { name: 'Alice Tan', role: 'DIRECTOR', isCurrent: true },
          { name: 'Ben Lim', role: 'DIRECTOR', isCurrent: true },
        ],
      }
    );

    expect(result.resolved).toContain('<p>1. Alice Tan</p>');
    expect(result.resolved).toContain('<p>2. Ben Lim</p>');
    expect(result.missing).toEqual([]);
  });

  it('supports PCASE modifiers used by the template editor', () => {
    const result = resolvePlaceholders(
      '<p>{{PCASE(company.name)}}</p><p>PCASE({{company.status}})</p>',
      {
        company: {
          id: 'company-1',
          name: 'SAMPLE COMPANY PTE LTD',
          uen: '202600001A',
          status: 'LIVE COMPANY',
        },
      }
    );

    expect(result.resolved).toContain('<p>Sample Company Pte Ltd</p>');
    expect(result.resolved).toContain('<p>Live Company</p>');
    expect(result.missing).toEqual([]);
  });

  it('normalizes designations while preserving executive acronyms', () => {
    const result = resolvePlaceholders(
      [
        '{{DESIGNATION(selectedDirector.role)}}',
        '{{DESIGNATION(selectedShareholder.detail)}}',
        'DESIGNATION({{selectedContact.detail}})',
      ].join('|'),
      {
        selectedDirector: { id: 'd1', contactId: 'c1', name: 'Alice', detail: 'DIRECTOR', role: 'CEO', email: null, phone: null, address: { full: null, letter: null } },
        selectedShareholder: { id: 's1', contactId: 'c2', name: 'Ben', detail: 'CFO', shareClass: 'ORDINARY', email: null, phone: null, address: { full: null, letter: null } },
        selectedContact: { id: 'c3', contactId: 'c3', name: 'Cara', detail: 'DIRECTOR OF FINANCE', email: null, phone: null, address: { full: null, letter: null } },
        system: { currentDate: new Date('2026-07-16'), preparerName: 'Test User', generatedBy: 'Test User' },
      }
    );

    expect(result.resolved).toContain('CEO|CFO|Director of Finance');
    expect(result.resolved).not.toContain('Ceo');
    expect(result.resolved).not.toContain('Cfo');
    expect(result.missing).toEqual([]);
  });

  it('normalizes every-day designations to title case', () => {
    const result = resolvePlaceholders(
      '<p>{{DESIGNATION(selectedDirector.detail)}}</p><p>DESIGNATION({{selectedDirector.role}})</p>',
      {
        selectedDirector: { id: 'd1', contactId: 'c1', name: 'Alice', detail: 'MANAGING DIRECTOR', role: 'company secretary', email: null, phone: null, address: { full: null, letter: null } },
      }
    );

    expect(result.resolved).toContain('<p>Managing Director</p>');
    expect(result.resolved).toContain('<p>Company Secretary</p>');
    expect(result.missing).toEqual([]);
  });

  it('normalizes doubly-nested modifier syntax without leaking stray placeholders', () => {
    const result = resolvePlaceholders(
      '<p>{{DESIGNATION({{selectedContact.detail}})}}</p>',
      {
        selectedContact: { id: 'c1', contactId: 'c1', name: 'Cara', detail: 'CEO', email: null, phone: null, address: { full: null, letter: null } },
      }
    );

    expect(result.resolved).toBe('<p>CEO</p>');
    expect(result.resolved).not.toContain('{{');
    expect(result.missing).toEqual([]);
  });

  it('normalizes doubly-nested modifiers inside each blocks', () => {
    const result = resolvePlaceholders(
      '{{#each directors}}<p>{{DESIGNATION({{this.role}})}}</p>{{/each}}',
      {
        directors: [{ name: 'Alice', role: 'DIRECTOR', isCurrent: true }],
      }
    );

    expect(result.resolved).toContain('<p>Director</p>');
    expect(result.resolved).not.toContain('{{');
    expect(result.missing).toEqual([]);
  });

  it('applies DESIGNATION to selected Service Agreement representative roles', () => {
    const representative = {
      id: 'contact-1',
      contactId: 'contact-1',
      name: 'Alex Tan',
      detail: 'MANAGING DIRECTOR',
      role: 'MANAGING DIRECTOR',
      email: null,
      phone: null,
      address: { full: null, letter: null },
    };
    const result = resolvePlaceholders(
      '{{#each authorizedRepresentatives}}<p>{{DESIGNATION(this.role)}}</p>{{/each}}'
        + '{{#each signers}}<p>{{DESIGNATION(this.role)}}</p>{{/each}}',
      {
        authorizedRepresentatives: [representative],
        signers: [{ ...representative, role: 'CEO', detail: 'CEO' }],
      },
    );

    expect(result.resolved).toBe('<p>Managing Director</p><p>CEO</p>');
    expect(result.missing).toEqual([]);
  });

  it('resolves external modifiers when the editor wraps the placeholder in inline HTML', () => {
    const result = resolvePlaceholders(
      '<p>PCASE(<span style="color: rgb(0, 0, 0); font-weight: 400;">{{company.name}}</span>)</p>',
      {
        company: {
          id: 'company-1',
          name: 'SAMPLE COMPANY PTE LTD',
          uen: '202600001A',
          status: 'LIVE COMPANY',
        },
      }
    );

    expect(result.resolved).toBe('<p>Sample Company Pte Ltd</p>');
    expect(result.resolved).not.toContain('PCASE');
    expect(result.resolved).not.toContain('{{');
    expect(result.missing).toEqual([]);
  });

  it('resolves external modifiers inside each blocks when wrapped in inline HTML', () => {
    const result = resolvePlaceholders(
      '{{#each directors}}<p>PCASE(<span>{{this.name}}</span>)</p>{{/each}}',
      {
        directors: [
          {
            name: 'JOHN TAN WEI MING',
            role: 'DIRECTOR',
            isCurrent: true,
          },
        ],
      }
    );

    expect(result.resolved).toContain('<p>John Tan Wei Ming</p>');
    expect(result.resolved).not.toContain('PCASE');
    expect(result.resolved).not.toContain('{{');
    expect(result.missing).toEqual([]);
  });

  it('supports equality and inequality conditionals', () => {
    const result = resolvePlaceholders(
      [
        '{{#if company.entityType == "Private Limited"}}<p>Private</p>{{/if}}',
        '{{#if company.status != "Struck Off"}}<p>Live</p>{{/if}}',
      ].join(''),
      {
        company: {
          id: 'company-1',
          name: 'Sample Company Pte Ltd',
          uen: '202600001A',
          entityType: 'Private Limited',
          status: 'Live',
        },
      }
    );

    expect(result.resolved).toBe('<p>Private</p><p>Live</p>');
    expect(result.resolved).not.toContain('{{#if');
  });

  it('prepares address parts and capital aliases advertised by the editor', () => {
    const context = prepareCompanyContext({
      id: 'company-1',
      name: 'Sample Company Pte Ltd',
      uen: '202600001A',
      paidUpCapitalAmount: 100000,
      addresses: [
        {
          addressType: 'REGISTERED_OFFICE',
          fullAddress: '123 Sample Street, #04-05, Sample Building, Singapore 123456',
          isCurrent: true,
          block: '123',
          streetName: 'Sample Street',
          level: '04',
          unit: '05',
          buildingName: 'Sample Building',
          postalCode: '123456',
        } as never,
      ],
    });

    const result = resolvePlaceholders(
      [
        '{{company.address.block}}',
        '{{company.address.street}}',
        '{{company.address.level}}',
        '{{company.address.unit}}',
        '{{company.address.building}}',
        '{{company.address.postalCode}}',
        '{{company.capital}}',
      ].join('|'),
      context
    );

    expect(result.resolved).toBe('123|Sample Street|04|05|Sample Building|123456|100,000');
    expect(result.missing).toEqual([]);
  });
});
