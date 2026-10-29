'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { TemplateSourcePage } from './template-source-page';

export default function TemplateEditorPage() {
  return (
    <Suspense
      fallback={(
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
        </div>
      )}
    >
      <TemplateSourcePage />
    </Suspense>
  );
}
