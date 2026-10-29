'use client';

import { useRouter } from 'next/navigation';
import { NewPipelineWorkspace } from '@/components/tasks/pipelines/pipeline-workspace';

export default function NewPipelinePage() {
  const router = useRouter();
  return <NewPipelineWorkspace onSaved={() => router.push('/pipelines')} onCancel={() => router.push('/pipelines')} />;
}
