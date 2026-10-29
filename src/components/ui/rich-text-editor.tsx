'use client';

import { useEditor, EditorContent, Editor } from '@tiptap/react';
export type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { Link as TiptapLink } from '@tiptap/extension-link';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextAlign } from '@tiptap/extension-text-align';
import { Extension } from '@tiptap/core';
import DOMPurify from 'dompurify';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Unlink,
  Strikethrough,
  ALargeSmall,
  Palette,
  ChevronDown,
  Heading1,
  Minus,
  RemoveFormatting,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Indent as IndentIcon,
  Outdent,
  Undo,
  Redo,
  Type,
  CaseLower,
} from 'lucide-react';

// ============================================================================
// Types & Constants
// ============================================================================

interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  /** Expand editor height to fit content (no internal scroll) */
  autoGrow?: boolean;
  /** Hide the built-in toolbar (for external toolbar usage) */
  hideToolbar?: boolean;
  /** Render prop for external toolbar */
  renderToolbar?: (editor: Editor | null) => React.ReactNode;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
  /** For toggle buttons, indicates if the button controls a pressed state */
  isToggle?: boolean;
}

const FONT_SIZES = [
  '8', '9', '10', '11', '12', '14', '16', '18', '20', '22', '24', '26', '28', '36'
];

const FONT_FAMILIES = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
];

const LINE_SPACING_OPTIONS = [
  { value: '1', label: 'Single' },
  { value: '1.15', label: '1.15' },
  { value: '1.5', label: '1.5' },
  { value: '2', label: 'Double' },
];

const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Gray', value: '#6b7280' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Purple', value: '#9333ea' },
];

// ============================================================================
// Toolbar Components
// ============================================================================

