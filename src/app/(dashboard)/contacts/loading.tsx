export default function ContactsLoading() {
  return (
    <div className="p-4 sm:p-6">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="skeleton h-7 w-32 mb-2" />
          <div className="skeleton h-4 w-64" />
        </div>
        <div className="skeleton h-9 w-28" />
      </div>

      {/* Filters Skeleton */}
      <div className="flex items-center gap-3 mb-6">
        <div className="skeleton h-9 flex-1" />
        <div className="skeleton h-9 w-24" />
      </div>

      {/* Table Skeleton */}
      <div className="table-container mb-6">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>ID Number</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Companies</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...Array(5)].map((_, i) => (
              <tr key={i}>
                <td>
                  <div className="skeleton h-4 w-40" />
                </td>
                <td>
                  <div className="skeleton h-4 w-20" />
                </td>
                <td>
                  <div className="skeleton h-4 w-24" />
                </td>
                <td>
                  <div className="skeleton h-4 w-32" />
                </td>
                <td>
                  <div className="skeleton h-4 w-24" />
                </td>
                <td>
                  <div className="skeleton h-4 w-12" />
                </td>
                <td>
                  <div className="skeleton h-4 w-8" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
