/**
 * Authentication Hooks
 *
 * React hooks for authentication, session management, and login/logout.
 * Uses TanStack Query for caching and automatic refetching.
 *
 * @module hooks/use-auth
 */

'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

/**
 * Authenticated user information from session
 */
export interface User {
  /** Unique user ID */
  id: string;
  /** User's email address */
  email: string;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** Workspace tenant ID */
  tenantId?: string | null;
  /** Workspace ID, currently backed by tenantId during the workspace migration */
  workspaceId?: string | null;
  internalRole: 'ADMIN' | 'MANAGER' | 'STAFF';
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
  /** Deprecated admin alias */
  isSuperAdmin: boolean;
  /** Deprecated admin alias */
  isWorkspaceAdmin: boolean;
  /** Array of company IDs the user has access to */
  companyIds: string[];
}

/**
 * Login request payload
 */
interface LoginCredentials {
  /** User's email address */
  email: string;
  /** User's password */
  password: string;
}

/**
 * Combined session + permissions response
 */
export interface SessionWithPermissions {
  user: User;
  permissions: string[];
  internalRole: 'ADMIN' | 'MANAGER' | 'STAFF';
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
  isSuperAdmin: boolean;
  isWorkspaceAdmin: boolean;
}

/**
 * Fetch session and permissions in a single API call
 * @returns Combined session and permissions data
 */
async function fetchSessionWithPermissions(): Promise<SessionWithPermissions | null> {
  const response = await fetch('/api/auth/session');
  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    throw new Error('Failed to fetch session');
  }
  return response.json();
}

interface LoginResponse {
  user: User;
  mustChangePassword: boolean;
}

async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  const data = await response.json();
  return { user: data.user, mustChangePassword: data.mustChangePassword };
}

async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Logout failed');
  }
}

/**
 * Hook to get the current user session
 *
 * @returns TanStack Query result with user data
 *
 * @example
 * ```tsx
 * const { data: user, isLoading } = useSession();
 *
 * if (isLoading) return <Spinner />;
 * if (!user) return <LoginPrompt />;
 *
 * return <div>Welcome, {user.firstName}!</div>;
 * ```
 */
export function useSession() {
  return useQuery<SessionWithPermissions | null, Error, User | null>({
    queryKey: ['session-with-permissions'],
    queryFn: fetchSessionWithPermissions,
    select: (data) => data?.user ?? null,
    staleTime: 10 * 60 * 1000, // 10 minutes - session rarely changes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: false,
  });
}

/**
 * Hook to get current user session AND permissions in a single API call
 *
 * This is more efficient than calling useSession() + usePermissions() separately
 * as it reduces the number of API calls from 2 to 1 on page load.
 *
 * @returns TanStack Query result with user, permissions, and role flags
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useSessionWithPermissions();
 *
 * if (isLoading) return <Spinner />;
 * if (!data) return <LoginPrompt />;
 *
 * const { user, permissions, isSuperAdmin } = data;
 * const canCreate = permissions.includes('company:create') || isSuperAdmin;
 * ```
 */
export function useSessionWithPermissions() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['session-with-permissions'],
    queryFn: fetchSessionWithPermissions,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: false,
  });

  useEffect(() => {
    if (query.data === undefined) return;

    queryClient.setQueryData(['permissions', undefined], query.data
      ? {
          permissions: query.data.permissions,
          isSuperAdmin: query.data.isSuperAdmin,
          isWorkspaceAdmin: query.data.isWorkspaceAdmin,
        }
      : { permissions: [], isSuperAdmin: false, isWorkspaceAdmin: false });
  }, [query.data, queryClient]);

  return query;
}

/**
 * Hook for logging in a user
 *
 * Handles authentication and redirects:
 * - On success: redirects to /companies (or /change-password if required)
 * - On error: throws error with message from server
 *
 * @returns Mutation object with mutate function
 *
 * @example
 * ```tsx
 * const login = useLogin();
 *
 * const handleSubmit = (data: LoginCredentials) => {
 *   login.mutate(data, {
 *     onError: (error) => toast.error(error.message),
 *   });
 * };
 * ```
 */
export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: login,
    onSuccess: (response) => {
      queryClient.setQueryData(['session'], response.user);
      queryClient.removeQueries({ queryKey: ['session-with-permissions'] });

      // Redirect to password change if required
      if (response.mustChangePassword) {
        router.push('/change-password?forced=true');
      } else {
        router.push('/companies');
      }
    },
  });
}

/**
 * Hook for logging out the current user
 *
 * Clears all cached data and redirects to login page.
 *
 * @returns Mutation object with mutate function
 *
 * @example
 * ```tsx
 * const logout = useLogout();
 *
 * <Button onClick={() => logout.mutate()}>
 *   Sign Out
 * </Button>
 * ```
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(['session-with-permissions'], null);
      queryClient.setQueryData(['session'], null);
      queryClient.clear();
      router.push('/login');
    },
  });
}

/**
 * Hook to require authentication for a page/component
 *
 * Automatically redirects to /login if user is not authenticated.
 * Use this in protected pages instead of manual session checks.
 *
 * @returns Object with user data and loading state
 *
 * @example
 * ```tsx
 * function ProtectedPage() {
 *   const { user, isLoading } = useRequireAuth();
 *
 *   if (isLoading) return <PageLoader />;
 *
 *   return <Dashboard user={user} />;
 * }
 * ```
 */
export function useRequireAuth() {
  const { data: user, isLoading, isFetched } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isFetched && !user) {
      router.push('/login');
    }
  }, [isFetched, user, router]);

  return { user, isLoading };
}