function ToolbarButton({
  onClick,
  isActive,
  disabled,
  children,
  title,
  isToggle = false,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={isToggle ? isActive : undefined}
      className={`p-1.5 rounded transition-colors ${isActive
        ? 'bg-background-tertiary text-text-primary'
        : 'text-text-muted hover:bg-background-secondary hover:text-text-primary'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function Dropdown({ trigger, children, isOpen, onToggle, onClose }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-0.5 p-1.5 rounded text-text-muted hover:bg-background-secondary hover:text-text-primary transition-colors"
      >
        {trigger}
        <ChevronDown className="w-3 h-3" />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 py-1 bg-background-elevated border border-border-primary rounded-md shadow-elevation-2 z-10 min-w-[100px]">
          {children}
        </div>
      )}
    </div>
  );
}

export interface EditorToolbarProps {
  editor: Editor | null;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showFontSize, setShowFontSize] = useState(false);
  const [showFontFamily, setShowFontFamily] = useState(false);
  const [showColor, setShowColor] = useState(false);
  const [showLineSpacing, setShowLineSpacing] = useState(false);

  const setLink = useCallback(() => {
    if (!editor) return;

    if (linkUrl === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url })
        .run();
    }
    setShowLinkInput(false);
    setLinkUrl('');
  }, [editor, linkUrl]);

  const handleLinkClick = () => {
    if (!editor) return;

    const previousUrl = editor.getAttributes('link').href;
    if (previousUrl) {
      setLinkUrl(previousUrl);
    }
    setShowLinkInput(true);
  };

  const setFontSize = (size: string) => {
    if (!editor) return;
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
    setShowFontSize(false);
  };

  const setFontFamilyValue = (fontFamily: string) => {
    if (!editor) return;
    editor.chain().focus().setFontFamily(fontFamily).run();
    setShowFontFamily(false);
  };

  const setLineSpacing = (lineHeight: string) => {
    if (!editor) return;
    editor.chain().focus().setMark('textStyle', { lineHeight }).run();
    setShowLineSpacing(false);
  };

  const setColor = (color: string) => {
    if (!editor) return;
    if (color === '') {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(color).run();
    }
    setShowColor(false);
  };

  const applyH1Style = () => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setBold()
      .setMark('textStyle', { fontSize: '24px' })
      .setColor('#2563eb')
      .run();
  };

  const resetToNormal = () => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .unsetBold()
      .unsetItalic()
      .unsetUnderline()
      .unsetStrike()
      .unsetColor()
      .unsetFontFamily()
      .setTextAlign('left')
      .unsetMark('textStyle')
      .run();
  };

  const insertDivider = () => {
    if (!editor) return;
    editor.chain().focus().setHorizontalRule().run();
  };

  if (!editor) return null;

  return (
    <div className="flex items-center gap-0.5 p-1 border-b border-border-primary bg-background-secondary flex-wrap">
      {/* Undo/Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <Undo className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Y)"
      >
        <Redo className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border-primary mx-1" />

      {/* Font Family */}
      <Dropdown
        trigger={<Type className="w-4 h-4" />}
        isOpen={showFontFamily}
        onToggle={() => setShowFontFamily(!showFontFamily)}
        onClose={() => setShowFontFamily(false)}
      >
        {FONT_FAMILIES.map((font) => (
          <button
            key={font.value}
            type="button"
            onClick={() => setFontFamilyValue(font.value)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-background-tertiary transition-colors"
            style={{ fontFamily: font.value }}
          >
            {font.label}
          </button>
        ))}
      </Dropdown>

      {/* Font Size */}
      <Dropdown
        trigger={<ALargeSmall className="w-4 h-4" />}
        isOpen={showFontSize}
        onToggle={() => setShowFontSize(!showFontSize)}
        onClose={() => setShowFontSize(false)}
      >
        <div className="grid grid-cols-7 gap-0.5 p-1 w-[168px]">
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setFontSize(`${size}px`)}
              className="w-5 h-5 text-2xs text-center hover:bg-background-tertiary transition-colors rounded"
            >
              {size}
            </button>
          ))}
        </div>
      </Dropdown>

      {/* Text Color */}
      <Dropdown
        trigger={
          <div className="flex items-center">
            <Palette className="w-4 h-4" />
            <div
              className="w-2 h-2 rounded-full ml-0.5 border border-border-primary"
              style={{
                backgroundColor: editor.getAttributes('textStyle').color || 'currentColor',
              }}
            />
          </div>
        }
        isOpen={showColor}
        onToggle={() => setShowColor(!showColor)}
        onClose={() => setShowColor(false)}
      >
        {TEXT_COLORS.map((color) => (
          <button
            key={color.value || 'default'}
            type="button"
            onClick={() => setColor(color.value)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-background-tertiary transition-colors flex items-center gap-2"
          >
            <div
              className="w-3 h-3 rounded-full border border-border-primary"
              style={{ backgroundColor: color.value || 'var(--text-primary)' }}
            />
            {color.label}
          </button>
        ))}
      </Dropdown>

      <div className="w-px h-5 bg-border-primary mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        isToggle
        title="Bold (Ctrl+B)"
      >
        <Bold className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        isToggle
        title="Italic (Ctrl+I)"
      >
        <Italic className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        isToggle
        title="Underline (Ctrl+U)"
      >
        <UnderlineIcon className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        isToggle
        title="Strikethrough"
      >
        <Strikethrough className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border-primary mx-1" />

      {/* Text Alignment */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        isActive={editor.isActive({ textAlign: 'left' })}
        isToggle
        title="Align Left"
      >
        <AlignLeft className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        isActive={editor.isActive({ textAlign: 'center' })}
        isToggle
        title="Align Center"
      >
        <AlignCenter className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        isActive={editor.isActive({ textAlign: 'right' })}
        isToggle
        title="Align Right"
      >
        <AlignRight className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border-primary mx-1" />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        isToggle
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList') && !editor.getAttributes('orderedList').class?.includes('list-alpha')}
        isToggle
        title="Numbered List (1, 2, 3)"
      >
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => {
          // Toggle alphabet ordered list
          if (editor.isActive('orderedList') && editor.getAttributes('orderedList').listStyleType === 'lower-alpha') {
            editor.chain().focus().toggleOrderedList().run();
          } else if (editor.isActive('orderedList')) {
            // Already in ordered list, just change the style
            editor.chain().focus().updateAttributes('orderedList', { listStyleType: 'lower-alpha' }).run();
          } else {
            // Not in list, create one and set style
            editor.chain().focus().toggleOrderedList().updateAttributes('orderedList', { listStyleType: 'lower-alpha' }).run();
          }
        }}
        isActive={editor.isActive('orderedList') && editor.getAttributes('orderedList').listStyleType === 'lower-alpha'}
        isToggle
        title="Alphabet List (a, b, c)"
      >
        <CaseLower className="w-4 h-4" />
      </ToolbarButton>

      {/* Indent/Outdent */}
      <ToolbarButton
        onClick={() => editor.chain().focus().indent().run()}
        title="Increase Indent"
      >
        <IndentIcon className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().outdent().run()}
        title="Decrease Indent"
      >
        <Outdent className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border-primary mx-1" />

      {/* Line Spacing */}
      <Dropdown
        trigger={
          <span className="text-xs font-medium px-1">1.5</span>
        }
        isOpen={showLineSpacing}
        onToggle={() => setShowLineSpacing(!showLineSpacing)}
        onClose={() => setShowLineSpacing(false)}
      >
        {LINE_SPACING_OPTIONS.map((spacing) => (
          <button
            key={spacing.value}
            type="button"
            onClick={() => setLineSpacing(spacing.value)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-background-tertiary transition-colors"
          >
            {spacing.label}
          </button>
        ))}
      </Dropdown>

      <div className="w-px h-5 bg-border-primary mx-1" />

      {/* Links */}
      {
        showLinkInput ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Enter URL..."
              className="px-2 py-1 text-xs border border-border-primary rounded bg-background-elevated text-text-primary w-40"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setLink();
                } else if (e.key === 'Escape') {
                  setShowLinkInput(false);
                  setLinkUrl('');
                }
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={setLink}
              className="px-2 py-1 text-xs bg-accent-primary text-white rounded hover:bg-accent-primary/90"
            >
              Set
            </button>
            <button
              type="button"
              onClick={() => {
                setShowLinkInput(false);
                setLinkUrl('');
              }}
              className="px-2 py-1 text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <ToolbarButton
              onClick={handleLinkClick}
              isActive={editor.isActive('link')}
              isToggle
              title="Add Link"
            >
              <LinkIcon className="w-4 h-4" />
            </ToolbarButton>

            {editor.isActive('link') && (
              <ToolbarButton
                onClick={() => editor.chain().focus().unsetLink().run()}
                title="Remove Link"
              >
                <Unlink className="w-4 h-4" />
              </ToolbarButton>
            )}
          </>
        )
      }

      <div className="w-px h-5 bg-border-primary mx-1" />

      {/* H1 Style */}
      <ToolbarButton
        onClick={applyH1Style}
        title="Heading Style (24px Blue)"
      >
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>

      {/* Divider */}
      <ToolbarButton
        onClick={insertDivider}
        title="Insert Divider"
      >
        <Minus className="w-4 h-4" />
      </ToolbarButton>

      {/* Reset to Normal */}
      <ToolbarButton
        onClick={resetToNormal}
        title="Reset to Normal Text"
      >
        <RemoveFormatting className="w-4 h-4" />
      </ToolbarButton>
    </div >
  );
}

// ============================================================================
// Custom Text Style Extension (Font Size + Line Height)
// ============================================================================

const CustomTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (element) => element.style.fontSize || null,
        renderHTML: (attributes) => {
          if (!attributes.fontSize) return {};
          return { style: `font-size: ${attributes.fontSize}` };
        },
      },
      lineHeight: {
        default: null,
        parseHTML: (element) => element.style.lineHeight || null,
        renderHTML: (attributes) => {
          if (!attributes.lineHeight) return {};
          return { style: `line-height: ${attributes.lineHeight}` };
        },
      },
    };
  },
});

// ============================================================================
// Custom Ordered List Extension (with list-style-type and start number support)
// ============================================================================

const CustomOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      start: {
        default: 1,
        parseHTML: (element) => {
          return element.hasAttribute('start')
            ? parseInt(element.getAttribute('start') || '1', 10)
            : 1;
        },
        renderHTML: (attributes) => {
          if (attributes.start === 1) {
            return {};
          }
          return {
            start: attributes.start,
            style: `--list-start: ${attributes.start - 1}`, // CSS variable for counter offset
          };
        },
      },
      listStyleType: {
        default: 'decimal',
        parseHTML: (element) => {
          // Check for list-alpha class or inline style
          if (element.classList.contains('list-alpha')) {
            return 'lower-alpha';
          }
          return element.style.listStyleType || 'decimal';
        },
        renderHTML: (attributes) => {
          if (attributes.listStyleType === 'lower-alpha') {
            // Use class for CSS counter-based styling
            return {
              class: 'list-alpha',
            };
          }
          return {};
        },
      },
    };
  },
});

// ============================================================================
// Custom List Item Extension (with multi-block content support)
// ============================================================================

const CustomListItem = ListItem.extend({
  // Allow multiple block elements: paragraph followed by any blocks (paragraphs, lists)
  content: 'paragraph block*',

  addKeyboardShortcuts() {
    return {
      // Enter key: default behavior - create new list item
      // (Empty paragraph at end of only content will exit list)
      Enter: () => {
        if (!this.editor.isActive('listItem')) {
          return false;
        }
        // Use default TipTap behavior: split list item
        return this.editor.commands.splitListItem('listItem');
      },

      // Shift+Enter: create new paragraph within the same list item
      'Shift-Enter': () => {
        if (!this.editor.isActive('listItem')) {
          return false;
        }
        // Create a new paragraph within the current list item
        return this.editor.chain().splitBlock().run();
      },

      // Backspace at start of empty paragraph in list item
      Backspace: () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $from, empty } = selection;

        if (!empty || !this.editor.isActive('listItem')) {
          return false;
        }

        const parentNode = $from.parent;
        const isEmptyParagraph = parentNode.type.name === 'paragraph' && parentNode.content.size === 0;
        const isAtStart = $from.parentOffset === 0;

        if (isEmptyParagraph && isAtStart) {
          // Find the list item
          let listItemDepth = -1;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              listItemDepth = d;
              break;
            }
          }

          if (listItemDepth !== -1) {
            const listItem = $from.node(listItemDepth);

            // If only one paragraph, use default backspace (lifts out of list)
            if (listItem.childCount === 1) {
              return false; // Let default handler deal with it
            }

            // Multiple blocks: delete the empty paragraph
            return this.editor.commands.deleteNode('paragraph');
          }
        }

        return false;
      },
    };
  },
});

// ============================================================================
// Custom Indent Extension (for general text indentation)
// ============================================================================

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

const IndentExtension = Extension.create({
  name: 'indent',

  addOptions() {
    return {
      // Only indent top-level paragraphs/headings and list wrappers
      // Don't include 'paragraph' here as it would indent paragraphs inside lists
      types: ['bulletList', 'orderedList'],
      paragraphTypes: ['paragraph', 'heading'], // For standalone paragraphs only
      indentRange: 24, // pixels per indent level
      minIndent: 0,
      maxIndent: 144, // max 6 levels of indentation
    };
  },

  addGlobalAttributes() {
    return [
      {
        // Include both list types and paragraph types for indent attribute
        types: [...this.options.types, ...this.options.paragraphTypes],
        attributes: {
          indent: {
            default: 0,
            parseHTML: element => {
              const marginLeft = element.style.marginLeft;
              if (marginLeft) {
                return parseInt(marginLeft, 10) || 0;
              }
              return 0;
            },
            renderHTML: attributes => {
              if (!attributes.indent || attributes.indent === 0) {
                return {};
              }
              return {
                style: `margin-left: ${attributes.indent}px`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent:
        () =>
          ({ editor, tr, state, dispatch }) => {
            // First, try to use TipTap's built-in sinkListItem for nested lists
            if (editor.can().sinkListItem('listItem')) {
              return editor.chain().sinkListItem('listItem').run();
            }

            // Otherwise, apply margin-left indentation for paragraphs/headings
            const { selection } = state;
            const { from, to } = selection;
            let changed = false;

            state.doc.nodesBetween(from, to, (node, pos, parent) => {
              const nodeTypeName = node.type.name;

              // For top-level lists, apply margin-left indent
              if (this.options.types.includes(nodeTypeName) && parent?.type.name === 'doc') {
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.min(
                  currentIndent + this.options.indentRange,
                  this.options.maxIndent
                );
                if (newIndent !== currentIndent) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: newIndent,
                  });
                  changed = true;
                }
              }
              // For paragraphs/headings at document root, apply margin-left
              else if (
                this.options.paragraphTypes.includes(nodeTypeName) &&
                parent?.type.name === 'doc'
              ) {
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.min(
                  currentIndent + this.options.indentRange,
                  this.options.maxIndent
                );
                if (newIndent !== currentIndent) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: newIndent,
                  });
                  changed = true;
                }
              }
            });

            if (changed && dispatch) {
              dispatch(tr);
            }

            return changed;
          },
      outdent:
        () =>
          ({ editor, tr, state, dispatch }) => {
            // First, try to use TipTap's built-in liftListItem for nested lists
            if (editor.can().liftListItem('listItem')) {
              return editor.chain().liftListItem('listItem').run();
            }

            // Otherwise, apply margin-left outdent for paragraphs/headings
            const { selection } = state;
            const { from, to } = selection;
            let changed = false;

            state.doc.nodesBetween(from, to, (node, pos, parent) => {
              const nodeTypeName = node.type.name;

              // For top-level lists, apply margin-left outdent
              if (this.options.types.includes(nodeTypeName) && parent?.type.name === 'doc') {
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.max(
                  currentIndent - this.options.indentRange,
                  this.options.minIndent
                );
                if (newIndent !== currentIndent) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: newIndent,
                  });
                  changed = true;
                }
              }
              // For paragraphs/headings at document root, apply margin-left
              else if (
                this.options.paragraphTypes.includes(nodeTypeName) &&
                parent?.type.name === 'doc'
              ) {
                const currentIndent = node.attrs.indent || 0;
                const newIndent = Math.max(
                  currentIndent - this.options.indentRange,
                  this.options.minIndent
                );
                if (newIndent !== currentIndent) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: newIndent,
                  });
                  changed = true;
                }
              }
            });

            if (changed && dispatch) {
              dispatch(tr);
            }

            return changed;
          },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indent(),
      'Shift-Tab': () => this.editor.commands.outdent(),
    };
  },
});

// ============================================================================
// Main Editor Component
// ============================================================================

export function RichTextEditor({
  value = '',
  onChange,
  readOnly = false,
  minHeight = 100,
  className = '',
  autoGrow = false,
  hideToolbar = false,
  renderToolbar,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        orderedList: false, // Use CustomOrderedList instead
        listItem: false, // Use CustomListItem instead
      }),
      CustomOrderedList,
      CustomListItem,
      Underline,
      CustomTextStyle,
      Color,
      FontFamily.configure({
        types: ['textStyle'],
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TiptapLink.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-accent-primary underline',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      IndentExtension,
    ],
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: `rich-text-content focus:outline-none px-3 py-2 text-text-primary text-sm`,
        style: `min-height: ${minHeight}px`,
      },
    },
    immediatelyRender: false,
  });

  // Sync external value changes
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [readOnly, editor]);

  if (readOnly) {
    return (
      <div
        className={`border border-border-primary rounded-md bg-background-elevated overflow-hidden ${className}`}
        style={{ minHeight }}
      >
        <EditorContent editor={editor} />
      </div>
    );
  }

  // If renderToolbar is provided, call it (external toolbar mode)
  if (renderToolbar) {
    return (
      <>
        {renderToolbar(editor)}
        <div className={`bg-background-elevated ${className}`}>
          <EditorContent editor={editor} />
        </div>
      </>
    );
  }

  // If hideToolbar is true, render content only
  if (hideToolbar) {
    return (
      <div className={`bg-background-elevated ${className}`}>
        <EditorContent editor={editor} />
      </div>
    );
  }

  // Default: render with built-in toolbar
  return (
    <div
      className={`border border-border-primary rounded-md bg-background-elevated flex flex-col focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary ${className}`}
      style={className?.includes('h-full') ? { height: '100%' } : undefined}
    >
      <EditorToolbar editor={editor} />
      <div className={autoGrow ? 'overflow-visible' : 'flex-1 overflow-auto'}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ============================================================================
// Read-only Display Component
// ============================================================================

/**
 * Sanitize HTML content to prevent XSS attacks
 * Allows safe formatting tags while stripping potentially dangerous content
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'ul', 'ol', 'li', 'a', 'span', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'class'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

export function RichTextDisplay({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  // Memoize sanitized content to avoid re-sanitizing on every render
  const sanitizedContent = useMemo(() => sanitizeHtml(content), [content]);

  return (
    <div
      className={`rich-text-content text-text-primary text-sm ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
    />
  );
}
