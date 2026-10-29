import { redirect } from 'next/navigation';

type TemplateLibraryIndexPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Document Templates and Partials have their own pages. This index keeps old
 * links and bookmarks working, including the retired `?tab=` switch.
 */
export default async function TemplateLibraryIndexPage({ searchParams }: TemplateLibraryIndexPageProps) {
  const tab = (await searchParams).tab;
  const selectedTab = Array.isArray(tab) ? tab[0] : tab;

  if (selectedTab === 'services') redirect('/admin/services');
  if (selectedTab === 'partials') redirect('/template-partials/partials');
  redirect('/template-partials/documents');
}
