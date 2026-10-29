'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Lock, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import { FormInput } from '@/components/ui/form-input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset.');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess(true);

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

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
            {success ? 'Password Reset!' : 'Set New Password'}
          </h2>
          <p className="text-text-secondary text-sm mt-1">
            {success
              ? 'Redirecting you to login...'
              : 'Enter your new password below'}
          </p>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-text-secondary text-center">
                Your password has been reset successfully.
              </p>
            </div>

            <Link href="/login" className="block">
              <Button variant="primary" size="md" className="w-full">
                Go to Login
              </Button>
            </Link>
          </div>
        ) : !token ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <p className="text-sm text-text-secondary text-center">
                {error}
              </p>
            </div>

            <Link href="/forgot-password" className="block">
              <Button variant="primary" size="md" className="w-full">
                Request New Reset Link
              </Button>
            </Link>

            <Link href="/login" className="block">
              <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} className="w-full">
                Back to login
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}

            <FormInput
              label="New Password"
              type="password"
              inputSize="lg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              required
              autoComplete="new-password"
              autoFocus
              disabled={isLoading}
              leftIcon={<Lock />}
              hint="At least 8 characters with uppercase, lowercase, and number"
            />

            <FormInput
              label="Confirm Password"
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
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </Button>

            <Link href="/login" className="block">
              <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} className="w-full">
                Back to login
              </Button>
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background-primary flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center animate-pulse">
              <Image src="/falcon.svg" alt="Oakcloud" width={84} height={84} unoptimized />
            </div>
            <p className="text-text-tertiary text-sm">Loading...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
