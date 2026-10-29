/** Grouping public form fields into cards and standalone items for rendering. */

import { parseObject, type PublicFormField as PublicField } from '@/lib/form-utils';
import { CARD_ELIGIBLE_TYPES } from './constants';
import { type RenderGroup, type RenderItem } from './types';
import { isRepeatStartMarker, isRepeatEndMarker, isBlockDivider } from './field-config';

export function isFaqField(field: Pick<PublicField, 'type' | 'inputType'>): boolean {
  return field.type === 'PARAGRAPH' && field.inputType === 'info_faq';
}

export function isHeadingInfoBlock(field: PublicField): boolean {
  return field.type === 'PARAGRAPH' && (
    field.inputType === 'info_heading_1' ||
    field.inputType === 'info_heading_2' ||
    field.inputType === 'info_heading_3'
  );
}

export function isInlineInfoBlock(field: PublicField): boolean {
  const validation = parseObject(field.validation);
  return field.type === 'PARAGRAPH' && validation?.infoInlineCard === true;
}

export function buildRenderGroups(fields: PublicField[]): RenderItem[] {
  const items: RenderItem[] = [];
  let currentGroup: RenderGroup | null = null;

  function flushGroup() {
    // Push group if it has fields OR a heading (heading-only groups still render the heading above an empty card slot)
    if (currentGroup && (currentGroup.fields.length > 0 || currentGroup.heading !== null)) {
      items.push(currentGroup);
    }
    currentGroup = null;
  }

  for (const field of fields) {
    // Hidden fields are pass-through standalone items.
    if (field.type === 'HIDDEN') {
      items.push({ kind: 'standalone', field });
      continue;
    }

    if (isBlockDivider(field)) {
      flushGroup();
      continue;
    }

    // Dynamic section start marker should stay inside the current card flow as a full-width row.
    if (isRepeatStartMarker(field)) {
      if (!currentGroup) {
        currentGroup = { kind: 'group', heading: null, fields: [] };
      }
      currentGroup.fields.push(field);
      continue;
    }

    // Dynamic section end marker is structural only; skip card grouping.
    if (isRepeatEndMarker(field)) {
      continue;
    }

    // Normal page breaks separate groups/pages.
    if (field.type === 'PAGE_BREAK') {
      flushGroup();
      items.push({ kind: 'standalone', field });
      continue;
    }

    // Note: repeat section markers (inputType === 'repeat_start'/'repeat_end') are PAGE_BREAK fields,
    // already captured as standalone above. They are handled in renderStandaloneField.

    if (isInlineInfoBlock(field)) {
      if (!currentGroup) {
        currentGroup = { kind: 'group', heading: null, fields: [] };
      }
      currentGroup.fields.push(field);
      continue;
    }

    // Heading blocks: flush current group, become next group's heading
    if (isHeadingInfoBlock(field)) {
      flushGroup();
      currentGroup = { kind: 'group', heading: field, fields: [] };
      continue;
    }

    // Other display-only content: standalone
    if (field.type === 'PARAGRAPH' || field.type === 'HTML') {
      flushGroup();
      items.push({ kind: 'standalone', field });
      continue;
    }

    // Card-eligible: add to current group (start one if needed)
    if (CARD_ELIGIBLE_TYPES.has(field.type)) {
      if (!currentGroup) {
        currentGroup = { kind: 'group', heading: null, fields: [] };
      }
      currentGroup.fields.push(field);
      continue;
    }

    // Anything else: standalone
    flushGroup();
    items.push({ kind: 'standalone', field });
  }

  flushGroup();
  return items;
}

export function getDefaultFaqExpandedIds(items: Array<{ id: string }>, defaultState: string): Set<string> {
  if (defaultState === 'expanded') {
    return new Set(items.map((item) => item.id));
  }
  if (defaultState === 'first_expanded' && items[0]) {
    return new Set([items[0].id]);
  }
  return new Set();
}
