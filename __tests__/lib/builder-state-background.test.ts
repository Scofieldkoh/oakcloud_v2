import { describe, expect, it } from 'vitest';
import { serializeBuilderState } from '@/components/forms/builder-utils';

const base = {
  title: 'Form',
  description: '',
  slug: 'my-form',
  status: 'DRAFT' as const,
  tags: [],
  fields: [],
};

describe('serializeBuilderState background fields', () => {
  it('includes background image settings', () => {
    const state = JSON.parse(serializeBuilderState({
      ...base,
      backgroundImageUrl: '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png',
      backgroundImageOpacity: 55,
    }));

    expect(state.backgroundImageUrl).toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
    expect(state.backgroundImageOpacity).toBe(55);
  });

  it('defaults background fields when absent', () => {
    const state = JSON.parse(serializeBuilderState(base));

    expect(state.backgroundImageUrl).toBeNull();
    expect(state.backgroundImageOpacity).toBe(40);
  });
});
