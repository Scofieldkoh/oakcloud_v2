'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { useLinkContactToCompany } from '@/hooks/use-contacts';
import { useToast } from '@/components/ui/toast';
import { ContactSearchSelect } from '@/components/ui/contact-search-select';
import type { Contact } from '@/generated/prisma';

// Share class options
const SHARE_CLASSES: SelectOption[] = [
  { value: 'Ordinary', label: 'Ordinary' },
  { value: 'Preference', label: 'Preference' },
  { value: 'Other', label: 'Other' },
];

interface AddShareholderModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  companyName: string;
}

export function AddShareholderModal({ isOpen, onClose, companyId, companyName }: AddShareholderModalProps) {
  const { success, error: toastError } = useToast();
  const linkContactMutation = useLinkContactToCompany();

  // Form state
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [numberOfShares, setNumberOfShares] = useState('');
  const [shareClass, setShareClass] = useState('Ordinary');

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedContactId('');
      setSelectedContact(null);
      setNumberOfShares('');
      setShareClass('Ordinary');
    }
  }, [isOpen]);

  const handleContactChange = (contactId: string, contact: Contact | null) => {
    setSelectedContactId(contactId);
    setSelectedContact(contact);
  };

  const handleSubmit = useCallback(async () => {
    if (!selectedContactId) {
      toastError('Please select a contact');
      return;
    }

    const shares = parseInt(numberOfShares);
    if (isNaN(shares) || shares <= 0) {
      toastError('Please enter a valid number of shares');
      return;
    }

    try {
      await linkContactMutation.mutateAsync({
        contactId: selectedContactId,
        companyId,
        relationship: 'Shareholder',
        numberOfShares: shares,
        shareClass,
      });
      success(`${selectedContact?.fullName} added as shareholder`);
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to add shareholder');
    }
  }, [companyId, linkContactMutation, numberOfShares, onClose, selectedContact?.fullName, selectedContactId, shareClass, success, toastError]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        if (selectedContactId && numberOfShares && !linkContactMutation.isPending) {
          handleSubmit();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSubmit, isOpen, selectedContactId, numberOfShares, linkContactMutation.isPending]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Shareholder" size="lg">
      <ModalBody>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Link an existing contact as a shareholder to <span className="font-medium text-text-primary">{companyName}</span>
          </p>

          {/* Contact Select with server-side search */}
          <ContactSearchSelect
            label="Select Contact"
            value={selectedContactId}
            onChange={handleContactChange}
            placeholder="Search contacts by name or email..."
          />

          {/* Number of Shares */}
          <div>
            <label className="label">Number of Shares</label>
            <input
              type="number"
              min="1"
              value={numberOfShares}
              onChange={(e) => setNumberOfShares(e.target.value)}
              placeholder="Enter number of shares"
              className="input input-sm w-full"
            />
          </div>

          {/* Share Class */}
          <div>
            <SearchableSelect
              label="Share Class"
              options={SHARE_CLASSES}
              value={shareClass}
              onChange={setShareClass}
              placeholder="Select share class..."
              clearable={false}
              showKeyboardHints={false}
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel <span className="text-text-muted ml-1">(Esc)</span>
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!selectedContactId || !numberOfShares || linkContactMutation.isPending}
        >
          {linkContactMutation.isPending ? 'Adding...' : 'Add Shareholder'} <span className="opacity-70 ml-1">(F1)</span>
        </Button>
      </ModalFooter>
    </Modal>
  );
}
