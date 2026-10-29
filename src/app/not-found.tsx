import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background-primary">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-text-primary mb-2">404</h1>
        <h2 className="text-xl text-text-secondary mb-4">Page Not Found</h2>
        <p className="text-text-tertiary mb-6">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/companies"
          className="btn-primary btn-sm inline-flex"
        >
          Companies
        </Link>
      </div>
    </div>
  );
}
