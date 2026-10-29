'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Link2,
  Briefcase,
  PieChart,
  ChevronDown,
  ChevronUp,
  Star,
  Filter,
  X,
  Pencil,
  Trash2,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { CompanyAccentSection, CompanyAccentButton, CompanyAccentFilter } from '@/components/companies/company-accent-section';

interface Company {
  id: string;
  name: string;
  uen: string;
}

interface CompanyRelation {
  id: string;
  company: Company;
  relationship: string;
  isPrimary: boolean;
}

interface OfficerPosition {
  id: string;
  company: Company;
  role: string;
  appointmentDate: string | null;
  cessationDate: string | null;
  isCurrent: boolean;
}

interface Shareholding {
  id: string;
  company: Company;
  shareClass: string;
  numberOfShares: number;
  percentageHeld: number | null;
  isCurrent: boolean;
}

interface ConsolidatedRelationship {
  companyId: string;
  companyName: string;
  companyUen: string;
  isPrimary: boolean;
  generalRelationship: string | null;
  officerPositions: OfficerPosition[];
  shareholdings: Shareholding[];
}

interface CompanyRelationshipsProps {
  companyRelations: CompanyRelation[] | undefined;
  officerPositions: OfficerPosition[] | undefined;
  shareholdings: Shareholding[] | undefined;
  hiddenCompanyCount?: number;  // Number of companies hidden due to RBAC
  canUpdate: boolean;
  onLinkCompany: () => void;
  onUnlinkCompany: (companyId: string, relationship: string) => void;
  onUnlinkOfficer?: (officerId: string, companyId: string) => void;
  onUnlinkShareholder?: (shareholderId: string, companyId: string) => void;
  onEditOfficer?: (officer: OfficerPosition, companyId: string) => void;
  onEditShareholder?: (shareholder: Shareholding, companyId: string) => void;
}

const isOfficerActive = (pos: OfficerPosition) => pos.isCurrent && !pos.cessationDate;
const normalizeRelationship = (value: string) =>
  value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const OFFICER_ROLE_VALUES = new Set([
  'director',
  'managing director',
  'alternate director',
  'nominee director',
  'secretary',
  'ceo',
  'cfo',
  'auditor',
  'liquidator',
  'receiver',
  'judicial manager',
]);
const isPositionRelationship = (relationship: string) => {
  const normalized = normalizeRelationship(relationship);
  if (OFFICER_ROLE_VALUES.has(normalized)) return true;
  if (normalized === 'shareholder') return true;
  return normalized.endsWith('shareholder');
};

