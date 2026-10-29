import { EsigningDetailPage } from '@/components/esigning/esigning-detail-page';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <EsigningDetailPage envelopeId={id} />;
}

