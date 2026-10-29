"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ContactMatchPreview } from "@/types/contact-identity";
import type { ContactResolutionDecision } from "@/types/contact-identity";
import { COMPANY_ALIAS_MAX_LENGTH } from "@/lib/company-display-label";
import {
  BIZFILE_ENTITY_TYPE_OPTIONS,
  BIZFILE_IDENTIFICATION_TYPE_OPTIONS,
  BIZFILE_OFFICER_ROLE_OPTIONS,
  BIZFILE_STATUS_OPTIONS,
  type
  BizFileReviewDraft,
  BizFileReviewIssue,
  BizFileReviewSectionId,
} from "@/lib/validations/bizfile-review";
import {
  ReviewCheckbox,
  ReviewField,
  ReviewSelect,
  ReviewTextarea,
} from "./bizfile-review-fields";
import { RepeatingRecordEditor } from "./repeating-record-editor";
import { canonicalizeCompanyStatus, canonicalizeEntityType, canonicalizeIdentificationType, canonicalizeOfficerRole } from "@/services/bizfile/canonical-values";
import { isExactIdentifierContactMatch } from "@/services/bizfile/contact-match-preview.client";

type Props = {
  draft: BizFileReviewDraft;
  onChange: (draft: BizFileReviewDraft) => void;
  issues: BizFileReviewIssue[];
  matchPreviews?: Record<string, ContactMatchPreview | null>;
};
const UPPERCASE_OPTION_LABELS = new Set(["NRIC", "FIN", "UEN", "CEO", "CFO"]);
const optionLabel = (value: string) => UPPERCASE_OPTION_LABELS.has(value)
  ? value
  : value.split("_").map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
type Address = NonNullable<BizFileReviewDraft["registeredAddress"]>;
type FormerName = NonNullable<
  BizFileReviewDraft["entityDetails"]["formerNames"]