export function CompanyRelationships({
  companyRelations,
  officerPositions,
  shareholdings,
  hiddenCompanyCount,
  canUpdate,
  onLinkCompany,
  onUnlinkCompany,
  onUnlinkOfficer,
  onUnlinkShareholder,
  onEditOfficer,
  onEditShareholder,
}: CompanyRelationshipsProps) {
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [companyNameFilter, setCompanyNameFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('');
  const [showCeased, setShowCeased] = useState(false);

  // Consolidate all relationships by company
  const consolidatedRelationships = useMemo(() => {
    const map = new Map<string, ConsolidatedRelationship>();

    // Process company relations (general links)
    companyRelations?.forEach((rel) => {
      if (!map.has(rel.company.id)) {
        map.set(rel.company.id, {
          companyId: rel.company.id,
          companyName: rel.company.name,
          companyUen: rel.company.uen,
          isPrimary: rel.isPrimary,
          generalRelationship: isPositionRelationship(rel.relationship) ? null : rel.relationship,
          officerPositions: [],
          shareholdings: [],
        });
      } else {
        const existing = map.get(rel.company.id)!;
        if (rel.isPrimary) existing.isPrimary = true;
        if (!existing.generalRelationship && !isPositionRelationship(rel.relationship)) {
          existing.generalRelationship = rel.relationship;
        }
      }
    });

    // Process officer positions
    officerPositions?.forEach((pos) => {
      if (!map.has(pos.company.id)) {
        map.set(pos.company.id, {
          companyId: pos.company.id,
          companyName: pos.company.name,
          companyUen: pos.company.uen,
          isPrimary: false,
          generalRelationship: null,
          officerPositions: [pos],
          shareholdings: [],
        });
      } else {
        map.get(pos.company.id)!.officerPositions.push(pos);
      }
    });

    // Process shareholdings
    shareholdings?.forEach((sh) => {
      if (!map.has(sh.company.id)) {
        map.set(sh.company.id, {
          companyId: sh.company.id,
          companyName: sh.company.name,
          companyUen: sh.company.uen,
          isPrimary: false,
          generalRelationship: null,
          officerPositions: [],
          shareholdings: [sh],
        });
      } else {
        map.get(sh.company.id)!.shareholdings.push(sh);
      }
    });

    // Sort: primary first, then by company name
    return Array.from(map.values()).sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.companyName.localeCompare(b.companyName);
    });
  }, [companyRelations, officerPositions, shareholdings]);

  // Extract unique positions for the filter dropdown
  const availablePositions = useMemo(() => {
    const positions = new Set<string>();

    // Add officer roles
    officerPositions?.forEach((pos) => {
      positions.add(pos.role.replace(/_/g, ' '));
    });

    // Add "Shareholder" if there are any shareholdings
    if (shareholdings && shareholdings.length > 0) {
      positions.add('Shareholder');
    }

    // Add general relationships
    companyRelations?.forEach((rel) => {
      if (rel.relationship && !isPositionRelationship(rel.relationship)) {
        positions.add(rel.relationship);
      }
    });

    return Array.from(positions).sort();
  }, [companyRelations, officerPositions, shareholdings]);

  // Apply filters to consolidated relationships
  const filteredRelationships = useMemo(() => {
    return consolidatedRelationships.filter((rel) => {
      // Company name filter
      if (companyNameFilter) {
        const searchTerm = companyNameFilter.toLowerCase();
        const matchesName = rel.companyName.toLowerCase().includes(searchTerm);
        const matchesUen = rel.companyUen.toLowerCase().includes(searchTerm);
        if (!matchesName && !matchesUen) return false;
      }

      // Position filter
      if (positionFilter) {
        const normalizedFilter = positionFilter.toLowerCase();

        // Check officer positions (filter by current if showCeased is false)
        const matchingOfficers = rel.officerPositions.filter(pos => showCeased || isOfficerActive(pos));
        const hasOfficerMatch = matchingOfficers.some((pos) =>
          pos.role.replace(/_/g, ' ').toLowerCase() === normalizedFilter
        );

        // Check shareholdings (filter by current if showCeased is false)
        const matchingShareholdings = rel.shareholdings.filter(sh => showCeased || sh.isCurrent);
        const hasShareholderMatch = normalizedFilter === 'shareholder' && matchingShareholdings.length > 0;

        // Check general relationship
        const hasGeneralMatch = rel.generalRelationship?.toLowerCase() === normalizedFilter;

        if (!hasOfficerMatch && !hasShareholderMatch && !hasGeneralMatch) return false;
      }

      // If showCeased is false, filter out companies with only ceased positions
      if (!showCeased) {
        const hasCurrentOfficer = rel.officerPositions.some((pos) => isOfficerActive(pos));
        const hasCurrentShareholder = rel.shareholdings.some(sh => sh.isCurrent);
        const hasGeneralRel = rel.generalRelationship;

        // Keep the company if it has any current position or general relationship
        if (!hasCurrentOfficer && !hasCurrentShareholder && !hasGeneralRel) return false;
      }

      return true;
    });
  }, [consolidatedRelationships, companyNameFilter, positionFilter, showCeased]);

  const isActiveRelationship = (rel: ConsolidatedRelationship) =>
    rel.officerPositions.some((pos) => isOfficerActive(pos)) ||
    rel.shareholdings.some((sh) => sh.isCurrent) ||
    !!rel.generalRelationship;

  const activeRelationshipCount = consolidatedRelationships.filter(isActiveRelationship).length;
  const pastRelationshipCount = consolidatedRelationships.length - activeRelationshipCount;

  const hasActiveFilters = companyNameFilter || positionFilter || showCeased;

  const clearFilters = () => {
    setCompanyNameFilter('');
    setPositionFilter('');
    setShowCeased(false);
  };

  const toggleExpanded = (companyId: string) => {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  };

  const hasDetails = (rel: ConsolidatedRelationship) =>
    rel.officerPositions.length > 0 || rel.shareholdings.length > 0;

  if (consolidatedRelationships.length === 0) {
    return (
      <CompanyAccentSection
        title="Company Relationships"
        actions={
          canUpdate ? (
            <CompanyAccentButton onClick={onLinkCompany}>
              <Link2 className="h-3.5 w-3.5" />
              Add to Company
            </CompanyAccentButton>
          ) : undefined
        }
      >
        <div className="px-3 py-8 text-center">
          <Building2 className="mx-auto mb-3 h-10 w-10 text-text-muted" aria-hidden="true" />
          <p className="text-sm text-text-secondary">Not associated with any companies</p>
          {canUpdate && (
            <button
              onClick={onLinkCompany}
              className="btn-primary btn-sm mt-4"
            >
              Add to Company
            </button>
          )}
        </div>
      </CompanyAccentSection>
    );
  }

  return (
    <CompanyAccentSection
      title="Company Relationships"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="whitespace-nowrap text-xs font-medium">
            {activeRelationshipCount} active{pastRelationshipCount > 0 ? ` · ${pastRelationshipCount} past` : ''}
          </span>
          {hiddenCompanyCount !== undefined && hiddenCompanyCount > 0 && (
            <span className="whitespace-nowrap text-xs font-medium text-amber-200" title="Some company relationships are hidden due to your access permissions">
              ({hiddenCompanyCount} hidden)
            </span>
          )}
          <CompanyAccentFilter label="Show ceased" checked={showCeased} onChange={setShowCeased} />
          {consolidatedRelationships.length > 0 && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`rounded p-1 transition-colors hover:bg-white/10 ${showFilters || hasActiveFilters ? 'bg-white/10' : ''}`}
              title="Filter relationships"
            >
              <Filter className="h-3.5 w-3.5" />
            </button>
          )}
          {canUpdate && (
            <CompanyAccentButton onClick={onLinkCompany}>
              <Link2 className="h-3.5 w-3.5" />
              Add to Company
            </CompanyAccentButton>
          )}
        </div>
      }
    >
      {/* Filter Panel */}
      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 border-b border-border-primary bg-surface-secondary px-3 py-2.5 animate-fade-in">
          <div className="min-w-[150px] max-w-[250px] flex-1">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary">Company Name</label>
            <input
              type="text"
              value={companyNameFilter}
              onChange={(e) => setCompanyNameFilter(e.target.value)}
              placeholder="Search by name or UEN..."
              className="input input-xs w-full"
            />
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-text-secondary">Position</label>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className="input input-xs w-full"
            >
              <option value="">All Positions</option>
              {availablePositions.map((pos) => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="btn-ghost btn-xs flex items-center gap-1 text-text-muted hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
      )}

      {filteredRelationships.length === 0 && hasActiveFilters ? (
        <div className="px-3 py-6 text-center">
          <p className="text-sm text-text-secondary">No companies match your filters</p>
          <button
            onClick={clearFilters}
            className="btn-secondary btn-xs mt-2"
          >
            Clear Filters
          </button>
        </div>
      ) : null}
      <div className="divide-y divide-border-primary px-3">
        {filteredRelationships.map((rel) => {
          const isExpanded = expandedCompanies.has(rel.companyId);
          const hasDetailInfo = hasDetails(rel);
          const currentOfficerPositions = rel.officerPositions.filter((p) => isOfficerActive(p));
          const currentShareholdings = rel.shareholdings.filter((s) => s.isCurrent);

          return (
            <div key={rel.companyId} className="py-3">
              {/* Company Header */}
              <div
                className={`flex items-start justify-between gap-3 ${
                  hasDetailInfo ? 'cursor-pointer' : ''
                }`}
                onClick={() => hasDetailInfo && toggleExpanded(rel.companyId)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                    <Link
                      href={`/companies/${rel.companyId}`}
                      className="text-oak-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rel.companyName}
                    </Link>
                    <span className="text-xs text-text-secondary">({rel.companyUen})</span>
                    {rel.isPrimary && (
                      <span className="inline-flex min-h-5 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium leading-none text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200">
                        <Star className="h-3 w-3" />
                        Primary
                      </span>
                    )}
                  </div>

                  {/* Role Badges Summary */}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {/* Officer badges */}
                    {currentOfficerPositions.map((pos) => (
                      <span
                        key={pos.id}
                        className="inline-flex items-center gap-1 rounded-full bg-oak-primary/10 px-2 py-0.5 text-xs font-medium text-oak-light"
                      >
                        <Briefcase className="h-3 w-3" />
                        {pos.role.replace(/_/g, ' ')}
                      </span>
                    ))}

                    {/* Shareholding badges */}
                    {currentShareholdings.map((sh) => (
                      <span
                        key={sh.id}
                        className="inline-flex items-center gap-1 rounded-full bg-status-info/10 px-2 py-0.5 text-xs font-medium text-status-info"
                      >
                        <PieChart className="h-3 w-3" />
                        {sh.numberOfShares.toLocaleString()} {sh.shareClass}
                        {sh.percentageHeld && ` (${sh.percentageHeld}%)`}
                      </span>
                    ))}

                    {/* General relationship badge if no specific roles */}
                    {rel.generalRelationship &&
                      currentOfficerPositions.length === 0 &&
                      currentShareholdings.length === 0 && (
                        <span className="badge badge-neutral text-xs">
                          {rel.generalRelationship}
                        </span>
                      )}
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-2">
                  {/* Only show Remove for pure general relationships (no officers/shareholders) */}
                  {canUpdate && rel.generalRelationship &&
                    rel.officerPositions.length === 0 &&
                    rel.shareholdings.length === 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnlinkCompany(rel.companyId, rel.generalRelationship!);
                      }}
                      className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-status-error"
                      title="Remove relationship"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  {hasDetailInfo && (
                    <button className="rounded p-1 text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-secondary">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && hasDetailInfo && (
                <div className="mt-3 space-y-3 animate-fade-in">
                  {/* Officer Positions Detail */}
                  {rel.officerPositions.length > 0 && (
                    <div className="rounded-lg border border-border-secondary p-3">
                      <h4 className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-text-secondary">
                        <Briefcase className="h-3.5 w-3.5" />
                        Officer Positions
                      </h4>
                      <div className="space-y-2">
                        {rel.officerPositions.map((pos) => (
                          <div
                            key={pos.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <div>
                              <span className="text-text-primary">
                                {pos.role.replace(/_/g, ' ')}
                              </span>
                              {pos.appointmentDate && (
                                <p className="text-xs text-text-muted">
                                  Appointed: {formatDate(pos.appointmentDate)}
                                  {pos.cessationDate &&
                                    ` • Ceased: ${formatDate(pos.cessationDate)}`}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {isOfficerActive(pos) ? (
                                <span className="badge badge-success text-2xs">Active</span>
                              ) : (
                                <span className="badge badge-neutral text-2xs">Ceased</span>
                              )}
                              {canUpdate && onEditOfficer && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onEditOfficer(pos, rel.companyId);
                                  }}
                                  className="text-text-muted hover:text-oak-light transition-colors"
                                  title="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canUpdate && onUnlinkOfficer && pos.isCurrent && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUnlinkOfficer(pos.id, rel.companyId);
                                  }}
                                  className="text-text-muted hover:text-status-error transition-colors"
                                  title="Remove"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Shareholdings Detail */}
                  {rel.shareholdings.length > 0 && (
                    <div className="rounded-lg border border-border-secondary p-3">
                      <h4 className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-text-secondary">
                        <PieChart className="h-3.5 w-3.5" />
                        Shareholdings
                      </h4>
                      <div className="space-y-2">
                        {rel.shareholdings.map((sh) => (
                          <div
                            key={sh.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <div>
                              <span className="text-text-primary">
                                {sh.numberOfShares.toLocaleString()} {sh.shareClass} shares
                              </span>
                              {sh.percentageHeld && (
                                <span className="ml-2 text-text-secondary">
                                  ({sh.percentageHeld}% ownership)
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {sh.isCurrent ? (
                                <span className="badge badge-success text-2xs">Active</span>
                              ) : (
                                <span className="badge badge-neutral text-2xs">Former</span>
                              )}
                              {canUpdate && onEditShareholder && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onEditShareholder(sh, rel.companyId);
                                  }}
                                  className="text-text-muted hover:text-oak-light transition-colors"
                                  title="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canUpdate && onUnlinkShareholder && sh.isCurrent && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUnlinkShareholder(sh.id, rel.companyId);
                                  }}
                                  className="text-text-muted hover:text-status-error transition-colors"
                                  title="Remove"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CompanyAccentSection>
  );
}
