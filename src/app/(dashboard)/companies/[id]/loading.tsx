export default function CompanyDetailLoading() {
  return (
    <div className="p-6">
      <div className="animate-pulse space-y-6">
        {/* Back link */}
        <div className="h-4 w-32 skeleton rounded" />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="h-8 w-64 skeleton rounded mb-2" />
            <div className="flex items-center gap-4">
              <div className="h-5 w-24 skeleton rounded" />
              <div className="h-5 w-32 skeleton rounded" />
              <div className="h-5 w-40 skeleton rounded" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-9 w-20 skeleton rounded" />
            <div className="h-9 w-24 skeleton rounded" />
          </div>
        </div>

        {/* Content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Business Activity */}
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="h-5 w-32 skeleton rounded" />
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <div className="h-3 w-24 skeleton rounded mb-2" />
                  <div className="h-5 w-full skeleton rounded" />
                </div>
                <div>
                  <div className="h-3 w-24 skeleton rounded mb-2" />
                  <div className="h-5 w-3/4 skeleton rounded" />
                </div>
              </div>
            </div>

            {/* Addresses */}
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="h-5 w-24 skeleton rounded" />
              </div>
              <div className="p-4">
                <div className="h-3 w-32 skeleton rounded mb-2" />
                <div className="h-5 w-full skeleton rounded" />
              </div>
            </div>

            {/* Officers */}
            <div className="card">
              <div className="p-4 border-b border-border-primary flex items-center justify-between">
                <div className="h-5 w-20 skeleton rounded" />
                <div className="h-4 w-16 skeleton rounded" />
              </div>
              <div className="divide-y divide-border-primary">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="p-4 flex items-center justify-between">
                    <div>
                      <div className="h-5 w-40 skeleton rounded mb-1" />
                      <div className="h-4 w-24 skeleton rounded" />
                    </div>
                    <div className="h-5 w-16 skeleton rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Capital */}
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="h-5 w-20 skeleton rounded" />
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="h-3 w-24 skeleton rounded mb-1" />
                  <div className="h-6 w-32 skeleton rounded" />
                </div>
                <div>
                  <div className="h-3 w-24 skeleton rounded mb-1" />
                  <div className="h-6 w-32 skeleton rounded" />
                </div>
              </div>
            </div>

            {/* Compliance */}
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="h-5 w-24 skeleton rounded" />
              </div>
              <div className="p-4 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i}>
                    <div className="h-3 w-24 skeleton rounded mb-1" />
                    <div className="h-5 w-20 skeleton rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