>[number];
type ShareCapital = NonNullable<BizFileReviewDraft["shareCapital"]>[number];
type Officer = NonNullable<BizFileReviewDraft["officers"]>[number];
type Shareholder = NonNullable<BizFileReviewDraft["shareholders"]>[number];
type Charge = NonNullable<BizFileReviewDraft["charges"]>[number];
function issue(issues: BizFileReviewIssue[], path: string) {
  return issues.find((candidate) => candidate.path === path);
}
function numberValue(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function EntitySection({ draft, onChange, issues }: Props) {
  const entity = draft.entityDetails;
  const set = (field: keyof typeof entity, value: string) =>
    onChange({ ...draft, entityDetails: { ...entity, [field]: value } });
  const formerNames = entity.formerNames ?? [];
  return (
    <Section title="Entity details">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        <ReviewField
          id="entity-uen"
          label="UEN"
          value={entity.uen}
          onChange={(e) => set("uen", e.target.value)}
          error={issue(issues, "entityDetails.uen")}
        />
        <ReviewField
          id="entity-name"
          label="Company name"
          value={entity.name}
          onChange={(e) => set("name", e.target.value)}
          error={issue(issues, "entityDetails.name")}
        />
        <ReviewField
          id="entity-display-alias"
          label="ALIAS"
          value={entity.displayAlias ?? ""}
          maxLength={COMPANY_ALIAS_MAX_LENGTH}
          hint={`Review or edit the extracted alias before saving. Maximum ${COMPANY_ALIAS_MAX_LENGTH} characters.`}
          onChange={(e) => set("displayAlias", e.target.value)}
          error={issue(issues, "entityDetails.displayAlias")}
        />
        <ReviewField
          id="entity-former-name"
          label="Former name"
          value={entity.formerName ?? ""}
          onChange={(e) => set("formerName", e.target.value)}
          error={issue(issues, "entityDetails.formerName")}
        />
        <ReviewField
          id="entity-name-change"
          label="Date of name change"
          type="date"
          value={entity.dateOfNameChange ?? ""}
          onChange={(e) => set("dateOfNameChange", e.target.value)}
          error={issue(issues, "entityDetails.dateOfNameChange")}
        />
        <ReviewSelect
          id="entity-type"
          label="Entity type"
          value={canonicalizeEntityType(entity.entityType) as string}
          onChange={(e) => set("entityType", e.target.value)}
          error={issue(issues, "entityDetails.entityType")}
        >
          <option value="">Select</option>
          {BIZFILE_ENTITY_TYPE_OPTIONS.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}
        </ReviewSelect>
        <ReviewSelect
          id="entity-status"
          label="Status"
          value={canonicalizeCompanyStatus(entity.status) as string}
          onChange={(e) => set("status", e.target.value)}
          error={issue(issues, "entityDetails.status")}
        >
          <option value="">Select</option>
          {BIZFILE_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}
        </ReviewSelect>
        <ReviewField
          id="entity-status-date"
          label="Status date"
          type="date"
          value={entity.statusDate ?? ""}
          onChange={(e) => set("statusDate", e.target.value)}
          error={issue(issues, "entityDetails.statusDate")}
        />
        <ReviewField
          id="entity-incorporation"
          label="Incorporation date"
          type="date"
          value={entity.incorporationDate ?? ""}
          onChange={(e) => set("incorporationDate", e.target.value)}
          error={issue(issues, "entityDetails.incorporationDate")}
        />
        <ReviewField
          id="entity-registration"
          label="Registration date"
          type="date"
          value={entity.registrationDate ?? ""}
          onChange={(e) => set("registrationDate", e.target.value)}
          error={issue(issues, "entityDetails.registrationDate")}
        />
      </div>
      <RepeatingRecordEditor<FormerName>
        title="Former names"
        items={formerNames}
        onChange={(items) =>
          onChange({
            ...draft,
            entityDetails: { ...entity, formerNames: items },
          })
        }
        createItem={() => ({ name: "" })}
        duplicateItem={(item) => ({ ...item })}
        getItemKey={(_item, index) => `former-name-${index}`}
        getItemLabel={(item, i) => item.name || `Former name ${i + 1}`}
        renderItem={(item, i, update) => (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
            <ReviewField
              id={`former-name-${i}`}
              label="Name"
              value={item.name}
              onChange={(e) => update({ ...item, name: e.target.value })}
              error={issue(issues, `entityDetails.formerNames.${i}.name`)}
            />
            <ReviewField
              id={`former-from-${i}`}
              label="Effective from"
              type="date"
              value={item.effectiveFrom ?? ""}
              onChange={(e) =>
                update({ ...item, effectiveFrom: e.target.value })
              }
              error={issue(
                issues,
                `entityDetails.formerNames.${i}.effectiveFrom`,
              )}
            />
            <ReviewField
              id={`former-to-${i}`}
              label="Effective to"
              type="date"
              value={item.effectiveTo ?? ""}
              onChange={(e) => update({ ...item, effectiveTo: e.target.value })}
              error={issue(
                issues,
                `entityDetails.formerNames.${i}.effectiveTo`,
              )}
            />
          </div>
        )}
      />
    </Section>
  );
}

function AddressFields({
  prefix,
  labelPrefix,
  value,
  onChange,
  effective,
  issues,
  path,
}: {
  prefix: string;
  labelPrefix: string;
  value: Partial<Address>;
  onChange: (value: Address) => void;
  effective?: boolean;
  issues: BizFileReviewIssue[];
  path: "registeredAddress" | "mailingAddress";
}) {
  const set = (field: keyof Address, next: string) =>
    onChange({ streetName: "", postalCode: "", ...value, [field]: next });
  return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
      {(
        [
          ["block", "block"],
          ["streetName", "street"],
          ["level", "level"],
          ["unit", "unit"],
          ["buildingName", "building name"],
          ["postalCode", "postal code"],
          ["country", "country"],
        ] as const
      ).map(([field, label]) => (
        <ReviewField
          key={field}
          id={`${prefix}-${field}`}
          label={`${labelPrefix} ${label}`.trim()}
          value={String(value[field] ?? "")}
          onChange={(e) => set(field, e.target.value)}
          error={issue(issues, `${path}.${field}`)}
        />
      ))}
      {effective && (
        <ReviewField
          id={`${prefix}-effective`}
          label="Effective from"
          type="date"
          value={value.effectiveFrom ?? ""}
          onChange={(e) => set("effectiveFrom", e.target.value)}
          error={issue(issues, `${path}.effectiveFrom`)}
        />
      )}
    </div>
  );
}
export function AddressesSection({ draft, onChange, issues }: Props) {
  const mailingAddressSameAsRegistered = draft.mailingAddressSameAsRegistered ?? !draft.mailingAddress;
  return (
    <Section title="Addresses">
      <fieldset aria-label="Registered address">
        <AddressFields
          prefix="registered"
          labelPrefix="Registered"
          value={draft.registeredAddress ?? {}}
          effective
          issues={issues}
          path="registeredAddress"
          onChange={(registeredAddress) =>
            onChange({ ...draft, registeredAddress })
          }
        />
      </fieldset>
      <fieldset aria-label="Mailing address">
        <ReviewCheckbox
          id="mailing-same-as-registered"
          label="Same as Registered Address"
          checked={mailingAddressSameAsRegistered}
          onChange={(event) => onChange({
            ...draft,
            mailingAddressSameAsRegistered: event.target.checked,
            mailingAddress: event.target.checked ? draft.mailingAddress : undefined,
          })}
        />
        {!mailingAddressSameAsRegistered && (
          <div className="mt-3">
            <AddressFields
              prefix="mailing"
              labelPrefix="Mailing"
              value={draft.mailingAddress ?? {}}
              issues={issues}
              path="mailingAddress"
              onChange={(mailingAddress) => onChange({ ...draft, mailingAddress })}
            />
          </div>
        )}
      </fieldset>
    </Section>
  );
}

