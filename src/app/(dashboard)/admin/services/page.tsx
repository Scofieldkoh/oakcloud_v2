import { redirect } from 'next/navigation';

type ServicesAdminIndexPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Service Catalog, Deadline Rules and Business Calendar have their own pages.
 * This index keeps old links and bookmarks working, including the retired
 * `?tab=` switch.
 */
export default async function ServicesAdminIndexPage({ searchParams }: ServicesAdminIndexPageProps) {
  const tab = (await searchParams).tab;
  const selectedTab = Array.isArray(tab) ? tab[0] : tab;

  if (selectedTab === 'rules' || selectedTab === 'deadline-rules') redirect('/admin/services/deadline-rules');
  if (selectedTab === 'calendar' || selectedTab === 'business-calendar') redirect('/admin/services/business-calendar');
  redirect('/admin/services/catalog');
}
