import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="px-4 py-24 text-center sm:px-8">
      <h1 className="display text-[clamp(2.5rem,6vw,4rem)] leading-none">That page is not here.</h1>
      <p className="mt-4 text-muted">The entry may have been renamed or deleted.</p>
      <Link href="/" className="btn btn-primary mt-7">
        Back to the library
      </Link>
    </div>
  );
}
