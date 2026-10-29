export default function ContactDetailLoading() {
  return (
    <div className="p-6">
      <div className="animate-pulse space-y-6">
        {/* Header */}
        <div>
          <div className="skeleton h-4 w-32 mb-3" />
          <div className="skeleton h-8 w-64 mb-2" />
          <div className="skeleton h-4 w-48" />
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="skeleton h-5 w-40" />
              </div>
              <div className="p-4 grid grid-cols-2 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i}>
                    <div className="skeleton h-3 w-20 mb-2" />
                    <div className="skeleton h-4 w-32" />
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="skeleton h-5 w-40" />
              </div>
              <div className="p-4 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="skeleton h-16 w-full" />
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="skeleton h-5 w-24" />
              </div>
              <div className="p-4 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="skeleton h-4 w-24" />
                    <div className="skeleton h-4 w-8" />
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="p-4 border-b border-border-primary">
                <div className="skeleton h-5 w-24" />
              </div>
              <div className="p-4">
                <div className="skeleton h-9 w-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
