'use client';

import { useRouter } from 'next/navigation';
import { PipelinesListWorkspace } from '@/components/tasks/pipelines/pipeline-workspace';

export default function PipelinesPage() { const router = useRouter(); return <PipelinesListWorkspace onCreate={() => router.push('/pipelines/new')} onEdit={(id) => router.push(`/pipelines/${id}`)} />; }
