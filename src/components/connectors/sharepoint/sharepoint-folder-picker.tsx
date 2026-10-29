'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder, Loader2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useCreateSharePointFolder, useSharePointFolders, type SharePointFolderOption, type SharePointPickerMode } from '@/hooks/use-sharepoint-folders';
import { getCompanyFolderName } from '@/lib/sharepoint/company-folder-search';

export interface SharePointFolderPickerValue {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
}

export interface SharePointFolderPickerProps {
  isOpen: boolean;
  onClose?: () => void;
  connectorId: string;
  mode?: SharePointPickerMode;
  initialSearch?: string;
  currentValue?: SharePointFolderPickerValue | null;
  fixedRoot?: SharePointFolderPickerValue | null;
  allowCreate?: boolean;
  companyName?: string;
  allowRelativePath?: boolean;
  suggestedFolderName?: string;
  /** Folder API to browse through; defaults to the signed-in workspace's. */
  foldersEndpoint?: string;
  onConfirm: (folder: SharePointFolderPickerValue, relativePath?: string) => void;
  onCancel?: () => void;
}

function toValue(folder: SharePointFolderOption | SharePointFolderPickerValue): SharePointFolderPickerValue {
  return { driveId: folder.driveId, itemId: 'id' in folder ? folder.id : folder.itemId, name: folder.name, webUrl: folder.webUrl };
}

