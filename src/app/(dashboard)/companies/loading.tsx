export default function CompaniesLoading() {
  return (
    <div className="p-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-40 skeleton rounded mb-2" />
          <div className="h-4 w-64 skeleton rounded" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-32 skeleton rounded" />
          <div className="h-9 w-32 skeleton rounded" />
        </div>
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 skeleton rounded" />
              <div className="flex-1">
                <div className="h-6 w-12 skeleton rounded mb-1" />
                <div className="h-4 w-24 skeleton rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters skeleton */}
      <div className="mb-6 flex items-center gap-3">
        <div className="h-9 flex-1 max-w-sm skeleton rounded" />
        <div className="h-9 w-32 skeleton rounded" />
        <div className="h-9 w-32 skeleton rounded" />
      </div>

      {/* Table skeleton */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>UEN</th>
              <th>Type</th>
              <th>Status</th>
              <th>Incorporated</th>
              <th>Officers</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...Array(5)].map((_, i) => (
              <tr key={i}>
                <td><div className="h-4 w-48 skeleton rounded" /></td>
                <td><div className="h-4 w-24 skeleton rounded" /></td>
                <td><div className="h-4 w-20 skeleton rounded" /></td>
                <td><div className="h-4 w-16 skeleton rounded" /></td>
                <td><div className="h-4 w-24 skeleton rounded" /></td>
                <td><div className="h-4 w-12 skeleton rounded" /></td>
                <td><div className="h-4 w-8 skeleton rounded" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