export function ActivitiesSection({ draft, onChange, issues }: Props) {
  const activities = draft.ssicActivities ?? {};
  const activity = (kind: "primary" | "secondary") =>
    activities[kind] ?? { code: "", description: "" };
  const set = (
    kind: "primary" | "secondary",
    field: "code" | "description",
    value: string,
  ) =>
    onChange({
      ...draft,
      ssicActivities: {
        ...activities,
        [kind]: { ...activity(kind), [field]: value },
      },
    });
  return (
    <Section title="Business activities">
      {(["primary", "secondary"] as const).map((kind) => (
        <div key={kind} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
          <ReviewField
            id={`${kind}-ssic-code`}
            label={`${kind === "primary" ? "Primary" : "Secondary"} SSIC code`}
            value={activity(kind).code}
            onChange={(e) => set(kind, "code", e.target.value)}
            error={issue(issues, `ssicActivities.${kind}.code`)}
          />
          <ReviewTextarea
            id={`${kind}-ssic-description`}
            label={`${kind === "primary" ? "Primary" : "Secondary"} description`}
            value={activity(kind).description}
            onChange={(e) => set(kind, "description", e.target.value)}
            error={issue(issues, `ssicActivities.${kind}.description`)}
          />
        </div>
      ))}
    </Section>
  );
}

