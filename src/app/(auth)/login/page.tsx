'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { LogIn, Mail, Lock } from 'lucide-react';
import { useLogin, useSession } from '@/hooks/use-auth';
import { FormInput } from '@/components/ui/form-input';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export default function LoginPage() {
  const router = useRouter();
  const { data: session, isLoading: sessionLoading } = useSession();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Redirect if already logged in (on page load, not after login mutation)
  // The useLogin hook handles post-login redirect including mustChangePassword check
  useEffect(() => {
    if (session && !sessionLoading && !login.isPending && !login.isSuccess) {
      router.push('/companies');
    }
  }, [session, sessionLoading, router, login.isPending, login.isSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
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
    <div className="min-h-screen bg-background-primary flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-[45%] xl:w-2/5 bg-gradient-to-br from-oak-dark via-oak-primary to-oak-light p-10 flex-col justify-between relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-56 h-56 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-20 right-10 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <Image src="/falcon.svg" alt="Oakcloud" width={72} height={72} unoptimized />
            <span className="text-base font-semibold text-white">Oakcloud</span>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-10 space-y-5">
          <h1 className="text-3xl xl:text-4xl font-semibold text-white leading-tight">
            Practice Management,
            <br />
            <span className="text-white/70">Simplified.</span>
          </h1>
          <p className="text-base text-white/60 max-w-md">
            A modular internal management system designed for accounting practices.
            Clean, efficient, and runs completely locally.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {['Company Management', 'BizFile Integration', 'Audit Trails'].map((feature) => (
              <span
                key={feature}
                className="px-2.5 py-1 rounded-md bg-white/10 backdrop-blur text-xs text-white/80"
              >
                {feature}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-white/40 text-xs">
          <p>Oakcloud v0.1.0</p>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center">
            <div className="inline-flex items-center gap-2.5">
              <Image src="/falcon.svg" alt="Oakcloud" width={84} height={84} className="w-16 h-16 sm:w-[5.25rem] sm:h-[5.25rem]" unoptimized />
            </div>
          </div>

          {/* Header */}
          <div className="text-center lg:text-left">
            <h2 className="text-xl font-semibold text-text-primary">Welcome back</h2>
            <p className="text-text-secondary text-sm mt-1">
              Sign in to your account to continue
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {login.error && (
              <Alert variant="error">
                {login.error.message}
              </Alert>
            )}

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
              disabled={login.isPending}
              leftIcon={<Mail />}
            />

            <div>
              <FormInput
                label="Password"
                type="password"
                inputSize="lg"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                disabled={login.isPending}
                leftIcon={<Lock />}
              />
              <div className="mt-1 text-right">
                <Link
                  href="/forgot-password"
                  className="text-xs text-oak-light hover:text-oak-hover transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              isLoading={login.isPending}
              leftIcon={<LogIn />}
              className="w-full"
            >
              {login.isPending ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

        </div>
      </div>
    </div>
  );
}
