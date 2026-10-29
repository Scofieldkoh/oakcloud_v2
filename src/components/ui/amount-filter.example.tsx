/**
 * AmountFilter Usage Examples
 *
 * This file demonstrates how to use the AmountFilter component in different scenarios.
 */

import { useState } from 'react';
import { AmountFilter, type AmountFilterValue } from './amount-filter';

// Example 1: Basic usage in a table filter row
export function TableFilterExample() {
  const [totalFilter, setTotalFilter] = useState<AmountFilterValue | undefined>();
  const [subtotalFilter, setSubtotalFilter] = useState<AmountFilterValue | undefined>();

  return (
    <table>
      <thead>
        <tr>
          <th>Document</th>
          <th>Subtotal</th>
          <th>Total</th>
        </tr>
        <tr className="bg-background-secondary">
          <th className="px-2 py-2">
            <input type="text" placeholder="Filter..." />
          </th>
          <th className="px-2 py-2">
            <AmountFilter
              value={subtotalFilter}
              onChange={setSubtotalFilter}
              placeholder="All amounts"
              size="sm"
            />
          </th>
          <th className="px-2 py-2">
            <AmountFilter
              value={totalFilter}
              onChange={setTotalFilter}
              placeholder="All amounts"
              size="sm"
            />
          </th>
        </tr>
      </thead>
    </table>
  );
}

