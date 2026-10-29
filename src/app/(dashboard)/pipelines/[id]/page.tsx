'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { EditPipelineWorkspace } from '@/components/tasks/pipelines/pipeline-workspace';

export default function EditPipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  return (
    <EditPipelineWorkspace
      pipelineId={id}
      onSaved={() => router.push('/pipelines')}
      onCancel={() => router.push('/pipelines')}
    />
  );
}
