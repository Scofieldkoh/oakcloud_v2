'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, ArrowLeft, Send, CheckCircle } from 'lucide-react';
import { FormInput } from '@/components/ui/form-input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [devInfo, setDevInfo] = useState<{ resetUrl?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      setSuccess(true);

      // In development, show the reset URL for testing
      if (data.resetUrl) {
        setDevInfo({ resetUrl: data.resetUrl });
      }
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
          <h2 className="text-xl font-semibold text-text-primary">Reset your password</h2>
          <p className="text-text-secondary text-sm mt-1">
            {success
              ? 'Check your email for a reset link'
              : "Enter your email and we'll send you a reset link"}
          </p>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm text-text-secondary text-center">
                If an account exists for <strong>{email}</strong>, you will receive a password reset link shortly.
              </p>
            </div>

            {/* Development info */}
            {devInfo?.resetUrl && (
              <Alert variant="info">
                <div className="text-xs">
                  <p className="font-medium mb-1">Development Mode</p>
                  <p className="break-all">
                    <Link href={devInfo.resetUrl} className="text-oak-light hover:underline">
                      Click here to reset password
                    </Link>
                  </p>
                </div>
              </Alert>
            )}

            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSuccess(false);
                  setEmail('');
                  setDevInfo(null);
                }}
                className="w-full"
              >
                Try another email
              </Button>
              <Link href="/login" className="w-full">
                <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} className="w-full">
                  Back to login
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}

            <FormInput
              label="Email"
              type="email"
              inputSize="lg"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              autoComplete="email"
              autoFocus
              disabled={isLoading}
              leftIcon={<Mail />}
            />

            <Button
              type="submit"
              size="lg"
              isLoading={isLoading}
              leftIcon={<Send />}
              className="w-full"
            >
              {isLoading ? 'Sending...' : 'Send Reset Link'}
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
