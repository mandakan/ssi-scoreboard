import GridPageClient from "./grid-page-client";

interface PageProps {
  params: Promise<{ ct: string; id: string }>;
}

// Legacy ?competitors= links are redirected in middleware.ts, before this page
// or the layout's metadata run, so no match data is loaded for them.
export default async function GridPage({ params }: PageProps) {
  const { ct, id } = await params;
  // Height: viewport minus top bar (3rem), tab bar (3.5rem) and, on md+, the
  // site header (3.5rem). key resets the grid's per-match source override.
  return (
    <div className="h-[calc(100dvh-3rem-3.5rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem-3rem-3.5rem)]">
      <GridPageClient key={`${ct}/${id}`} />
    </div>
  );
}
