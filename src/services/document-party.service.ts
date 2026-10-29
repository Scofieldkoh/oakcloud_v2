import { prisma } from '@/lib/prisma';
import { formatOakDocRole } from '@/lib/document-editor/oakdoc-repeater-definitions';
import {
  buildPartyContactFields,
  contactIdentity,
  type DocumentParty,
} from '@/lib/document-party';
import { canonicalAppointment, rankAppointments } from '@/lib/representative-authority';

const POSITION_APPOINTMENTS = new Set([
  'Director',
  'Managing Director',
  'Alternate Director',
  'Nominee Director',
  'Company Secretary',
  'CEO',
  'CFO',
  'Auditor',
  'Liquidator',
  'Receiver',
  'Judicial Manager',
  'Shareholder',
]);

function isPositionRelationship(value: string): boolean {
  const appointment = canonicalAppointment(value);
  return Boolean(
    appointment
    && (POSITION_APPOINTMENTS.has(appointment) || appointment.endsWith('Shareholder'))
  );
}

function withoutBlankIdentity<T extends { identificationNumber?: string | null; identificationType?: string | null }>(
  fields: T | undefined,
): Partial<T> {
  if (!fields) return {};
  if (fields.identificationNumber?.trim()) return fields;
  const rest: Partial<T> = { ...fields };
  delete rest.identificationNumber;
  delete rest.identificationType;
  return rest;
}

export interface DocumentPartySelections {
  selectedDirector?: DocumentParty;
  selectedDirectors?: DocumentParty[];
  selectedShareholder?: DocumentParty;
  selectedContact?: DocumentParty;
}

function contactSelect(tenantId: string) {
  return {
    id: true,
    fullName: true,
    contactType: true,
    fullAddress: true,
    identificationType: true,
    identificationNumber: true,
    corporateUen: true,
    contactDetails: {
      where: { tenantId, deletedAt: null },
      select: {
        detailType: true,
        value: true,
        companyId: true,
        isPrimary: true,
        displayOrder: true,
        createdAt: true,
      },
    },
  } as const;
}

