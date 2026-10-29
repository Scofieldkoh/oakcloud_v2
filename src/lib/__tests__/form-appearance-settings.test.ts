import { describe, expect, it } from 'vitest';
import { buildPublicFormSettings, parseFormAppearanceSettings } from '@/lib/form-utils';

describe('form appearance settings', () => {
  it('defaults to solid panels and the standard heading colour', () => {
    expect(parseFormAppearanceSettings(null)).toEqual({
      backgroundImageUrl: null,
      backgroundImageOpacity: 40,
      panelOpacity: 100,
      headingColor: null,
    });
  });

  it('clamps panel opacity and accepts only six-digit hex colours', () => {
    expect(parseFormAppearanceSettings({ panelOpacity: 140, headingColor: '#ffffff' })).toMatchObject({
      panelOpacity: 100,
      headingColor: '#FFFFFF',
    });
    expect(parseFormAppearanceSettings({ panelOpacity: 35.6, headingColor: 'red;background:url(x)' })).toMatchObject({
      panelOpacity: 36,
      headingColor: null,
    });
  });

  it('passes panel opacity and heading colour to the public form only when set', () => {
    expect(buildPublicFormSettings({ panelOpacity: 60, headingColor: '#F5F5F5' })).toMatchObject({
      panelOpacity: 60,
      headingColor: '#F5F5F5',
    });
    const defaults = buildPublicFormSettings({ panelOpacity: 100, headingColor: null });
    expect(defaults).not.toHaveProperty('panelOpacity');
    expect(defaults).not.toHaveProperty('headingColor');
  });
});