export function CapitalSection({ draft, onChange, issues }: Props) {
  const shares = draft.shareCapital ?? [];
  const capital = (kind: "paidUpCapital" | "issuedCapital") =>
    draft[kind] ?? { amount: 0, currency: "" };
  const setCapital = (
    kind: "paidUpCapital" | "issuedCapital",
    field: "amount" | "currency",
    value: string,
  ) =>
    onChange({
      ...draft,
      [kind]: {
        ...capital(kind),
        [field]: field === "amount" ? numberValue(value) : value,
      },
    });
  return (
    <Section title="Capital">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        {(["paidUpCapital", "issuedCapital"] as const).flatMap((kind) => [
          <ReviewField
            key={`${kind}-amount`}
            id={`${kind}-amount`}
            label={
              kind === "paidUpCapital" ? "Paid-up capital" : "Issued capital"
            }
            type="number"
            min="0"
            step="any"
            value={capital(kind).amount ?? ""}
            onChange={(e) => setCapital(kind, "amount", e.target.value)}
            error={issue(issues, `${kind}.amount`)}
          />,
          <ReviewField
            key={`${kind}-currency`}
            id={`${kind}-currency`}
            label={`${kind === "paidUpCapital" ? "Paid-up" : "Issued"} currency`}
            value={capital(kind).currency}
            onChange={(e) => setCapital(kind, "currency", e.target.value)}
            error={issue(issues, `${kind}.currency`)}
          />,
        ])}
        <ReviewField
          id="treasury-shares"
          label="Treasury shares"
          type="number"
          min="0"
          step="1"
          value={draft.treasuryShares?.numberOfShares ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              treasuryShares: {
                ...draft.treasuryShares,
                numberOfShares: numberValue(e.target.value),
              },
            })
          }
          error={issue(issues, "treasuryShares.numberOfShares")}
        />
        <ReviewField
          id="treasury-currency"
          label="Treasury currency"
          value={draft.treasuryShares?.currency ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              treasuryShares: {
                numberOfShares: draft.treasuryShares?.numberOfShares ?? 0,
                currency: e.target.value,
              },
            })
          }
          error={issue(issues, "treasuryShares.currency")}
        />
        <ReviewField
          id="home-currency"
          label="Home currency"
          value={draft.homeCurrency ?? ""}
          onChange={(e) => onChange({ ...draft, homeCurrency: e.target.value })}
          error={issue(issues, "homeCurrency")}
        />
      </div>
      <RepeatingRecordEditor<ShareCapital>
        title="Share capital"
        items={shares}
        onChange={(shareCapital) => onChange({ ...draft, shareCapital })}
        createItem={() => ({
          shareClass: "",
          currency: "",
          numberOfShares: 0,
          totalValue: 0,
          isPaidUp: false,
        })}
        duplicateItem={(item) => ({ ...item })}
        getItemKey={(_item, index) => `share-capital-${index}`}
        getItemLabel={(item, i) => item.shareClass || `Share class ${i + 1}`}
        renderItem={(item, i, update) => (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
            <ReviewField
              id={`share-class-${i}`}
              label="Share class"
              value={item.shareClass}
              onChange={(e) => update({ ...item, shareClass: e.target.value })}
              error={issue(issues, `shareCapital.${i}.shareClass`)}
            />
            <ReviewField
              id={`share-currency-${i}`}
              label="Currency"
              value={item.currency}
              onChange={(e) => update({ ...item, currency: e.target.value })}
              error={issue(issues, `shareCapital.${i}.currency`)}
            />
            <ReviewField
              id={`share-number-${i}`}
              label="Number of shares"
              type="number"
              min="0"
              step="1"
              value={item.numberOfShares ?? ""}
              onChange={(e) =>
                update({ ...item, numberOfShares: numberValue(e.target.value) })
              }
              error={issue(issues, `shareCapital.${i}.numberOfShares`)}
            />
            <ReviewField
              id={`share-par-${i}`}
              label="Par value"
              type="number"
              min="0"
              step="any"
              value={item.parValue ?? ""}
              onChange={(e) => {
                const parValue = numberValue(e.target.value);
                if (parValue === undefined) {
                  const next = { ...item };
                  delete next.parValue;
                  update(next);
                } else update({ ...item, parValue });
              }}
              error={issue(issues, `shareCapital.${i}.parValue`)}
            />
            <ReviewField
              id={`share-total-${i}`}
              label="Total value"
              type="number"
              min="0"
              step="any"
              value={item.totalValue ?? ""}
              onChange={(e) =>
                update({ ...item, totalValue: numberValue(e.target.value) })
              }
              error={issue(issues, `shareCapital.${i}.totalValue`)}
            />
            <ReviewCheckbox
              id={`share-paid-${i}`}
              label="Paid up"
              checked={item.isPaidUp}
              onChange={(e) => update({ ...item, isPaidUp: e.target.checked })}
              error={issue(issues, `shareCapital.${i}.isPaidUp`)}
            />
            <ReviewCheckbox
              id={`share-treasury-${i}`}
              label="Treasury"
              checked={item.isTreasury ?? false}
              onChange={(e) =>
                update({ ...item, isTreasury: e.target.checked })
              }
              error={issue(issues, `shareCapital.${i}.isTreasury`)}
            />
            {item.reviewFlags?.length ? (
              <div className="col-span-full rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-status-warning">
                {item.reviewFlags.map((flag) => <p key={flag}>{flag}</p>)}
              </div>
            ) : null}
          </div>
        )}
      />
    </Section>
  );
}

const identificationOptions = (
  <>
    <option value="">Select</option>
    {BIZFILE_IDENTIFICATION_TYPE_OPTIONS.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}
  </>
);

const reasonLabels: Record<string, string> = {
  IDENTIFIER: "Same identification number",
  CORPORATE_UEN: "Same corporate UEN",
  APPROVED_ALIAS: "Approved alias",
  EXACT_CANONICAL_NAME: "Exact name",
  CORPORATE_SUFFIX_VARIANT: "Equivalent company name",
  FUZZY_NAME: "Similar name",
};

