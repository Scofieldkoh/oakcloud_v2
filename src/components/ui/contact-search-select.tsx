'use client';

import { useState, useEffect, useMemo } from 'react';
import { User } from 'lucide-react';
import { useContacts } from '@/hooks/use-contacts';
import { AsyncSearchSelect, type AsyncSearchSelectOption } from './async-search-select';
import type { Contact } from '@/generated/prisma';

export type SearchableContact = Contact & {
  defaultEmail?: string | null;
  defaultPhone?: string | null;
};

interface ContactOption extends AsyncSearchSelectOption {
  contact: SearchableContact;
}

interface ContactSearchSelectProps {
  label?: string;
  value: string;
  onChange: (contactId: string, contact: SearchableContact | null) => void;
  selectedContact?: SearchableContact | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  controlClassName?: string;
}

export function ContactSearchSelect({
  label,
  value,
  onChange,
  selectedContact = null,
  placeholder = 'Search contacts...',
  disabled = false,
  className,
  controlClassName,
}: ContactSearchSelectProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: contactsData, isLoading, error, refetch } = useContacts({
    query: debouncedQuery || undefined,
    limit: 50,
    sortBy: 'fullName',
    sortOrder: 'asc',
  });

  const options: ContactOption[] = useMemo(() => {
    const contacts = contactsData?.contacts || [];
    const nextOptions = contacts.map((contact) => ({
      id: contact.id,
      label: contact.fullName,
      description: contact.defaultEmail || contact.identificationNumber || undefined,
      contact,
    }));

    if (selectedContact && !nextOptions.some((option) => option.id === selectedContact.id)) {
      nextOptions.unshift({
        id: selectedContact.id,
        label: selectedContact.fullName,
        description: selectedContact.defaultEmail || selectedContact.identificationNumber || undefined,
        contact: selectedContact,
      });
    }

    return nextOptions;
  }, [contactsData?.contacts, selectedContact]);

  const handleChange = (id: string, option: ContactOption | null) => {
    onChange(id, option?.contact || null);
  };

  return (
    <AsyncSearchSelect<ContactOption>
      label={label}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      controlClassName={controlClassName}
      options={options}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      icon={<User className="w-4 h-4" />}
      emptySearchText="Type to search contacts"
      noResultsText="No contacts match your search"
      error={error ? "Couldn't load contacts." : undefined}
      onRetry={() => void refetch()}
    />
  );
}
