'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  parseObject,
  parseChoiceOptions,
  type PublicFormField as PublicField,
} from '@/lib/form-utils';
import { cn } from '@/lib/utils';
import DOMPurify from 'dompurify';
import { richTextToPlainText, highlightRichTextHtml } from '../_lib/rich-text';
import { getDefaultFaqExpandedIds } from '../_lib/render-groups';

export function FaqField({ field }: { field: PublicField }) {
  const validation = parseObject(field.validation);
  const defaultState = typeof validation?.faqDefaultState === 'string' ? validation.faqDefaultState : 'collapsed';
  const searchEnabled = validation?.faqSearchEnabled !== false;
  const mainToggleEnabled = validation?.faqMainToggleEnabled === true;
  const mainDefaultExpanded = !mainToggleEnabled || validation?.faqMainDefaultExpanded === true;
  const items = useMemo(() => (
    parseChoiceOptions(field.options).map((option, index) => ({
      id: option.value || `${field.id}-${index}`,
      headerHtml: option.label || `Question ${index + 1}`,
      bodyHtml: option.bodyHtml || '',
      searchableText: `${richTextToPlainText(option.label || '')} ${richTextToPlainText(option.bodyHtml || '')}`.toLowerCase(),
    }))
  ), [field.id, field.options]);

  const [mainExpanded, setMainExpanded] = useState(mainDefaultExpanded);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => getDefaultFaqExpandedIds(items, defaultState));
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  useEffect(() => {
    setMainExpanded(mainDefaultExpanded);
  }, [field.id, mainDefaultExpanded]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (debouncedSearchTerm) return;
    setExpandedItemIds(getDefaultFaqExpandedIds(items, defaultState));
  }, [items, defaultState, debouncedSearchTerm]);

  const normalizedSearchTerm = debouncedSearchTerm.toLowerCase();
  const visibleItems = useMemo(() => (
    normalizedSearchTerm
      ? items.filter((item) => item.searchableText.includes(normalizedSearchTerm))
      : items
  ), [items, normalizedSearchTerm]);

  useEffect(() => {
    if (!normalizedSearchTerm) return;
    setExpandedItemIds(new Set(visibleItems.map((item) => item.id)));
  }, [normalizedSearchTerm, visibleItems]);

  function toggleItem(itemId: string) {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  function expandAll() {
    setExpandedItemIds(new Set(visibleItems.map((item) => item.id)));
  }

  function collapseAll() {
    setExpandedItemIds(new Set());
  }

  const headerContent = field.label || 'Commonly Asked Questions';
  const bodyVisible = !mainToggleEnabled || mainExpanded;

  return (
    <div key={field.id} className="rounded-lg border border-[#D8E3DF] bg-[#F8FAF9] shadow-sm">
      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
          !mainToggleEnabled && 'cursor-default'
        )}
        onClick={() => {
          if (mainToggleEnabled) setMainExpanded((current) => !current);
        }}
        aria-expanded={bodyVisible}
      >
        <div
          className="form-rich-render faq-rich-header text-sm text-text-primary"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(headerContent) }}
        />
        {mainToggleEnabled && (
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200', bodyVisible && 'rotate-180')} />
        )}
      </button>

      {bodyVisible && (
        <div className="space-y-3 border-t border-border-primary/70 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {searchEnabled ? (
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search FAQ"
                className="min-h-10 flex-1 rounded-lg border border-[#D8E3DF] bg-[#F4F7F6] px-3 py-2 text-sm text-text-primary outline-none transition-all duration-150 focus:border-[#294D44] focus:ring-2 focus:ring-[#294D44]/20"
              />
            ) : <div />}
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="rounded border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                onClick={expandAll}
              >
                Expand all
              </button>
              <button
                type="button"
                className="rounded border border-border-primary bg-background-primary px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary"
                onClick={collapseAll}
              >
                Collapse all
              </button>
            </div>
          </div>

          {visibleItems.length === 0 ? (
            <p className="rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-secondary">
              No matching questions.
            </p>
          ) : (
            <div className="divide-y divide-border-primary overflow-hidden rounded-lg border border-border-primary bg-background-primary">
              {visibleItems.map((item) => {
                const isExpanded = expandedItemIds.has(item.id);
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-background-secondary/70"
                      onClick={() => toggleItem(item.id)}
                      aria-expanded={isExpanded}
                    >
                      <div
                        className="form-rich-render faq-rich-header text-sm font-medium text-text-primary"
                        dangerouslySetInnerHTML={{ __html: highlightRichTextHtml(item.headerHtml, debouncedSearchTerm) }}
                      />
                      <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-text-secondary transition-transform duration-200', isExpanded && 'rotate-180')} />
                    </button>
                    {isExpanded && (
                      <div
                        className="form-rich-render px-3 pb-3 text-sm text-text-secondary"
                        dangerouslySetInnerHTML={{ __html: highlightRichTextHtml(item.bodyHtml, debouncedSearchTerm) }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
