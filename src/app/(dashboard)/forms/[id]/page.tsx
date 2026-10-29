import { redirect } from 'next/navigation';

interface FormIndexPageProps {
  params: Promise<{ id: string }>;
}

export default async function FormIndexPage({ params }: FormIndexPageProps) {
  const { id } = await params;
  redirect(`/forms/${id}/responses`);
}
