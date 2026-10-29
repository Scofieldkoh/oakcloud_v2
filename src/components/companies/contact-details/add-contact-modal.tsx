'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ContactSearchSelect } from '@/components/ui/contact-search-select';
import { relationshipOptions } from './types';

interface LinkContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (contactId: string, relationship: string) => Promise<void>;
  isLoading: boolean;
}

export function LinkContactModal({ isOpen, onClose, onSubmit, isLoading }: LinkContactModalProps) {
  const queryClient = useQueryClient();
  const [contactId, setContactId] = useState('');
  const [relationship, setRelationship] = useState('');
  const [isRefreshingContacts, setIsRefreshingContacts] = useState(false);
  const [refreshOnReturn, setRefreshOnReturn] = useState(false);

  const refreshContacts = useCallback(async () => {
    setIsRefreshingContacts(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
      await queryClient.refetchQueries({ queryKey: ['contacts'], type: 'active' });
    } finally {
      setIsRefreshingContacts(false);
    }
  }, [queryClient]);

  const handleSubmit = async () => {
    await onSubmit(contactId, relationship);
    resetForm();
  };

  const resetForm = () => {
    setContactId('');
    setRelationship('');
    setRefreshOnReturn(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreateContact = () => {
    setRefreshOnReturn(true);
    window.open('/contacts/new', '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    if (!isOpen || !refreshOnReturn) return;

    const handleWindowFocus = () => {
      setRefreshOnReturn(false);
      void refreshContacts();
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [isOpen, refreshOnReturn, refreshContacts]);

  const isValid = contactId && relationship;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Link Contact"
      description="Select an existing contact and assign a relationship."
      size="2xl"
    >
      <ModalBody className="space-y-5">
        {/* Contact Search */}
        <ContactSearchSelect
          label="Contact"
          value={contactId}
          onChange={(id) => setContactId(id)}
          placeholder="Search for a contact..."
        />

        {/* Relationship */}
        <div>
          <label className="label">Relationship</label>
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            className="input input-sm w-full"
          >
            <option value="">Select relationship...</option>
            {relationshipOptions.map((rel) => (
              <option key={rel} value={rel}>{rel}</option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-border-primary bg-surface-tertiary/40 p-3">
          <p className="text-xs font-medium text-text-primary">Can&apos;t find the contact?</p>
          <p className="text-xs text-text-secondary mt-1">
            Create it in a new tab, review any possible match, then refresh the list here.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleCreateContact} disabled={isLoading}>
              <Plus className="w-4 h-4 mr-2" />
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshContacts()}
              disabled={isLoading || isRefreshingContacts}
            >
              {isRefreshingContacts ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh List
            </Button>
          </div>
          {refreshOnReturn && (
            <p className="text-xs text-text-tertiary mt-2">List will refresh when you return to this tab.</p>
          )}
        </div>
      </ModalBody>

      <ModalFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-tertiary">
          {isValid ? 'Ready to link this contact.' : 'Select contact and relationship to continue.'}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={isLoading || !isValid}>
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Link Contact
          </Button>
        </div>
      </ModalFooter>
    </Modal>
  );
}

// Keep backward compatibility - export both names
export { LinkContactModal as AddContactModal };