export function SharePointFolderPicker({ isOpen, onClose, connectorId, mode = 'browse', initialSearch = '', currentValue, fixedRoot, allowCreate = false, companyName, allowRelativePath = false, suggestedFolderName = '', foldersEndpoint, onConfirm, onCancel }: SharePointFolderPickerProps) {
  const libraryRoot = useMemo<SharePointFolderPickerValue>(() => ({ driveId: fixedRoot?.driveId ?? '', itemId: 'root', name: 'Document library', webUrl: '#' }), [fixedRoot?.driveId]);
  const [parent, setParent] = useState<SharePointFolderPickerValue>(fixedRoot ?? libraryRoot);
  const [trail, setTrail] = useState<SharePointFolderPickerValue[]>([fixedRoot ?? libraryRoot]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<SharePointFolderPickerValue | null>(currentValue ?? null);
  const [relativePath, setRelativePath] = useState('');
  const [newName, setNewName] = useState(suggestedFolderName);
  const [message, setMessage] = useState<string | null>(null);
  const [visibleFolders, setVisibleFolders] = useState<SharePointFolderOption[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const foldersQuery = useSharePointFolders({ connectorId, parentItemId: parent?.itemId, mode, query: debouncedSearch, cursor, rootItemId: fixedRoot?.itemId, enabled: isOpen, endpoint: foldersEndpoint });
  const createFolder = useCreateSharePointFolder(foldersEndpoint);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCursor(undefined);
    setVisibleFolders([]);
  }, [debouncedSearch, parent?.itemId]);

  useEffect(() => {
    if (!isOpen) return;
    setParent(fixedRoot ?? libraryRoot);
    setTrail([fixedRoot ?? libraryRoot]);
    setSearch(initialSearch.trim());
    setDebouncedSearch(initialSearch.trim());
    setSelected(currentValue ?? null);
    setRelativePath('');
    setNewName(suggestedFolderName);
    setMessage(null);
  }, [currentValue, fixedRoot, initialSearch, isOpen, libraryRoot, suggestedFolderName]);

  useEffect(() => {
    if (!foldersQuery.data) return;
    setVisibleFolders((current) => cursor ? [...current, ...foldersQuery.data!.folders] : foldersQuery.data!.folders);
  }, [cursor, foldersQuery.data]);

  const folders = useMemo(() => visibleFolders, [visibleFolders]);
  const chooseFolder = (folder: SharePointFolderOption) => {
    const value = toValue(folder);
    setSelected(value);
    if (mode !== 'client-folder') {
      setParent(value);
      setTrail((items) => [...items, value]);
    }
    setSearch('');
  };
  const goTo = (index: number) => {
    const value = trail[index];
    setTrail(trail.slice(0, index + 1));
    setParent(value);
    setSelected(value);
  };
  const create = async () => {
    const folderName = newName.trim() || (companyName ? getCompanyFolderName(companyName) : undefined);
    if (!folderName) return;
    setMessage(null);
    try {
      const folder = await createFolder.mutateAsync({ connectorId, parentItemId: parent.itemId, name: folderName, mode, rootItemId: fixedRoot?.itemId });
      chooseFolder(folder);
      setNewName('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Folder could not be created');
    }
  };
  const close = () => (onCancel ?? onClose)?.();

  return (
    <Modal isOpen={isOpen} onClose={close} title="Choose SharePoint folder" description="Select a verified folder. Oakcloud stores the remote identity, not your credentials." size="lg">
      <ModalBody className="space-y-4">
        {(fixedRoot || trail.length > 1) && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-text-secondary" aria-label="Folder path">
            {trail.map((item, index) => <span key={item.itemId} className="inline-flex items-center gap-1"><button type="button" className="rounded px-1 py-1 hover:bg-background-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30" onClick={() => goTo(index)}>{item.name}</button>{index < trail.length - 1 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}</span>)}
          </div>
        )}
        <FormInput label="Search folders" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this folder level" leftIcon={<Search className="h-4 w-4" />} inputSize="md" />
        {allowCreate && parent && (
          <div className="flex flex-col gap-2 rounded-lg border border-border-primary bg-background-primary p-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1"><FormInput label="New folder" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={companyName ? '{Company_Name}' : 'Folder name'} inputSize="md" /></div>
            <Button variant="secondary" onClick={create} disabled={(!newName.trim() && !companyName?.trim()) || createFolder.isPending} isLoading={createFolder.isPending} leftIcon={<Plus className="h-4 w-4" />}>Create</Button>
          </div>
        )}
        {foldersQuery.isLoading && <div className="flex items-center gap-2 py-8 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" />Loading folders…</div>}
        {foldersQuery.isError && <div className="rounded-lg border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">{foldersQuery.error.message}</div>}
        {!foldersQuery.isLoading && !foldersQuery.isError && folders.length === 0 && <div className="rounded-lg border border-dashed border-border-primary p-6 text-center text-sm text-text-secondary">No folders found at this level.</div>}
        <div className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label="SharePoint folders">
          {folders.map((folder) => {
            const isSelected = selected?.itemId === folder.id;
            return <button key={folder.id} type="button" role="option" aria-selected={isSelected} onClick={() => chooseFolder(folder)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 ${isSelected ? 'border-oak-primary bg-oak-primary/10' : 'border-transparent hover:border-border-primary hover:bg-background-tertiary'}`}><Folder className="h-4 w-4 shrink-0 text-oak-primary" /><span className="min-w-0 flex-1 truncate text-sm text-text-primary">{folder.name}</span><span className="text-xs text-text-muted">{folder.childCount}</span><ChevronRight className="h-4 w-4 shrink-0 text-text-muted" /></button>;
          })}
        </div>
        {foldersQuery.data?.nextCursor && <Button variant="ghost" className="w-full" onClick={() => setCursor(foldersQuery.data?.nextCursor)}>Load more folders</Button>}
        {allowRelativePath && selected && <FormInput label="Relative subfolder path (optional)" value={relativePath} onChange={(event) => setRelativePath(event.target.value)} placeholder="2026 / Agreements" hint="Use folder names separated by /. Oakcloud validates the path before saving." inputSize="md" />}
        {selected && <div className="rounded-lg bg-background-primary p-3 text-xs text-text-secondary">Selected: <span className="font-medium text-text-primary">{selected.name}</span></div>}
        {message && <div className="text-sm text-status-error">{message}</div>}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={() => selected && onConfirm(selected, allowRelativePath ? relativePath.trim() || undefined : undefined)} disabled={!selected}>Use folder</Button>
      </ModalFooter>
    </Modal>
  );
}
