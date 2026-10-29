import type { Metadata } from 'next';
import './globals.css';
import '@docx-editor.dev/core/styles/editor.css';
import { IOSViewportFix } from '@/components/ui/ios-viewport-fix';

export const metadata: Metadata = {
  title: 'Oakcloud - Practice Management System',
  description: 'Internal management system for accounting practices',
  icons: {
    icon: [
      { url: '/falcon.svg', sizes: '32x32', type: 'image/svg+xml' },
      { url: '/falcon.svg', sizes: '64x64', type: 'image/svg+xml' },
    ],
    apple: { url: '/falcon.svg', sizes: '180x180' },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <IOSViewportFix />
        {children}
      </body>
    </html>
  );
}
