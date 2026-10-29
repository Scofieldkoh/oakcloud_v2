'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { ToastProvider, useToast, setToastHandler } from '@/components/ui/toast';
import { ThemeProvider } from '@/components/theme-provider';

// Component to set up toast handler for non-component contexts
function ToastHandlerSetup() {
  const toastContext = useToast();

  useEffect(() => {
    setToastHandler(toastContext);
  }, [toastContext]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // Keep data fresh briefly, while still refreshing on return/focus.
            gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache longer
            refetchOnWindowFocus: 'always',
            refetchOnMount: 'always',
            retry: 1, // Only retry once on failure
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <ToastHandlerSetup />
          {children}
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