// Example 2: Using with API parameters
export function ApiIntegrationExample() {
  const [filters, setFilters] = useState<{
    subtotalFilter?: AmountFilterValue;
    totalFilter?: AmountFilterValue;
  }>({});

  // Convert AmountFilterValue to API query parameters
  const getApiParams = () => {
    const params: Record<string, string> = {};

    if (filters.subtotalFilter?.mode === 'single' && filters.subtotalFilter.single !== undefined) {
      params.subtotal = filters.subtotalFilter.single.toString();
    } else if (filters.subtotalFilter?.mode === 'range') {
      if (filters.subtotalFilter.range?.from !== undefined) {
        params.subtotalFrom = filters.subtotalFilter.range.from.toString();
      }
      if (filters.subtotalFilter.range?.to !== undefined) {
        params.subtotalTo = filters.subtotalFilter.range.to.toString();
      }
    }

    if (filters.totalFilter?.mode === 'single' && filters.totalFilter.single !== undefined) {
      params.total = filters.totalFilter.single.toString();
    } else if (filters.totalFilter?.mode === 'range') {
      if (filters.totalFilter.range?.from !== undefined) {
        params.totalFrom = filters.totalFilter.range.from.toString();
      }
      if (filters.totalFilter.range?.to !== undefined) {
        params.totalTo = filters.totalFilter.range.to.toString();
      }
    }

    return params;
  };

  const apiParams = getApiParams();

  const handleFilterChange = (key: 'subtotalFilter' | 'totalFilter', value: AmountFilterValue | undefined) => {
    setFilters({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-4">
      <AmountFilter
        value={filters.subtotalFilter}
        onChange={(value) => handleFilterChange('subtotalFilter', value)}
        placeholder="Filter subtotal"
      />
      <AmountFilter
        value={filters.totalFilter}
        onChange={(value) => handleFilterChange('totalFilter', value)}
        placeholder="Filter total"
      />
      <pre className="text-xs text-text-muted">
        {JSON.stringify(apiParams, null, 2)}
      </pre>
    </div>
  );
}

// Example 3: URL parameter synchronization
export function UrlSyncExample() {
  const [amountFilter, setAmountFilter] = useState<AmountFilterValue | undefined>();

  // Parse from URL (example helper - prefix with underscore as it's for demonstration)
  const _parseFromUrl = (searchParams: URLSearchParams): AmountFilterValue | undefined => {
    const exact = searchParams.get('amount');
    const from = searchParams.get('amountFrom');
    const to = searchParams.get('amountTo');

    if (exact) {
      return { mode: 'single', single: parseFloat(exact) };
    }

    if (from || to) {
      return {
        mode: 'range',
        range: {
          from: from ? parseFloat(from) : undefined,
          to: to ? parseFloat(to) : undefined,
        },
      };
    }

    return undefined;
  };

  // Serialize to URL
  const serializeToUrl = (value: AmountFilterValue | undefined): Record<string, string> => {
    if (!value) return {};

    if (value.mode === 'single' && value.single !== undefined) {
      return { amount: value.single.toString() };
    }

    if (value.mode === 'range') {
      const params: Record<string, string> = {};
      if (value.range?.from !== undefined) {
        params.amountFrom = value.range.from.toString();
      }
      if (value.range?.to !== undefined) {
        params.amountTo = value.range.to.toString();
      }
      return params;
    }

    return {};
  };

  const handleChange = (value: AmountFilterValue | undefined) => {
    setAmountFilter(value);
    // Update URL with: router.push(`/path?${new URLSearchParams(urlParams).toString()}`);
  };

  const urlParams = serializeToUrl(amountFilter);

  return (
    <div className="space-y-2">
      <AmountFilter
        value={amountFilter}
        onChange={handleChange}
        placeholder="Filter by amount"
      />
      <code className="block text-xs text-text-muted">
        {new URLSearchParams(urlParams).toString()}
      </code>
    </div>
  );
}

// Example 4: Filtering data client-side
export function ClientSideFilterExample() {
  interface Invoice {
    id: string;
    number: string;
    subtotal: number;
    total: number;
  }

  const [invoices] = useState<Invoice[]>([
    { id: '1', number: 'INV-001', subtotal: 1000, total: 1100 },
    { id: '2', number: 'INV-002', subtotal: 2500, total: 2750 },
    { id: '3', number: 'INV-003', subtotal: 500, total: 550 },
    { id: '4', number: 'INV-004', subtotal: 10000, total: 11000 },
  ]);

  const [totalFilter, setTotalFilter] = useState<AmountFilterValue | undefined>();

  // Filter function
  const matchesFilter = (amount: number, filter: AmountFilterValue | undefined): boolean => {
    if (!filter) return true;

    if (filter.mode === 'single' && filter.single !== undefined) {
      return amount === filter.single;
    }

    if (filter.mode === 'range') {
      const { from, to } = filter.range || {};
      if (from !== undefined && amount < from) return false;
      if (to !== undefined && amount > to) return false;
    }

    return true;
  };

  const filteredInvoices = invoices.filter((inv) => matchesFilter(inv.total, totalFilter));

  return (
    <div>
      <div className="mb-4">
        <AmountFilter
          value={totalFilter}
          onChange={setTotalFilter}
          placeholder="Filter by total"
        />
      </div>
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Subtotal</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {filteredInvoices.map((inv) => (
            <tr key={inv.id}>
              <td>{inv.number}</td>
              <td>{inv.subtotal.toFixed(2)}</td>
              <td>{inv.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-text-muted mt-2">
        Showing {filteredInvoices.length} of {invoices.length} invoices
      </p>
    </div>
  );
}

// Example 5: Multiple filters with combined logic
export function CombinedFiltersExample() {
  const [filters, setFilters] = useState<{
    subtotal?: AmountFilterValue;
    tax?: AmountFilterValue;
    total?: AmountFilterValue;
  }>({});

  const handleFilterChange = (key: keyof typeof filters) => (value: AmountFilterValue | undefined) => {
    setFilters({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">Subtotal Filter</label>
        <AmountFilter
          value={filters.subtotal}
          onChange={handleFilterChange('subtotal')}
          placeholder="All subtotals"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-2">Tax Filter</label>
        <AmountFilter
          value={filters.tax}
          onChange={handleFilterChange('tax')}
          placeholder="All tax amounts"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-2">Total Filter</label>
        <AmountFilter
          value={filters.total}
          onChange={handleFilterChange('total')}
          placeholder="All totals"
        />
      </div>
    </div>
  );
}
