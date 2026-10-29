'use client';

import { cn } from '@/lib/utils';
import { hasHtmlMarkup, sanitizeGuidanceHtml } from '../_lib/rich-text';

export function FieldHint({ id, text, className }: { id?: string; text: string; className: string }) {
  if (hasHtmlMarkup(text)) {
    return (
      <div
        id={id}
        className={cn(className, 'form-rich-render [&_a]:font-medium [&_a]:text-oak-primary [&_a]:underline [&_a]:underline-offset-2')}
        dangerouslySetInnerHTML={{ __html: sanitizeGuidanceHtml(text) }}
      />
    );
  }
  return <p id={id} className={className}>{text}</p>;
}