export async function getDocumentPartyOptions(
  companyId: string,
  tenantId: string,
) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
    select: {
      id: true,
      officers: {
        where: { isCurrent: true, cessationDate: null },
        select: {
          id: true,
          contactId: true,
          name: true,
          role: true,
          nationality: true,
          identificationType: true,
          identificationNumber: true,
          address: true,
          appointmentDate: true,
        },
      },
      shareholders: {
        where: { isCurrent: true },
        select: {
          id: true,
          contactId: true,
          name: true,
          shareholderType: true,
          nationality: true,
          identificationType: true,
          identificationNumber: true,
          shareClass: true,
          numberOfShares: true,
          percentageHeld: true,
          address: true,
        },
      },
      contacts: {
        where: { deletedAt: null },
        select: {
          contactId: true,
          relationship: true,
        },
      },
    },
  });

  if (!company) throw new Error('Company not found');

  const linkedContactIds = Array.from(
    new Set(
      [
        ...company.officers.map((officer) => officer.contactId),
        ...company.shareholders.map((shareholder) => shareholder.contactId),
        ...company.contacts
          .filter((relation) => !isPositionRelationship(relation.relationship))
          .map((relation) => relation.contactId),
      ].filter((contactId): contactId is string => Boolean(contactId)),
    ),
  );
  const eligibleContacts = linkedContactIds.length
    ? await prisma.contact.findMany({
        where: {
          id: { in: linkedContactIds },
          tenantId,
          deletedAt: null,
          isActive: true,
        },
        select: contactSelect(tenantId),
      })
    : [];
  const eligibleContactMap = new Map(
    eligibleContacts.map((contact) => [contact.id, contact]),
  );

  const toParty = (record: {
    id: string;
    contactId?: string | null;
    name: string;
    detail: string | null;
    roleAddress?: string | null;
    roleFields?: Partial<
      Pick<
        DocumentParty,
        | 'nationality'
        | 'identificationNumber'
        | 'identificationType'
        | 'role'
        | 'appointmentDate'
        | 'shareholderType'
        | 'shareClass'
        | 'numberOfShares'
        | 'percentageHeld'
      >
    >;
    contact?: {
      id: string;
      fullName: string;
      contactType: string;
      fullAddress: string | null;
      identificationType: string | null;
      identificationNumber: string | null;
      corporateUen: string | null;
      contactDetails: Array<{
        detailType: string;
        value: string;
        companyId: string | null;
        isPrimary: boolean;
        displayOrder: number;
        createdAt: Date;
      }>;
    } | null;
  }): DocumentParty => ({
    id: record.id,
    contactId: record.contactId ?? record.contact?.id ?? null,
    name: record.name,
    detail: record.detail,
    contactType: record.contact?.contactType ?? null,
    // A role record without its own number (a corporate shareholder keyed
    // in by hand) prints its contact's: a company's UEN.
    ...(record.contact ? contactIdentity(record.contact) : {}),
    ...withoutBlankIdentity(record.roleFields),
    ...buildPartyContactFields({
      companyId,
      roleAddress: record.roleAddress,
      contactAddress: record.contact?.fullAddress,
      contactDetails: record.contact?.contactDetails,
    }),
  });

  const officerParties = company.officers.map((officer) =>
    toParty({
      id: officer.id,
      contactId: officer.contactId,
      name: officer.name,
      detail: officer.role,
      roleAddress: officer.address,
      contact: officer.contactId
        ? eligibleContactMap.get(officer.contactId)
        : undefined,
      roleFields: {
        role: officer.role,
        nationality: officer.nationality,
        identificationNumber: officer.identificationNumber,
        identificationType: officer.identificationType,
        appointmentDate: officer.appointmentDate,
      },
    }),
  );
  // Every director appointment (managing, alternate, nominee), matching the
  // Word directors repeater so its checkboxes list everyone it can print.
  const directors = officerParties.filter((_, index) =>
    company.officers[index].role.includes('DIRECTOR'));
  const shareholders = company.shareholders.map((shareholder) =>
    toParty({
      id: shareholder.id,
      contactId: shareholder.contactId,
      name: shareholder.name,
      detail: shareholder.shareClass,
      roleAddress: shareholder.address,
      contact: shareholder.contactId
        ? eligibleContactMap.get(shareholder.contactId)
        : undefined,
      roleFields: {
        shareholderType: shareholder.shareholderType,
        nationality: shareholder.nationality,
        identificationNumber: shareholder.identificationNumber,
        identificationType: shareholder.identificationType,
        shareClass: shareholder.shareClass,
        numberOfShares: shareholder.numberOfShares,
        percentageHeld: shareholder.percentageHeld?.toString() ?? null,
      },
    }),
  );

  const appointmentsByContactId = new Map<string, string[]>();
  const addAppointment = (contactId: string | null | undefined, appointment: string) => {
    if (!contactId) return;
    appointmentsByContactId.set(contactId, [
      ...(appointmentsByContactId.get(contactId) ?? []),
      appointment,
    ]);
  };
  for (const relation of company.contacts) {
    if (!isPositionRelationship(relation.relationship)) {
      addAppointment(relation.contactId, relation.relationship);
    }
  }
  for (const officer of company.officers) {
    addAppointment(officer.contactId, officer.role);
  }
  for (const shareholder of company.shareholders) {
    addAppointment(shareholder.contactId, 'Shareholder');
  }

  const contacts = [...eligibleContactMap.values()].flatMap((contact) => {
    const appointments = rankAppointments(appointmentsByContactId.get(contact.id) ?? []);
    if (appointments.length === 0) return [];
    return [{
      ...toParty({
        id: contact.id,
        contactId: contact.id,
        name: contact.fullName,
        detail: appointments[0],
        contact,
      }),
      appointments,
    }];
  });

  return {
    directors,
    shareholders,
    contacts,
    /** Every current officer, any role, for the Word officers repeater. */
    officers: officerParties.map((party) => ({
      ...party,
      detail: formatOakDocRole(party.role?.replace(/_/g, ' ')),
    })),
  };
}

