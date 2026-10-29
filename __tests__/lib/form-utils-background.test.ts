import { describe, expect, it } from 'vitest';
import { buildPublicFormSettings } from '@/lib/form-utils';

describe('form-utils public background settings', () => {
  it('does not add background keys when no settings exist', () => {
    expect(buildPublicFormSettings(null)).not.toHaveProperty('backgroundImageUrl');
    expect(buildPublicFormSettings(null)).not.toHaveProperty('backgroundImageOpacity');
    expect(buildPublicFormSettings(undefined)).not.toHaveProperty('backgroundImageUrl');
    expect(buildPublicFormSettings(undefined)).not.toHaveProperty('backgroundImageOpacity');
  });

  it('normalizes a raw background storage key to the app URL', () => {
    const settings = buildPublicFormSettings({
      backgroundImageUrl: 'tenant-1/forms/form-1/branding/background.png',
    });
    expect(settings?.backgroundImageUrl)
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('defaults opacity to 40 when an image is set without opacity', () => {
    const settings = buildPublicFormSettings({
      backgroundImageUrl: '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png',
    });
    expect(settings?.backgroundImageOpacity).toBe(40);
  });

  it('clamps and rounds opacity to an integer between 0 and 100', () => {
    expect(buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: 150 })?.backgroundImageOpacity).toBe(100);
    expect(buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: -5 })?.backgroundImageOpacity).toBe(0);
    expect(buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: 12.6 })?.backgroundImageOpacity).toBe(13);
  });

  it('preserves an explicit opacity of 0', () => {
    const settings = buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: 0 });
    expect(settings?.backgroundImageOpacity).toBe(0);
  });

  it('omits background keys when neither image nor opacity is configured', () => {
    const settings = buildPublicFormSettings({ hideFooter: true });
    expect(settings).not.toHaveProperty('backgroundImageUrl');
    expect(settings).not.toHaveProperty('backgroundImageOpacity');
  });
});