export function ContactMatchPanel({
  path, recordName, match, resolution, onChange, error,
}: {
  path: string;
  recordName: string;
  match: ContactMatchPreview;
  resolution: Exclude<ContactResolutionDecision, { action: "AUTO" }> | undefined;
  onChange: (resolution: Exclude<ContactResolutionDecision, { action: "AUTO" }>) => void;
  error?: BizFileReviewIssue;
}) {
  if (isExactIdentifierContactMatch(recordName, match)) return null;
  return <div tabIndex={-1} data-field-path={`${path}.contactResolution`}
    className="col-span-full rounded-md border border-oak-primary/30 bg-oak-primary/5 p-3">
    <p className="text-sm font-medium text-text-primary">Existing contact match</p>
    {match.contact ? <div className="mt-1 space-y-1 text-xs text-text-secondary">
      <Link className="font-medium text-oak-primary hover:underline" href={`/contacts/${match.contact.id}`}>{match.contact.fullName}</Link>
      {(match.contact.identificationNumber || match.contact.corporateUen) && <p>
        {[match.contact.identificationType, match.contact.identificationNumber || match.contact.corporateUen].filter(Boolean).join(" ")}
      </p>}
      {match.contact.companies.length > 0 && <p className="flex flex-wrap gap-x-2">
        {match.contact.companies.map((company) => <Link key={company.id} className="text-oak-primary hover:underline" href={`/companies/${company.id}`}>
          {company.name} ({company.uen})
        </Link>)}
      </p>}
    </div> : null}
    <p className="mt-2 text-xs text-text-secondary">{match.reasons.map((reason) => reasonLabels[reason] ?? reason).join(" ")}</p>
    {match.conflicts.length > 0 && <p className="mt-1 text-xs text-status-warning">Conflicting identity details require a reviewed decision.</p>}
    {error && <p className="mt-2 text-xs text-status-error">{error.message}</p>}
    {!resolution && !error && <p className="mt-2 text-xs text-status-error">Choose how to resolve this contact match</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="xs" variant={resolution?.action === "REUSE" ? "primary" : "secondary"}
        disabled={match.blockedByIdentifierConflict}
        onClick={() => onChange({ action: "REUSE", contactId: match.contactId })}>Use existing</Button>
      <Button size="xs" variant={resolution?.action === "CREATE_SEPARATE" ? "primary" : "secondary"}
        onClick={() => onChange({ action: "CREATE_SEPARATE", reason: "" })}>Create separate</Button>
    </div>
    {resolution?.action === "CREATE_SEPARATE" && <div className="mt-2">
      <ReviewTextarea id={`${path.replace(".", "-")}-separate-reason`} label="Reason for separate contact"
        value={resolution.reason} onChange={(event) => onChange({ action: "CREATE_SEPARATE", reason: event.target.value })}
        error={error} />
    </div>}
  </div>;
}

export function OfficersSection({ draft, onChange, issues, matchPreviews = {} }: Props) {
  const items = draft.officers ?? [];
  return (
    <Section title="Officers">
      <RepeatingRecordEditor<Officer>
        title="Officers"
        items={items}
        onChange={(officers) => onChange({ ...draft, officers })}
        createItem={() => ({ name: "", role: "DIRECTOR" })}
        duplicateItem={(item) => ({ ...item })}
        getItemKey={(_item, index) => `officer-${index}`}
        getItemLabel={(item, i) => item.name || `Officer ${i + 1}`}
        renderItem={(item, i, update) => (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
            <ReviewField
              id={`officer-name-${i}`}
              label="Name"
              value={item.name}
              onChange={(e) => update({ ...item, name: e.target.value })}
              error={issue(issues, `officers.${i}.name`)}
            />
            <ReviewSelect
              id={`officer-role-${i}`}
              label="Officer role"
              value={canonicalizeOfficerRole(item.role) as string}
              onChange={(e) => update({ ...item, role: e.target.value })}
              error={issue(issues, `officers.${i}.role`)}
            >
              {BIZFILE_OFFICER_ROLE_OPTIONS.map((value) => <option key={value} value={value}>{optionLabel(value)}</option>)}
            </ReviewSelect>
            <ReviewSelect
              id={`officer-id-type-${i}`}
              label="Identification type"
              value={(canonicalizeIdentificationType(item.identificationType) as string | undefined) ?? ""}
              onChange={(e) =>
                update({ ...item, identificationType: e.target.value || undefined })
              }
              error={issue(issues, `officers.${i}.identificationType`)}
            >
              {identificationOptions}
            </ReviewSelect>
            <ReviewField
              id={`officer-id-${i}`}
              label="Identification number"
              value={item.identificationNumber ?? ""}
              onChange={(e) =>
                update({ ...item, identificationNumber: e.target.value })
              }
              error={issue(issues, `officers.${i}.identificationNumber`)}
            />
            <ReviewField
              id={`officer-nationality-${i}`}
              label="Nationality"
              value={item.nationality ?? ""}
              onChange={(e) => update({ ...item, nationality: e.target.value })}
              error={issue(issues, `officers.${i}.nationality`)}
            />
            <ReviewTextarea
              id={`officer-address-${i}`}
              label="Address"
              value={item.address ?? ""}
              onChange={(e) => update({ ...item, address: e.target.value })}
              error={issue(issues, `officers.${i}.address`)}
            />
            <ReviewField
              id={`officer-appointed-${i}`}
              label="Appointment date"
              type="date"
              value={item.appointmentDate ?? ""}
              onChange={(e) =>
                update({ ...item, appointmentDate: e.target.value })
              }
              error={issue(issues, `officers.${i}.appointmentDate`)}
            />
            <ReviewField
              id={`officer-ceased-${i}`}
              label="Cessation date"
              type="date"
              value={item.cessationDate ?? ""}
              onChange={(e) =>
                update({ ...item, cessationDate: e.target.value })
              }
              error={issue(issues, `officers.${i}.cessationDate`)}
            />
            {matchPreviews[`officers.${i}`] ? <ContactMatchPanel
              path={`officers.${i}`} match={matchPreviews[`officers.${i}`]!}
              recordName={item.name}
              resolution={item.contactResolution}
              onChange={(contactResolution) => update({ ...item, contactResolution })}
              error={issue(issues, `officers.${i}.contactResolution`) ?? issue(issues, `officers.${i}.contactResolution.reason`)}
            /> : null}
          </div>
        )}
      />
    </Section>
  );
}

export function ShareholdersSection({ draft, onChange, issues, matchPreviews = {} }: Props) {
  const items = draft.shareholders ?? [];
  return (
    <Section title="Shareholders">
      <RepeatingRecordEditor<Shareholder>
        title="Shareholders"
        items={items}
        onChange={(shareholders) => onChange({ ...draft, shareholders })}
        createItem={() => ({
          name: "",
          type: "INDIVIDUAL",
          isNominee: false,
          shareClass: "",
          numberOfShares: 0,
        })}
        duplicateItem={(item) => ({ ...item })}
        getItemKey={(_item, index) => `shareholder-${index}`}
        getItemLabel={(item, i) => item.name || `Shareholder ${i + 1}`}
        renderItem={(item, i, update) => (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
            <ReviewField
              id={`holder-name-${i}`}
              label="Name"
              value={item.name}
              onChange={(e) => update({ ...item, name: e.target.value })}
              error={issue(issues, `shareholders.${i}.name`)}
            />
            <ReviewSelect
              id={`holder-type-${i}`}
              label="Shareholder type"
              value={item.type}
              onChange={(e) =>
                update({ ...item, type: e.target.value as typeof item.type })
              }
              error={issue(issues, `shareholders.${i}.type`)}
            >
              <option value="INDIVIDUAL">Individual</option>
              <option value="CORPORATE">Corporate</option>
            </ReviewSelect>
            <ReviewCheckbox
              id={`holder-nominee-${i}`}
              label="Nominee shareholder"
              checked={Boolean(item.isNominee)}
              onChange={(e) => update({ ...item, isNominee: e.target.checked })}
            />
            <ReviewSelect
              id={`holder-id-type-${i}`}
              label="Identification type"
              value={(canonicalizeIdentificationType(item.identificationType) as string | undefined) ?? ""}
              onChange={(e) =>
                update({ ...item, identificationType: e.target.value || undefined })
              }
              error={issue(issues, `shareholders.${i}.identificationType`)}
            >
              {identificationOptions}
            </ReviewSelect>
            {(
              [
                ["identificationNumber", "Identification number"],
                ["nationality", "Nationality"],
                ["placeOfOrigin", "Place of origin"],
                ["address", "Address"],
                ["shareClass", "Share class"],
                ["currency", "Currency"],
              ] as const
            ).map(([field, label]) => (
              <ReviewField
                key={field}
                id={`holder-${field}-${i}`}
                label={label}
                value={item[field] ?? ""}
                onChange={(e) => update({ ...item, [field]: e.target.value })}
                error={issue(issues, `shareholders.${i}.${field}`)}
              />
            ))}
            <ReviewField
              id={`holder-shares-${i}`}
              label="Number of shares"
              type="number"
              min="0"
              step="1"
              value={item.numberOfShares ?? ""}
              onChange={(e) =>
                update({ ...item, numberOfShares: numberValue(e.target.value) })
              }
              error={issue(issues, `shareholders.${i}.numberOfShares`)}
            />
            <ReviewField
              id={`holder-percent-${i}`}
              label="Percentage held"
              type="number"
              min="0"
              max="100"
              step="any"
              value={item.percentageHeld ?? ""}
              onChange={(e) => {
                const percentageHeld = numberValue(e.target.value);
                if (percentageHeld === undefined) {
                  const next = { ...item };
                  delete next.percentageHeld;
                  update(next);
                } else update({ ...item, percentageHeld });
              }}
              error={issue(issues, `shareholders.${i}.percentageHeld`)}
            />
            {matchPreviews[`shareholders.${i}`] ? <ContactMatchPanel
              path={`shareholders.${i}`} match={matchPreviews[`shareholders.${i}`]!}
              recordName={item.name}
              resolution={item.contactResolution}
              onChange={(contactResolution) => update({ ...item, contactResolution })}
              error={issue(issues, `shareholders.${i}.contactResolution`) ?? issue(issues, `shareholders.${i}.contactResolution.reason`)}
            /> : null}
          </div>
        )}
      />
    </Section>
  );
}

export function AuditorSection({ draft, onChange, issues }: Props) {
  const auditor = draft.auditor ?? { name: "" };
  const set = (field: keyof typeof auditor, value: string) =>
    onChange({ ...draft, auditor: { ...auditor, [field]: value } });
  return (
    <Section title="Auditor">
      <fieldset aria-label="Auditor" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        <ReviewField
          id="auditor-name"
          label="Auditor name"
          value={auditor.name}
          onChange={(e) => set("name", e.target.value)}
          error={issue(issues, "auditor.name")}
        />
        <ReviewTextarea
          id="auditor-address"
          label="Auditor address"
          value={auditor.address ?? ""}
          onChange={(e) => set("address", e.target.value)}
          error={issue(issues, "auditor.address")}
        />
        <ReviewField
          id="auditor-appointed"
          label="Appointment date"
          type="date"
          value={auditor.appointmentDate ?? ""}
          onChange={(e) => set("appointmentDate", e.target.value)}
          error={issue(issues, "auditor.appointmentDate")}
        />
      </fieldset>
    </Section>
  );
}

export function ComplianceSection({ draft, onChange, issues }: Props) {
  const financial = draft.financialYear ?? { endDay: 1, endMonth: 1 };
  const compliance = draft.compliance ?? {};
  return (
    <Section title="Compliance">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        <ReviewField
          id="fye-day"
          label="Financial year end day"
          type="number"
          min="1"
          max="31"
          step="1"
          value={financial.endDay ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              financialYear: {
                ...financial,
                endDay: numberValue(e.target.value),
              },
            })
          }
          error={issue(issues, "financialYear.endDay")}
        />
        <ReviewField
          id="fye-month"
          label="Financial year end month"
          type="number"
          min="1"
          max="12"
          step="1"
          value={financial.endMonth ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              financialYear: {
                ...financial,
                endMonth: numberValue(e.target.value),
              },
            })
          }
          error={issue(issues, "financialYear.endMonth")}
        />
        {(
          [
            ["lastAgmDate", "Last AGM date"],
            ["lastArFiledDate", "Last AR filed date"],
            ["accountsDueDate", "Accounts due date"],
            ["fyeAsAtLastAr", "FYE as at last AR"],
          ] as const
        ).map(([field, label]) => (
          <ReviewField
            key={field}
            id={`compliance-${field}`}
            label={label}
            type="date"
            value={compliance[field] ?? ""}
            onChange={(e) =>
              onChange({
                ...draft,
                compliance: { ...compliance, [field]: e.target.value },
              })
            }
            error={issue(issues, `compliance.${field}`)}
          />
        ))}
      </div>
    </Section>
  );
}

