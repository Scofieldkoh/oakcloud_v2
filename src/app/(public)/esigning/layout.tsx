import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Oaktree E-Signing',
  description: 'Securely review and sign your Oaktree documents.',
};

export default function EsigningPublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
