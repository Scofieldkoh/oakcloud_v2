export default function DashboardLoading() {
  return (
    <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-oak-light border-t-transparent" />
        <p className="text-xs text-text-tertiary">Loading...</p>
      </div>
    </div>
  );
}