export function ChargesSection({ draft, onChange, issues }: Props) {
  const items = draft.charges ?? [];
  return (
    <Section title="Charges">
      <RepeatingRecordEditor<Charge>
        title="Charges"
        items={items}
        onChange={(charges) => onChange({ ...draft, charges })}
        createItem={() => ({ chargeHolderName: "" })}
        duplicateItem={(item) => ({ ...item })}
        getItemKey={(_item, index) => `charge-${index}`}
        getItemLabel={(item, i) => item.chargeNumber || `Charge ${i + 1}`}
        renderItem={(item, i, update) => (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
            {(
              [
                ["chargeNumber", "Charge number"],
                ["chargeType", "Charge type"],
                ["description", "Description"],
                ["chargeHolderName", "Charge holder"],
                ["amountSecuredText", "Amount secured text"],
                ["currency", "Currency"],
              ] as const
            ).map(([field, label]) => (
              <ReviewField
                key={field}
                id={`charge-${field}-${i}`}
                label={label}
                value={item[field] ?? ""}
                onChange={(e) => update({ ...item, [field]: e.target.value })}
                error={issue(issues, `charges.${i}.${field}`)}
              />
            ))}
            <ReviewField
              id={`charge-amount-${i}`}
              label="Amount secured"
              type="number"
              min="0"
              step="any"
              value={item.amountSecured ?? ""}
              onChange={(e) => {
                const amountSecured = numberValue(e.target.value);
                if (amountSecured === undefined) {
                  const next = { ...item };
                  delete next.amountSecured;
                  update(next);
                } else update({ ...item, amountSecured });
              }}
              error={issue(issues, `charges.${i}.amountSecured`)}
            />
            <ReviewField
              id={`charge-registered-${i}`}
              label="Registration date"
              type="date"
              value={item.registrationDate ?? ""}
              onChange={(e) =>
                update({ ...item, registrationDate: e.target.value })
              }
              error={issue(issues, `charges.${i}.registrationDate`)}
            />
            <ReviewField
              id={`charge-discharged-${i}`}
              label="Discharge date"
              type="date"
              value={item.dischargeDate ?? ""}
              onChange={(e) =>
                update({ ...item, dischargeDate: e.target.value })
              }
              error={issue(issues, `charges.${i}.dischargeDate`)}
            />
          </div>
        )}
      />
    </Section>
  );
}

