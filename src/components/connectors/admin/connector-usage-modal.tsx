'use client';

import { useState } from 'react';
import {
  useConnectorUsage,
  useExportUsage,
  formatCost,
  formatTokens,
  formatLatency,
  type Connector,
  type UsageSearchParams,
} from '@/hooks/use-connectors';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import {
  Check,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  toLocalDateString,
} from './connector-admin-config';

interface ConnectorUsageModalProps {
  connector: Connector;
  /** Kept by the page so the chosen dates survive closing and reopening the modal. */
  dateFilter: DatePickerValue | undefined;
  onDateFilterChange: (value: DatePickerValue | undefined) => void;
  onClose: () => void;
}

/** Usage log for one connector over a date range, with CSV export. */
export function ConnectorUsageModal({ connector, dateFilter, onDateFilterChange, onClose }: ConnectorUsageModalProps) {
  const [usagePage, setUsagePage] = useState(1);

  // Extract dates from DatePickerValue for API
  const getUsageDates = () => {
    if (!dateFilter) return { startDate: '', endDate: '' };

    if (dateFilter.mode === 'range' && dateFilter.range) {
      return {
        startDate: dateFilter.range.from ? toLocalDateString(dateFilter.range.from) : '',
        endDate: dateFilter.range.to ? toLocalDateString(dateFilter.range.to) : '',
      };
    }

    if (dateFilter.mode === 'single' && dateFilter.date) {
      const dateStr = toLocalDateString(dateFilter.date);
      return { startDate: dateStr, endDate: dateStr };
    }

    return { startDate: '', endDate: '' };
  };

  const { startDate, endDate } = getUsageDates();

  const usageParams: UsageSearchParams | null = startDate && endDate
    ? {
        connectorId: connector.id,
        startDate,
        endDate,
        page: usagePage,
        limit: 20,
      }
    : null;
  const { data: usageData, isLoading: usageLoading } = useConnectorUsage(usageParams);
  const exportMutation = useExportUsage();
  const usageUnitLabel = connector.provider === 'MISTRAL' ? 'Pages' : 'Tokens';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Usage: ${connector.name}`}
      size="6xl"
    >
      <ModalBody>
        {/* Stats Summary */}
        {usageData?.stats && (
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="text-xs text-text-muted uppercase tracking-wide">Total Calls</div>
              <div className="text-xl font-semibold text-text-primary mt-1">
                {usageData.stats.totalCalls.toLocaleString()}
              </div>
              <div className="text-xs text-text-secondary mt-1">
                {usageData.stats.successfulCalls} successful, {usageData.stats.failedCalls} failed
              </div>
            </div>
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="text-xs text-text-muted uppercase tracking-wide">Total Cost</div>
              <div className="text-xl font-semibold text-text-primary mt-1">
                {formatCost(usageData.stats.totalCostUsd)}
              </div>
            </div>
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="text-xs text-text-muted uppercase tracking-wide">Total {usageUnitLabel}</div>
              <div className="text-xl font-semibold text-text-primary mt-1">
                {formatTokens(usageData.stats.totalTokens)}
              </div>
            </div>
            <div className="bg-bg-tertiary rounded-lg p-3">
              <div className="text-xs text-text-muted uppercase tracking-wide">Avg Latency</div>
              <div className="text-xl font-semibold text-text-primary mt-1">
                {formatLatency(usageData.stats.avgLatencyMs)}
              </div>
            </div>
          </div>
        )}

        {/* Date Range Filter */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <DatePicker
            value={dateFilter}
            onChange={(value) => {
              onDateFilterChange(value);
              setUsagePage(1);
            }}
            placeholder="Select date range"
            size="sm"
            className="w-64"
          />
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              if (usageParams) {
                exportMutation.mutate(usageParams);
              }
            }}
            isLoading={exportMutation.isPending}
          >
            <Download className="w-3 h-3 mr-1" />
            Export CSV
          </Button>
        </div>

        {/* Usage Logs Table */}
        {usageLoading ? (
          <div className="text-center py-8 text-text-muted">Loading usage logs...</div>
        ) : !usageData?.logs.length ? (
          <div className="text-center py-8 text-text-muted">
            No usage logs found for this date range
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[400px]">
              <table className="table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">Date</th>
                    <th className="text-left">Model</th>
                    <th className="text-left">Operation</th>
                    <th className="text-right">{usageUnitLabel}</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Latency</th>
                    <th className="text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {usageData.logs.map((log) => (
                    <tr key={log.id} className="hover:bg-bg-tertiary/50">
                      <td className="text-text-secondary">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="text-text-primary">{log.model}</td>
                      <td className="text-text-secondary">{log.operation || 'N/A'}</td>
                      <td className="text-right text-text-secondary">
                        {formatTokens(log.totalTokens)}
                      </td>
                      <td className="text-right text-text-primary font-medium">
                        {formatCost(log.costUsd)}
                      </td>
                      <td className="text-right text-text-secondary">
                        {formatLatency(log.latencyMs)}
                      </td>
                      <td className="text-center">
                        {log.success ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600">
                            <Check className="w-3 h-3" />
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-red-600"
                            title={log.errorMessage || 'Failed'}
                          >
                            <X className="w-3 h-3" />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {usageData.totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-primary">
                <div className="text-sm text-text-muted">
                  Page {usageData.page} of {usageData.totalPages} ({usageData.total} total)
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => setUsagePage((p) => Math.max(1, p - 1))}
                    disabled={usagePage <= 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => setUsagePage((p) => Math.min(usageData.totalPages, p + 1))}
                    disabled={usagePage >= usageData.totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => onClose()}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
