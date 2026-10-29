import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Centralized company selection store for filtering documents and other company-scoped data.
 * This store manages the selected company context across the application.
 */
interface CompanySelectionState {
  // Selected company ID
  selectedCompanyId: string;
  // Selected company name for display
  selectedCompanyName: string | null;

  // Actions
  setSelectedCompany: (companyId: string, companyName?: string) => void;
  clearSelectedCompany: () => void;
}

export const useCompanyStore = create<CompanySelectionState>()(
  persist(
    (set) => ({
      // Initial state - empty means "all companies"
      selectedCompanyId: '',
      selectedCompanyName: null,

      // Actions
      setSelectedCompany: (companyId, companyName) =>
        set({ selectedCompanyId: companyId, selectedCompanyName: companyName || null }),

      clearSelectedCompany: () =>
        set({ selectedCompanyId: '', selectedCompanyName: null }),
    }),
    {
      name: 'oakcloud-company-selection',
      // Persist company selection for user convenience
      partialize: (state) => ({
        selectedCompanyId: state.selectedCompanyId,
        selectedCompanyName: state.selectedCompanyName,
      }),
    }
  )
);