export function DocumentSection({ draft, onChange, issues }: Props) {
  const metadata = draft.documentMetadata ?? {};
  return (
    <Section title="Document">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        <ReviewField
          id="receipt-number"
          label="Receipt number"
          value={metadata.receiptNo ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              documentMetadata: { ...metadata, receiptNo: e.target.value },
            })
          }
          error={issue(issues, "documentMetadata.receiptNo")}
        />
        <ReviewField
          id="receipt-date"
          label="Receipt date"
          type="date"
          value={metadata.receiptDate ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              documentMetadata: { ...metadata, receiptDate: e.target.value },
            })
          }
          error={issue(issues, "documentMetadata.receiptDate")}
        />
      </div>
    </Section>
  );
}

const sections: Record<
  BizFileReviewSectionId,
  (props: Props) => React.ReactNode
> = {
  entity: EntitySection,
  addresses: AddressesSection,
  activities: ActivitiesSection,
  capital: CapitalSection,
  officers: OfficersSection,
  shareholders: ShareholdersSection,
  auditor: AuditorSection,
  compliance: ComplianceSection,
  charges: ChargesSection,
  document: DocumentSection,
};
export function BizFileReviewSections({
  activeSection,
  ...props
}: Props & { activeSection: BizFileReviewSectionId }) {
  const Active = sections[activeSection];
  return <Active {...props} />;
}
