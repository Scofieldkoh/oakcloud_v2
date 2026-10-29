'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Building2, BriefcaseBusiness, Contact, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type TabId = 'profile' | 'contacts' | 'services';

interface Tab {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const tabs: Tab[] = [
  { id: 'profile', label: 'Company Profile', icon: Building2 },
  { id: 'contacts', label: 'Contact Details', icon: Contact },
  { id: 'services', label: 'Services', icon: BriefcaseBusiness },
];

interface CompanyTabsProps {
  activeTab: TabId;
  onTabChange: (tabId: TabId) => void;
  hasPoc?: boolean;
  hasFye?: boolean;
}

export function CompanyTabs({ activeTab, onTabChange, hasPoc, hasFye }: CompanyTabsProps) {
  return (
    <div role="tablist" aria-label="Company sections" className="mb-6 flex items-center overflow-x-auto overflow-y-hidden border-b border-border-primary">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        // Show warning for contacts tab when no POC
        const showContactsWarning = tab.id === 'contacts' && hasPoc === false;
        // Show warning for profile tab when no FYE
        const showProfileWarning = tab.id === 'profile' && hasFye === false;
        const showWarning = showContactsWarning || showProfileWarning;
        const warningTitle = showContactsWarning ? 'POC required' : showProfileWarning ? 'Financial year end required' : '';
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`flex min-h-11 shrink-0 items-center gap-2 px-4 py-2.5 text-sm transition-colors sm:min-h-0 ${
              isActive
                ? 'text-text-primary border-b-2 border-oak-light -mb-px font-medium'
                : 'text-text-muted hover:bg-background-secondary hover:text-text-primary'
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
            {showWarning && (
              <span className="text-amber-500" title={warningTitle}>
                <AlertTriangle className="w-4 h-4" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Custom hook for URL-persisted tab state
export function useTabState(): [TabId, (tabId: TabId) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Get current tab from URL, default to 'profile'.
  // Supports removed legacy contract/deadline tabs by mapping them to `profile`.
  const tabParam = searchParams.get('tab');
  const remappedTab =
    tabParam === 'contracts' || tabParam === 'deadlines'
      ? 'profile'
      : tabParam;
  const currentTab = remappedTab as TabId | null;
  const validTabs: TabId[] = ['profile', 'contacts', 'services'];
  const validTab: TabId = currentTab && validTabs.includes(currentTab) ? currentTab : 'profile';

  // Update URL when tab changes
  const setTab = useCallback((tabId: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tabId === 'profile') {
      // Remove tab param for default tab to keep URL clean
      params.delete('tab');
    } else {
      params.set('tab', tabId);
    }
    const queryString = params.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  return [validTab, setTab];
}