export async function resolveDocumentPartySelections(input: {
  companyId: string;
  tenantId: string;
  selectedDirectorId?: string;
  selectedDirectorIds?: string[];
  selectedShareholderId?: string;
  selectedContactId?: string;
}): Promise<DocumentPartySelections> {
  const options = await getDocumentPartyOptions(input.companyId, input.tenantId);
  const selectedDirector = input.selectedDirectorId
    ? options.directors.find((party) => party.id === input.selectedDirectorId)
    : undefined;
  const selectedDirectors = input.selectedDirectorIds === undefined
    ? undefined
    : input.selectedDirectorIds.map((id) =>
        options.directors.find((party) => party.id === id),
      );
  const selectedShareholder = input.selectedShareholderId
    ? options.shareholders.find(
        (party) => party.id === input.selectedShareholderId,
      )
    : undefined;
  const selectedContact = input.selectedContactId
    ? options.contacts.find((party) => party.id === input.selectedContactId)
    : undefined;

  if (input.selectedDirectorId && !selectedDirector) {
    throw new Error(
      'Selected director is not a current director of this company',
    );
  }
  if (selectedDirectors?.some((party) => !party)) {
    throw new Error(
      'Selected director is not a current director of this company',
    );
  }
  const validSelectedDirectors = selectedDirectors?.filter(
    (party): party is DocumentParty => Boolean(party),
  );
  if (input.selectedShareholderId && !selectedShareholder) {
    throw new Error(
      'Selected shareholder is not a current shareholder of this company',
    );
  }
  if (input.selectedContactId && !selectedContact) {
    throw new Error('Selected contact is not linked to this company');
  }

  return {
    selectedDirector,
    ...(validSelectedDirectors ? { selectedDirectors: validSelectedDirectors } : {}),
    selectedShareholder,
    selectedContact,
  };
}

/**
 * Contacts picked for a document from the Contacts list, in the order given.
 * Any active contact in the workspace qualifies, not only the company's own;
 * a contact linked to the company shows its role there and its
 * company-specific email and phone.
 */
export async function getDocumentContactParties(input: {
  contactIds: readonly string[];
  tenantId: string;
  companyId?: string | null;
}): Promise<DocumentParty[]> {
  const ids = Array.from(new Set(input.contactIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const companyId = input.companyId ?? null;
  const rows = await prisma.contact.findMany({
    where: { id: { in: ids }, tenantId: input.tenantId, deletedAt: null },
    select: {
      ...contactSelect(input.tenantId),
      nationality: true,
      companyRelations: {
        where: { companyId: companyId ?? '', deletedAt: null },
        select: { relationship: true },
      },
      officerPositions: {
        where: { companyId: companyId ?? '', isCurrent: true, cessationDate: null },
        select: { role: true },
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const contact = byId.get(id);
    if (!contact) return [];
    const appointments = rankAppointments([
      ...contact.companyRelations.map((relation) => relation.relationship),
      ...contact.officerPositions.map((position) => position.role),
    ]);
    return [{
      id: contact.id,
      contactId: contact.id,
      name: contact.fullName,
      detail: appointments[0] ?? null,
      appointments,
      role: appointments[0] ?? null,
      contactType: contact.contactType,
      ...contactIdentity(contact),
      nationality: contact.nationality,
      ...buildPartyContactFields({
        companyId: companyId ?? '',
        contactAddress: contact.fullAddress,
        contactDetails: contact.contactDetails,
      }),
    }];
  });
}
