// Skip static generation - page uses Chakra UI components that require client context
export const dynamic = 'force-dynamic';

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
