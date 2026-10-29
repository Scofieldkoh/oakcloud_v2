'use client';

import { FileUp, FolderSearch, Paperclip } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@/components/ui/dropdown';

interface BusinessAssistantAttachmentMenuProps {
  disabled?: boolean;
  onUploadBizFile: () => void;
  onChooseRecord: () => void;
}

export function BusinessAssistantAttachmentMenu({
  disabled = false,
  onUploadBizFile,
  onChooseRecord,
}: BusinessAssistantAttachmentMenuProps) {
  if (disabled) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        leftIcon={<Paperclip className="h-4 w-4" />}
      >
        Attach
      </Button>
    );
  }

  return (
    <Dropdown>
      <DropdownTrigger className="border-0 bg-transparent px-3 hover:bg-background-tertiary" aria-label="Attach">
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        <span>Attach</span>
      </DropdownTrigger>
      <DropdownMenu align="left">
        <DropdownItem
          icon={<FileUp className="h-4 w-4" />}
          onClick={onUploadBizFile}
        >
          Upload BizFile
        </DropdownItem>
        <DropdownItem
          icon={<FolderSearch className="h-4 w-4" />}
          onClick={onChooseRecord}
        >
          Choose workspace record
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}
