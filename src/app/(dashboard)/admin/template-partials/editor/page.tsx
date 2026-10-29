import { redirect } from 'next/navigation';

type LegacyTemplateEditorPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyTemplateEditorPage({
  searchParams,
}: LegacyTemplateEditorPageProps) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }

  const query = params.toString();
  redirect(`/template-partials/editor${query ? `?${query}` : ''}`);
}
