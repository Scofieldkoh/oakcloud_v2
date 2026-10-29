'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  BriefcaseBusiness,
  FilePenLine,
  Loader2,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormInput } from '@/components/ui/form-input';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { useToast } from '@/components/ui/toast';
import { useAllTemplatePartials } from '@/hooks/use-template-partials';
import { useDeadlineRules } from '@/hooks/use-deadline-rules';
import {
  useArchiveServiceFamily,
  useArchiveServiceVariant,
  useCreateServiceFamily,
  useCreateServiceVariant,
  useServiceCatalog,
  useUpdateServiceFamily,
  useUpdateServiceVariant,
} from '@/hooks/use-service-catalog';
import { formatCurrency } from '@/lib/utils';
import type {
  CreateServiceFamilyInput,
  CreateServiceVariantInput,
  UpdateServiceFamilyInput,
  UpdateServiceVariantInput,
} from '@/lib/validations/service-catalog';
import type {
  ServiceFamilyDto,
  ServiceVariantDto,
} from '@/services/service-catalog/types';
import { ServiceFamilyForm } from './service-family-form';
import { ServiceVariantForm } from './service-variant-form';

interface ServiceCatalogPanelProps {
  workspaceId?: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  active?: boolean;
}

type EditDialog =
  | { type: 'family'; family?: ServiceFamilyDto }
  | { type: 'variant'; familyId: string; variant?: ServiceVariantDto }
  | null;

type ArchiveTarget =
  | { type: 'family'; id: string; name: string }
  | { type: 'variant'; id: string; name: string }
  | null;

function cadenceLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function ServiceCatalogPanel({
  workspaceId,
  canCreate,
  canUpdate,
  canDelete,
  active = true,
}: ServiceCatalogPanelProps) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const limit = 20;
  const [editDialog, setEditDialog] = useState<EditDialog>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget>(null);

  const filters = {
    query: deferredSearch || undefined,
    isActive:
      status === 'all' ? undefined : status === 'active',
    page,
    limit,
  };
  const catalog = useServiceCatalog(workspaceId, filters, active);
  const totalPages = Math.max(
    1,
    Math.ceil((catalog.data?.total ?? 0) / limit),
  );
  const partialsQuery = useAllTemplatePartials(workspaceId, active);
  const deadlineRulesQuery = useDeadlineRules(
    workspaceId,
    { isActive: true, includeArchived: false, page: 1, limit: 100 },
    active && editDialog?.type === 'variant',
  );
  const createFamily = useCreateServiceFamily(workspaceId);
  const updateFamily = useUpdateServiceFamily(workspaceId);
  const archiveFamily = useArchiveServiceFamily(workspaceId);
  const createVariant = useCreateServiceVariant(workspaceId);
  const updateVariant = useUpdateServiceVariant(workspaceId);
  const archiveVariant = useArchiveServiceVariant(workspaceId);

  useEffect(() => {
    if (catalog.data && page > totalPages) {
      setPage(totalPages);
    }
  }, [catalog.data, page, totalPages]);

  const partials =
    partialsQuery.data?.partials.map((partial) => ({
      id: partial.id,
      name: partial.name,
      displayName: partial.displayName,
    })) ?? [];
  const deadlineRuleOptions = deadlineRulesQuery.data?.rules.map((rule) => {
    const version = rule.draft ?? rule.currentVersion;
    return {
      id: rule.id,
      code: rule.code,
      name: rule.name,
      parameters: version?.parameters ?? [],
    };
  }) ?? [];

  const submitFamily = async (
    input: CreateServiceFamilyInput | UpdateServiceFamilyInput,
  ) => {
    try {
      if (editDialog?.type === 'family' && editDialog.family) {
        await updateFamily.mutateAsync({
          id: editDialog.family.id,
          input: input as UpdateServiceFamilyInput,
        });
        toast.success('Service family updated');
      } else {
        await createFamily.mutateAsync(input as CreateServiceFamilyInput);
        toast.success('Service family created');
      }
      setEditDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save service family');
      throw error;
    }
  };

  const submitVariant = async (
    input: CreateServiceVariantInput | UpdateServiceVariantInput,
  ) => {
    try {
      if (editDialog?.type === 'variant' && editDialog.variant) {
        await updateVariant.mutateAsync({
          id: editDialog.variant.id,
          input: input as UpdateServiceVariantInput,
        });
        toast.success('Service variant updated');
      } else {
        await createVariant.mutateAsync(input as CreateServiceVariantInput);
        toast.success('Service variant created');
      }
      setEditDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save service variant');
      throw error;
    }
  };

  const confirmArchive = async (reason?: string) => {
    if (!archiveTarget || !reason) return;
    try {
      if (archiveTarget.type === 'family') {
        await archiveFamily.mutateAsync({ id: archiveTarget.id, reason });
      } else {
        await archiveVariant.mutateAsync({ id: archiveTarget.id, reason });
      }
      toast.success(`${archiveTarget.name} archived`);
      setArchiveTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to archive item');
      throw error;
    }
  };

  return (
    <section aria-labelledby="service-catalog-heading">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="service-catalog-heading"
            className="text-lg font-semibold text-text-primary"
          >
            Service catalog
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Organize reusable service scopes and default fee templates.
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              className="min-h-11 sm:min-h-8"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setEditDialog({ type: 'family' })}
            >
              Add service family
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <FormInput
          aria-label="Search service catalog"
          type="search"
          className="min-h-11 sm:min-h-8"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search code, name, or description"
          leftIcon={<Search className="h-4 w-4" />}
        />
        <label className="block text-xs font-medium text-text-secondary">
          Active state
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
            className="input input-sm mt-2 min-h-11 w-full sm:min-h-8"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      {catalog.isLoading ? (
        <div className="card flex items-center justify-center gap-2 p-4 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading service catalog…
        </div>
      ) : catalog.error ? (
        <div className="card p-4 text-center">
          <p className="text-sm font-medium text-status-error">
            Unable to load the service catalog
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {catalog.error instanceof Error ? catalog.error.message : 'Try again shortly.'}
          </p>
        </div>
      ) : !catalog.data
        || (!catalog.data.families.length && catalog.data.total === 0) ? (
        <div className="card p-4 text-center sm:p-8">
          <BriefcaseBusiness className="mx-auto h-12 w-12 text-text-muted" />
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            No service offerings found
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
            {search || status !== 'all'
              ? 'Adjust the search or active-state filter.'
              : 'Create a family, then add variants linked to reusable SOW partials.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {catalog.data.families.map((family) => (
            <article
              key={family.id}
              className="overflow-hidden rounded-lg border border-border-primary bg-background-secondary"
            >
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-text-primary">
                      {family.name}
                    </h3>
                    <code className="rounded bg-background-tertiary px-1.5 py-0.5 text-[11px] text-accent-primary">
                      {family.code}
                    </code>
                    <span
                      className={
                        family.isActive
                          ? 'badge badge-success'
                          : 'badge badge-neutral'
                      }
                    >
                      {family.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {family.description ? (
                    <p className="mt-1 text-sm text-text-secondary">
                      {family.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {canCreate ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      className="min-h-11 sm:min-h-8"
                      leftIcon={<Plus className="h-3.5 w-3.5" />}
                      onClick={() =>
                        setEditDialog({ type: 'variant', familyId: family.id })
                      }
                    >
                      Add variant
                    </Button>
                  ) : null}
                  {canUpdate ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="min-h-11 sm:min-h-8"
                      aria-label={`Edit ${family.name}`}
                      leftIcon={<Pencil className="h-3.5 w-3.5" />}
                      onClick={() =>
                        setEditDialog({ type: 'family', family })
                      }
                    >
                      Edit
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="min-h-11 sm:min-h-8"
                      aria-label={`Archive ${family.name}`}
                      leftIcon={<Archive className="h-3.5 w-3.5" />}
                      onClick={() =>
                        setArchiveTarget({
                          type: 'family',
                          id: family.id,
                          name: family.name,
                        })
                      }
                    >
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-border-secondary">
                {family.variants.length === 0 ? (
                  <p className="p-4 text-sm text-text-muted">
                    No variants in this family.
                  </p>
                ) : (
                  <div className="divide-y divide-border-secondary">
                    {family.variants.map((variant) => (
                      <div
                        key={variant.id}
                        className="p-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:p-4"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-text-primary">
                              {variant.name}
                            </span>
                            <span className="text-xs text-text-muted">
                              v{variant.version}
                            </span>
                            <span className="badge badge-neutral">
                              {cadenceLabel(variant.serviceCadence)}
                            </span>
                            {!variant.isActive ? (
                              <span className="badge badge-warning">Inactive</span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                            <span>
                              SOW: {variant.sowPartial.displayName || variant.sowPartial.name}
                            </span>
                            <span>
                              {variant.feeTemplates.length === 0
                                ? 'No default fees'
                                : variant.feeTemplates
                                    .map((fee) =>
                                      fee.defaultAmount
                                        ? `${fee.description}: ${formatCurrency(
                                            Number(fee.defaultAmount),
                                            fee.currency,
                                          )}`
                                        : fee.description,
                                    )
                                    .join(' · ')}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
                          {canUpdate ? (
                            <Link
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-medium text-text-primary transition-colors hover:bg-background-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 sm:min-h-8"
                              href={`/template-partials/editor?type=partial&tab=services&id=${variant.sowPartial.id}`}
                            >
                              <FilePenLine className="h-3.5 w-3.5" />
                              Edit wording
                            </Link>
                          ) : null}
                          {canUpdate ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="min-h-11 sm:min-h-8"
                              aria-label={`Edit ${variant.name}`}
                              onClick={() =>
                                setEditDialog({
                                  type: 'variant',
                                  familyId: family.id,
                                  variant,
                                })
                              }
                            >
                              Edit
                            </Button>
                          ) : null}
                          {canDelete ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              className="min-h-11 sm:min-h-8"
                              aria-label={`Archive ${variant.name}`}
                              onClick={() =>
                                setArchiveTarget({
                                  type: 'variant',
                                  id: variant.id,
                                  name: variant.name,
                                })
                              }
                            >
                              Archive
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
          {catalog.data.total > limit ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={catalog.data.total}
              limit={limit}
              onPageChange={setPage}
              showPageSize={false}
              showJumpToPage={false}
            />
          ) : null}
        </div>
      )}

      <Modal
        isOpen={editDialog?.type === 'family'}
        onClose={() => setEditDialog(null)}
        title={
          editDialog?.type === 'family' && editDialog.family
            ? 'Edit service family'
            : 'Add service family'
        }
        description="Group related service variants under a stable code."
        size="lg"
      >
        {editDialog?.type === 'family' ? (
          <ServiceFamilyForm
            initialValue={editDialog.family}
            onCancel={() => setEditDialog(null)}
            onSubmit={submitFamily}
            isSubmitting={createFamily.isPending || updateFamily.isPending}
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={editDialog?.type === 'variant'}
        onClose={() => setEditDialog(null)}
        title={
          editDialog?.type === 'variant' && editDialog.variant
            ? 'Edit service variant'
            : 'Add service variant'
        }
        description="Link wording, cadence, and fee defaults for this offering."
        size="2xl"
      >
        {editDialog?.type === 'variant' ? (
          <ServiceVariantForm
            familyId={editDialog.familyId}
            initialValue={editDialog.variant}
            partials={partials}
            isLoadingPartials={partialsQuery.isLoading}
            availableDeadlineRules={deadlineRuleOptions}
            isLoadingDeadlineRules={deadlineRulesQuery.isLoading}
            onCancel={() => setEditDialog(null)}
            onSubmit={submitVariant}
            isSubmitting={createVariant.isPending || updateVariant.isPending}
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={confirmArchive}
        title={`Archive ${archiveTarget?.name ?? 'service item'}?`}
        description="Archived catalog items are hidden from new agreements."
        confirmLabel="Archive"
        requireReason
        reasonLabel="Archive reason"
        reasonMinLength={3}
        isLoading={archiveFamily.isPending || archiveVariant.isPending}
      />
    </section>
  );
}
