export const WidgetError = ({ element, error }: { element: string; error: unknown }) => (
  <div
    role="alert"
    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
  >
    <strong className="font-semibold">{element}</strong> failed:{' '}
    {error instanceof Error ? error.message : String(error)}
  </div>
);
