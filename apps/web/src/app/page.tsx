import Link from 'next/link';

/**
 * Public landing page. Middleware redirects authenticated users to /dashboard,
 * so this is only seen while signed out.
 */
export default function HomePage() {
  return (
    <main
      data-theme="dark"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Invoice Platform</h1>
        <p className="text-muted-foreground">EU-compliant e-invoicing — EN 16931 / Peppol</p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="h-10 rounded-md bg-primary px-5 text-sm font-semibold leading-10 text-primary-foreground hover:bg-primary/90"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="h-10 rounded-md border border-border px-5 text-sm font-medium leading-10 hover:text-foreground"
        >
          Create account
        </Link>
      </div>
    </main>
  );
}
