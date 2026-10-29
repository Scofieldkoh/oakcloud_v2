'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-auth';
import {
  type CommunicationItem,
  useBulkDeleteCommunications,
  useCommunications,
  useDeleteCommunication,
  useIngestCommunications,
  useUpdateCommunicationMailboxes,
} from '@/hooks/use-communications';

const EMPTY_COMMUNICATIONS: CommunicationItem[] = [];

type MailboxSettingsSnapshot = {
  mailboxUserIds: string[];
  ingestAllEmails: boolean;
};

export default function CommunicationPage() {
  const { data: session, isLoading: sessionLoading } = useSession();
  const { success, error: showError } = useToast();
  const [lookbackDays, setLookbackDays] = useState(30);
  const [mailboxesInput, setMailboxesInput] = useState('');
  const [ingestAllEmails, setIngestAllEmails] = useState(false);
  const [isMailboxSettingsDirty, setIsMailboxSettingsDirty] = useState(false);
  const [selectedCommunicationIds, setSelectedCommunicationIds] = useState<string[]>([]);
  const [selectedCommunication, setSelectedCommunication] = useState<CommunicationItem | null>(null);
  const [deletingCommunication, setDeletingCommunication] = useState<CommunicationItem | null>(null);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [lastSyncSummary, setLastSyncSummary] = useState<{
    scannedMessages: number;
    storedCommunications: number;
    importedCompanyEmails: number;
  } | null>(null);

  const communicationsQuery = useCommunications(200);
  const ingestMutation = useIngestCommunications();
  const updateMailboxesMutation = useUpdateCommunicationMailboxes();
  const deleteCommunicationMutation = useDeleteCommunication();
  const bulkDeleteMutation = useBulkDeleteCommunications();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const pendingMailboxSettingsRef = useRef<MailboxSettingsSnapshot | null>(null);

  const isAdmin = !!session && (session.isSuperAdmin || session.isWorkspaceAdmin);
  const connector = communicationsQuery.data?.connector;
  const communications = communicationsQuery.data?.communications ?? EMPTY_COMMUNICATIONS;
  const allSelected = communications.length > 0 && selectedCommunicationIds.length === communications.length;
  const someSelected =
    selectedCommunicationIds.length > 0 && selectedCommunicationIds.length < communications.length;

  useEffect(() => {
    if (!connector || isMailboxSettingsDirty) return;

    const pending = pendingMailboxSettingsRef.current;
    if (pending) {
      const matches = pending.ingestAllEmails === connector.ingestAllEmails
        && pending.mailboxUserIds.length === connector.mailboxUserIds.length
        && pending.mailboxUserIds.every((mailbox, index) => mailbox === connector.mailboxUserIds[index]);
      if (!matches) return;
      pendingMailboxSettingsRef.current = null;
    }

    setMailboxesInput(connector.mailboxUserIds.join(', '));
    setIngestAllEmails(connector.ingestAllEmails);
  }, [connector, isMailboxSettingsDirty]);

  useEffect(() => {
    const currentIds = new Set(communications.map((item) => item.id));
    setSelectedCommunicationIds((prev) => {
      const next = prev.filter((id) => currentIds.has(id));
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [communications]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const handleSync = async () => {
    try {
      const result = await ingestMutation.mutateAsync({ lookbackDays });
      setLastSyncSummary({
        scannedMessages: result.scannedMessages,
        storedCommunications: result.storedCommunications,
        importedCompanyEmails: result.importedCompanyEmails,
      });
      success(
        `Synced ${result.storedCommunications} communication(s), imported ${result.importedCompanyEmails} email(s).`
      );
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to sync communications');
    }
  };

  const handleSaveMailboxes = async () => {
    const mailboxUserIds = mailboxesInput
      .split(/[,\n]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (mailboxUserIds.length === 0) {
      showError('Enter at least one mailbox email');
      return;
    }

    try {
      const result = await updateMailboxesMutation.mutateAsync({ mailboxUserIds, ingestAllEmails });
      pendingMailboxSettingsRef.current = {
        mailboxUserIds: result.connector.mailboxUserIds,
        ingestAllEmails: result.connector.ingestAllEmails,
      };
      setMailboxesInput(result.connector.mailboxUserIds.join(', '));
      setIngestAllEmails(result.connector.ingestAllEmails);
      setIsMailboxSettingsDirty(false);
      success('Communication settings saved');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to save communication settings');
    }
  };

  const renderCompanyCell = (item: CommunicationItem) => {
    if (item.isUnmatched) {
      return <span className="text-text-primary">{item.companyName}</span>;
    }

    return (
      <Link
        href={`/companies/${item.companyId}`}
        className="text-oak-light hover:underline"
      >
        {item.companyName}
      </Link>
    );
  };

  const handleDeleteCommunication = async () => {
    if (!deletingCommunication) return;

    try {
      await deleteCommunicationMutation.mutateAsync({ id: deletingCommunication.id });
      if (selectedCommunication?.id === deletingCommunication.id) {
        setSelectedCommunication(null);
      }
      setDeletingCommunication(null);
      success('Communication deleted from storage');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to delete communication');
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCommunicationIds(communications.map((item) => item.id));
      return;
    }
    setSelectedCommunicationIds([]);
  };

  const toggleSelectOne = (communicationId: string, checked: boolean) => {
    setSelectedCommunicationIds((prev) => {
      if (checked) {
        if (prev.includes(communicationId)) return prev;
        return [...prev, communicationId];
      }
      return prev.filter((id) => id !== communicationId);
    });
  };

  const handleBulkDeleteCommunications = async () => {
    if (selectedCommunicationIds.length === 0) return;

    try {
      const result = await bulkDeleteMutation.mutateAsync({
        ids: selectedCommunicationIds,
      });
      if (selectedCommunication && selectedCommunicationIds.includes(selectedCommunication.id)) {
        setSelectedCommunication(null);
      }
      if (deletingCommunication && selectedCommunicationIds.includes(deletingCommunication.id)) {
        setDeletingCommunication(null);
      }

      setSelectedCommunicationIds([]);
      setIsBulkDeleteConfirmOpen(false);

      const skippedSuffix =
        result.skipped > 0 ? `, skipped ${result.skipped} item(s)` : '';
      success(`Deleted ${result.deleted} communication(s)${skippedSuffix}.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to bulk delete communications');
    }
  };

  if (sessionLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 skeleton" />
          <div className="h-4 w-80 skeleton" />
          <div className="h-64 skeleton rounded-lg" />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="card p-6">
          <div className="inline-flex items-center gap-2 text-status-error">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Forbidden</span>
          </div>
          <p className="text-sm text-text-secondary mt-2">
            Only tenant or super admins can access Communication.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Mail className="w-5 h-5 text-text-tertiary" />
            Communication
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Ingest Outlook mailbox emails and view the latest matched communications by company.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-text-muted block mb-1">Lookback (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value) || 30)}
              className="input input-sm w-28"
            />
          </div>
          <Button
            variant="primary"
            onClick={handleSync}
            isLoading={ingestMutation.isPending}
            disabled={!connector?.configured}
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Sync Now
          </Button>
        </div>
      </div>

      {lastSyncSummary && (
        <div className="card p-4 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">Last sync:</span>{' '}
          scanned {lastSyncSummary.scannedMessages} message(s), stored{' '}
          {lastSyncSummary.storedCommunications} communication(s), imported{' '}
          {lastSyncSummary.importedCompanyEmails} company email(s).
        </div>
      )}

      {communicationsQuery.isLoading && (
        <div className="card p-6 text-center text-text-muted">Loading communications...</div>
      )}

      {communicationsQuery.error && (
        <div className="card p-6">
          <div className="inline-flex items-center gap-2 text-status-error">
            <AlertCircle className="w-4 h-4" />
            <span>{communicationsQuery.error.message}</span>
          </div>
        </div>
      )}

      {connector && !connector.configured && (
        <div className="card p-6">
          <h2 className="text-base font-semibold text-text-primary">Connector Setup Required</h2>
          <p className="text-sm text-text-secondary mt-2">
            {connector.message || 'Configure Microsoft connector and mailboxes before syncing.'}
          </p>
          {connector.reason === 'missing_mailboxes' && (
            <div className="mt-4 p-3 rounded-lg border border-border-primary bg-bg-tertiary space-y-3">
              <div>
                <label className="text-xs text-text-muted block mb-1">
                  Mailbox emails (comma or newline separated)
                </label>
                <textarea
                  value={mailboxesInput}
                  onChange={(e) => {
                    setMailboxesInput(e.target.value);
                    setIsMailboxSettingsDirty(true);
                  }}
                  className="input w-full min-h-24 p-3"
                  placeholder="mailbox1@tenant.com, mailbox2@tenant.com"
                />
              </div>
              <label className="flex items-start gap-3 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={ingestAllEmails}
                  onChange={(e) => {
                    setIngestAllEmails(e.target.checked);
                    setIsMailboxSettingsDirty(true);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-border-primary accent-oak-primary cursor-pointer"
                />
                <span>
                  Ingest all emails, even when they do not match a company domain.
                  Unmatched emails will be stored under <strong>[System] Unmatched Communications</strong>.
                </span>
              </label>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveMailboxes}
                isLoading={updateMailboxesMutation.isPending}
              >
                Save Communication Settings
              </Button>
            </div>
          )}
          <Link
            href="/admin/connectors"
            className="mt-4 btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <ExternalLink className="w-4 h-4" />
            Open Connectors
          </Link>
        </div>
      )}

      {connector?.configured && (
        <div className="card overflow-hidden">
          <div className="px-4 py-4 border-b border-border-primary bg-bg-tertiary/30 space-y-3">
            <div>
              <label className="text-xs text-text-muted block mb-1">
                Mailbox emails (comma or newline separated)
              </label>
              <textarea
                value={mailboxesInput}
                onChange={(e) => {
                  setMailboxesInput(e.target.value);
                  setIsMailboxSettingsDirty(true);
                }}
                className="input w-full min-h-24 p-3"
                placeholder="mailbox1@tenant.com, mailbox2@tenant.com"
              />
            </div>
            <label className="flex items-start gap-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={ingestAllEmails}
                onChange={(e) => {
                  setIngestAllEmails(e.target.checked);
                  setIsMailboxSettingsDirty(true);
                }}
                className="mt-0.5 h-4 w-4 rounded border-border-primary accent-oak-primary cursor-pointer"
              />
              <span>
                Ingest all emails, even when they do not match a company domain.
                Unmatched emails will be stored under <strong>[System] Unmatched Communications</strong>.
              </span>
            </label>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveMailboxes}
                isLoading={updateMailboxesMutation.isPending}
              >
                Save Communication Settings
              </Button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border-primary text-xs text-text-muted">
            Connector: {connector.provider} ({connector.source}) | Mailboxes:{' '}
            {connector.mailboxUserIds.join(', ')} | Ingest all emails:{' '}
            {connector.ingestAllEmails ? 'On' : 'Off'}
          </div>

          <div className="px-4 py-2 border-b border-border-primary bg-bg-tertiary/40 flex items-center justify-between gap-3">
            <p className="text-xs text-text-muted">
              {selectedCommunicationIds.length} selected
            </p>
            <Button
              variant="danger"
              size="xs"
              disabled={selectedCommunicationIds.length === 0}
              onClick={() => setIsBulkDeleteConfirmOpen(true)}
              isLoading={bulkDeleteMutation.isPending}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete Selected
            </Button>
          </div>

          {communications.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-text-muted">No ingested emails yet.</p>
              <p className="text-xs text-text-muted mt-1">Run Sync Now to load latest emails.</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left w-12">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                        className="h-4 w-4 rounded border-border-primary accent-oak-primary cursor-pointer"
                        aria-label="Select all communications"
                      />
                    </th>
                    <th className="text-left">Company</th>
                    <th className="text-left">Subject</th>
                    <th className="text-left">From</th>
                    <th className="text-left">Mailbox</th>
                    <th className="text-left">Received At</th>
                    <th className="text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {communications.map((item) => (
                    <tr key={item.id} className="hover:bg-bg-tertiary/40 transition-colors">
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedCommunicationIds.includes(item.id)}
                          onChange={(e) => toggleSelectOne(item.id, e.target.checked)}
                          className="h-4 w-4 rounded border-border-primary accent-oak-primary cursor-pointer"
                          aria-label={`Select communication ${item.subject || item.id}`}
                        />
                      </td>
                      <td>
                        {renderCompanyCell(item)}
                      </td>
                      <td className="max-w-[420px]">
                        <div className="font-medium text-text-primary truncate">
                          {item.subject || '(No subject)'}
                        </div>
                        {item.preview && (
                          <div className="text-xs text-text-muted truncate mt-0.5">
                            {item.preview}
                          </div>
                        )}
                      </td>
                      <td>{item.fromEmail || '-'}</td>
                      <td>{item.mailboxUserId || '-'}</td>
                      <td>{new Date(item.receivedAt).toLocaleString()}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => setSelectedCommunication(item)}
                          >
                            View
                          </Button>
                          <Button
                            variant="danger"
                            size="xs"
                            onClick={() => setDeletingCommunication(item)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={!!selectedCommunication}
        onClose={() => setSelectedCommunication(null)}
        title={selectedCommunication?.subject || '(No subject)'}
        size="4xl"
      >
        <ModalBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-text-muted">Company</p>
              {selectedCommunication ? (
                renderCompanyCell(selectedCommunication)
              ) : (
                <p className="text-text-primary">-</p>
              )}
            </div>
            <div>
              <p className="text-xs text-text-muted">Received</p>
              <p className="text-text-primary">
                {selectedCommunication ? new Date(selectedCommunication.receivedAt).toLocaleString() : '-'}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-muted">From</p>
              <p className="text-text-primary break-all">{selectedCommunication?.fromEmail || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Mailbox</p>
              <p className="text-text-primary break-all">{selectedCommunication?.mailboxUserId || '-'}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-text-muted">Matched Participants</p>
              <p className="text-text-primary break-all">
                {selectedCommunication?.toEmails.length
                  ? selectedCommunication.toEmails.join(', ')
                  : '-'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border-primary overflow-hidden">
            <div className="px-4 py-2 border-b border-border-primary text-xs text-text-muted bg-bg-tertiary">
              Email Body
            </div>
            <div className="p-4 text-sm text-text-primary whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
              {selectedCommunication?.body?.trim() || '(No body content)'}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setSelectedCommunication(null)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      <ConfirmDialog
        isOpen={!!deletingCommunication}
        onClose={() => setDeletingCommunication(null)}
        onConfirm={handleDeleteCommunication}
        title="Delete Communication"
        description={`Delete "${deletingCommunication?.subject || '(No subject)'}" from stored communications?`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteCommunicationMutation.isPending}
      />

      <ConfirmDialog
        isOpen={isBulkDeleteConfirmOpen}
        onClose={() => setIsBulkDeleteConfirmOpen(false)}
        onConfirm={handleBulkDeleteCommunications}
        title="Delete Selected Communications"
        description={`Delete ${selectedCommunicationIds.length} selected communication(s) from storage?`}
        confirmLabel="Delete Selected"
        variant="danger"
        isLoading={bulkDeleteMutation.isPending}
      />
    </div>
  );
}
