'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Lock, CheckCircle, AlertTriangle } from 'lucide-react';
import { FormInput } from '@/components/ui/form-input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useSession } from '@/hooks/use-auth';

function ChangePasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isForced = searchParams.get('forced') === 'true';
  const { data: session, isLoading: sessionLoading } = useSession();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!sessionLoading && !session) {
      router.push('/login');
    }
  }, [session, sessionLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to change password');
      }

      setSuccess(true);

      // Redirect to dashboard after success
      setTimeout(() => {
        router.push('/companies');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-background-primary flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center animate-pulse">
            <Image src="/falcon.svg" alt="Oakcloud" width={84} height={84} unoptimized />
          </div>
          <p className="text-text-tertiary text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-primary flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <Image src="/falcon.svg" alt="Oakcloud" width={84} height={84} unoptimized />
          </Link>
        </div>

        {/* Header */}
        <div className="text-center">
          <h2 className="text-xl font-semibold text-text-primary">
            {success ? 'Password Changed!' : 'Change Password'}
          </h2>
          <p className="text-text-secondary text-sm mt-1">
            {success
              ? 'Redirecting you to dashboard...'
              : isForced
                ? 'You must change your password before continuing'
                : 'Update your password'}
          </p>
        </div>

        {isForced && !success && (
          <Alert variant="warning">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">Password change required for security</span>
            </div>
          </Alert>
        )}

        {success ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-text-secondary text-center">
                Your password has been changed successfully.
              </p>
            </div>

            <Link href="/companies" className="block">
              <Button variant="primary" size="md" className="w-full">
                Go to Dashboard
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}

            <FormInput
              label="Current Password"
              type="password"
              inputSize="lg"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
              required
              autoComplete="current-password"
              autoFocus
              disabled={isLoading}
              leftIcon={<Lock />}
            />

            <FormInput
              label="New Password"
              type="password"
              inputSize="lg"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              required
              autoComplete="new-password"
              disabled={isLoading}
              leftIcon={<Lock />}
              hint="At least 8 characters with uppercase, lowercase, and number"
            />

            <FormInput
              label="Confirm New Password"
              type="password"
              inputSize="lg"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
              autoComplete="new-password"
              disabled={isLoading}
              leftIcon={<Lock />}
            />

            <Button
              type="submit"
              size="lg"
              isLoading={isLoading}
              className="w-full"
            >
              {isLoading ? 'Changing...' : 'Change Password'}
            </Button>

            {!isForced && (
              <Link href="/companies" className="block">
                <Button variant="ghost" size="sm" className="w-full">
                  Cancel
                </Button>
              </Link>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-background-primary flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center animate-pulse">
          <Image src="/falcon.svg" alt="Oakcloud" width={84} height={84} unoptimized />
        </div>
        <p className="text-text-tertiary text-sm">Loading...</p>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ChangePasswordContent />
    </Suspense>
  );
}
