'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  Sparkles,
  Send,
  Loader2,
  Clipboard,
  Check,
  ChevronDown,
  FileText,
  RefreshCw,
  Wand2,
  HelpCircle,
  Braces,
  ClipboardCheck,
  Trash2,
} from 'lucide-react';
import { AIModelSelector, useAIModels } from '@/components/ui/ai-model-selector';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { cn } from '@/lib/utils';

// Document category type (string union for flexibility)
export type DocumentCategory = 'RESOLUTION' | 'MINUTES' | 'CONTRACT' | 'LETTER' | 'NOTICE' | 'FORM' | 'REPORT' | 'OTHER';

// ============================================================================
// Types
// ============================================================================

export type AIContextMode = 'template_editor' | 'document_editor';

export interface AIContext {
  mode: AIContextMode;
  templateCategory?: DocumentCategory;
  templateName?: string;
  tenantId?: string;
  tenantName?: string;
  companyContext?: {
    name: string;
    uen: string;
    entityType: string;
    directors: Array<{ name: string; role: string }>;
    shareholders: Array<{ name: string; percentage: number }>;
  };
  selectedText?: string;
  cursorPosition?: number;
  surroundingContent?: string;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isInserted?: boolean;
}

export interface AISidebarProps {
  isOpen: boolean;
  onClose: () => void;
  context: AIContext;
  onInsert?: (content: string) => void;
  onReplace?: (content: string) => void;
  className?: string;
}

interface QuickAction {
  type: 'draft' | 'rephrase' | 'explain' | 'suggest_placeholders' | 'review';
  label: string;
  icon: React.ReactNode;
  description: string;
  requiresSelection?: boolean;
}

// ============================================================================
// Quick Actions
// ============================================================================

const QUICK_ACTIONS: QuickAction[] = [
  {
    type: 'draft',
    label: 'Draft',
    icon: <FileText className="w-4 h-4" />,
    description: 'Generate new content',
  },
  {
    type: 'rephrase',
    label: 'Rephrase',
    icon: <RefreshCw className="w-4 h-4" />,
    description: 'Rewrite selected text',
    requiresSelection: true,
  },
  {
    type: 'explain',
    label: 'Explain',
    icon: <HelpCircle className="w-4 h-4" />,
    description: 'Explain a term',
  },
  {
    type: 'suggest_placeholders',
    label: 'Placeholders',
    icon: <Braces className="w-4 h-4" />,
    description: 'Suggest placeholders',
    requiresSelection: true,
  },
  {
    type: 'review',
    label: 'Review',
    icon: <ClipboardCheck className="w-4 h-4" />,
    description: 'Review for errors',
    requiresSelection: true,
  },
];

const REPHRASE_STYLES = [
  { value: 'formal', label: 'More Formal' },
  { value: 'simplified', label: 'Simplified' },
  { value: 'concise', label: 'More Concise' },
  { value: 'detailed', label: 'More Detailed' },
];

// ============================================================================
// Main Component
// ============================================================================

export function AISidebar({
  isOpen,
  onClose,
  context,
  onInsert,
  onReplace,
  className,
}: AISidebarProps) {
  // State
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRephraseStyles, setShowRephraseStyles] = useState(false);
  const [selectedAction, setSelectedAction] = useState<QuickAction['type'] | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Resolve tenant context for connector-aware model selection/calls.
  // For SUPER_ADMIN, fall back to the active tenant store selection.
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
  const effectiveTenantId = context.tenantId || activeTenantId;

  // Hooks - pass resolved tenantId for connector-aware model availability
  const { hasAvailableModels, isLoading: modelsLoading } = useAIModels(effectiveTenantId);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when sidebar opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Generate unique ID for messages
  const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Send message to AI
  const sendMessage = useCallback(
    async (
      message: string,
      action?: QuickAction['type'],
      style?: string
    ) => {
      if (!message.trim() && !action) return;

      const userMessage: AIChatMessage = {
        id: generateId(),
        role: 'user',
        content: action ? `[${action.toUpperCase()}] ${message}` : message,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputValue('');
      setIsLoading(true);
      setSelectedAction(null);

      try {
        let response;
        const isQuickAction = !!action;

        if (isQuickAction) {
          // Quick action request
          response = await fetch('/api/ai/document-chat?action=quick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              input: message,
              context: {
                mode: context.mode,
                templateCategory: context.templateCategory,
                templateName: context.templateName,
                tenantId: effectiveTenantId,
                tenantName: context.tenantName,
                companyContext: context.companyContext,
                selectedText: context.selectedText,
                surroundingContent: context.surroundingContent,
              },
              model: selectedModel || undefined,
              style: style,
            }),
          });
        } else {
          // Regular chat request
          response = await fetch('/api/ai/document-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message,
              context: {
                mode: context.mode,
                templateCategory: context.templateCategory,
                templateName: context.templateName,
                tenantId: effectiveTenantId,
                tenantName: context.tenantName,
                companyContext: context.companyContext,
                selectedText: context.selectedText,
                surroundingContent: context.surroundingContent,
              },
              model: selectedModel || undefined,
              conversationHistory: messages.map((m) => ({
                role: m.role,
                content: m.content,
                timestamp: m.timestamp.toISOString(),
              })),
            }),
          });
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to get AI response');
        }

        const data = await response.json();

        const assistantMessage: AIChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        console.error('AI chat error:', error);
        const errorMessage: AIChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Failed to get AI response'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [context, effectiveTenantId, selectedModel, messages]
  );

  // Handle quick action click
  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      if (action.requiresSelection && !context.selectedText) {
        // Show message that selection is required
        const infoMessage: AIChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: `Please select some text in the editor first, then use the "${action.label}" action.`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, infoMessage]);
        return;
      }

      if (action.type === 'rephrase') {
        setShowRephraseStyles(true);
        setSelectedAction('rephrase');
        return;
      }

      // For actions that need input, set the action and focus input
      if (action.type === 'draft' || action.type === 'explain') {
        setSelectedAction(action.type);
        inputRef.current?.focus();
        return;
      }

      // For actions that work on selection, send immediately
      if (context.selectedText) {
        sendMessage(context.selectedText, action.type);
      }
    },
    [context.selectedText, sendMessage]
  );

  // Handle rephrase style selection
  const handleRephraseStyle = useCallback(
    (style: string) => {
      setShowRephraseStyles(false);
      if (context.selectedText) {
        sendMessage(context.selectedText, 'rephrase', style);
      }
    },
    [context.selectedText, sendMessage]
  );

  // Handle form submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!inputValue.trim() || isLoading) return;

      if (selectedAction) {
        sendMessage(inputValue, selectedAction);
      } else {
        sendMessage(inputValue);
      }
    },
    [inputValue, isLoading, selectedAction, sendMessage]
  );

  // Handle insert content
  const handleInsert = useCallback(
    (messageId: string, content: string) => {
      onInsert?.(content);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isInserted: true } : m))
      );
    },
    [onInsert]
  );

  // Handle replace content
  const handleReplace = useCallback(
    (messageId: string, content: string) => {
      onReplace?.(content);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isInserted: true } : m))
      );
    },
    [onReplace]
  );

  // Handle copy to clipboard
  const handleCopy = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, []);

  // Clear conversation
  const handleClear = useCallback(() => {
    setMessages([]);
    setSelectedAction(null);
  }, []);

  // Cancel current action
  const handleCancelAction = useCallback(() => {
    setSelectedAction(null);
    setShowRephraseStyles(false);
    setInputValue('');
  }, []);

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile: Full-screen overlay */}
      <div className="md:hidden fixed inset-0 z-50 bg-black/50" onClick={onClose} />

      <div
        className={cn(
          // Mobile: Full-screen modal from right
          'fixed md:relative inset-y-0 right-0 z-50 md:z-auto',
          'w-full sm:w-[320px] md:w-80',
          'flex flex-col bg-background-secondary border-l border-border-primary',
          'animate-in slide-in-from-right md:animate-none',
          className
        )}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-3 sm:px-4 py-2 sm:py-3 border-b border-border-primary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-accent-primary" />
              <span className="font-medium text-text-primary">AI Assistant</span>
            </div>
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                onClick={() => setShowModelSelector(!showModelSelector)}
                className="p-2 sm:p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                title="Select AI Model"
              >
                <Wand2 className="w-4 h-4" />
              </button>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-2 sm:p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                  title="Clear conversation"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-2 sm:p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

        {/* Model selector (collapsible) */}
        {showModelSelector && (
          <div className="mt-3 pt-3 border-t border-border-secondary">
            <AIModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              variant="compact"
              label="Model"
              showDetails={false}
              tenantId={effectiveTenantId}
            />
          </div>
        )}

        {/* Context info */}
        <div className="mt-2 text-xs text-text-muted">
          <span className="capitalize">{context.mode.replace('_', ' ')}</span>
          {context.templateCategory && (
            <span> • {context.templateCategory}</span>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border-primary">
        <div className="text-xs font-medium text-text-muted mb-2">Quick Actions</div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.type}
              type="button"
              onClick={() => handleQuickAction(action)}
              disabled={isLoading || (action.requiresSelection && !context.selectedText)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
                'border border-border-secondary',
                selectedAction === action.type
                  ? 'bg-accent-primary/10 border-accent-primary text-accent-primary'
                  : 'hover:bg-background-tertiary text-text-secondary hover:text-text-primary',
                (isLoading || (action.requiresSelection && !context.selectedText)) &&
                  'opacity-50 cursor-not-allowed'
              )}
              title={action.description}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>

        {/* Rephrase style selector */}
        {showRephraseStyles && (
          <div className="mt-2 p-2 bg-background-tertiary rounded border border-border-secondary">
            <div className="text-xs font-medium text-text-muted mb-2">Rephrase style:</div>
            <div className="flex flex-wrap gap-1.5">
              {REPHRASE_STYLES.map((style) => (
                <button
                  key={style.value}
                  type="button"
                  onClick={() => handleRephraseStyle(style.value)}
                  className="px-2 py-1 text-xs rounded bg-background-secondary hover:bg-background-primary text-text-secondary hover:text-text-primary border border-border-secondary transition-colors"
                >
                  {style.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleCancelAction}
                className="px-2 py-1 text-xs rounded hover:bg-background-secondary text-text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Selected text preview */}
        {context.selectedText && (
          <div className="mt-2 p-2 bg-background-tertiary rounded border border-border-secondary">
            <div className="text-xs font-medium text-text-muted mb-1">Selected text:</div>
            <div className="text-xs text-text-secondary line-clamp-2">
              {context.selectedText}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && !modelsLoading && (
          <div className="text-center py-8">
            <Sparkles className="w-8 h-8 mx-auto text-text-muted mb-3" />
            <p className="text-sm text-text-muted">
              {hasAvailableModels
                ? 'Ask me anything about your document, or use the quick actions above.'
                : 'No AI models available. Please configure an AI provider in Admin â†’ Connectors.'}
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'rounded-lg p-3',
              message.role === 'user'
                ? 'bg-accent-primary/10 ml-4'
                : 'bg-background-tertiary mr-4'
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-xs font-medium text-text-muted">
                {message.role === 'user' ? 'You' : 'AI'}
              </span>
              <span className="text-xs text-text-muted">
                {message.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="text-sm text-text-primary whitespace-pre-wrap">
              {message.content}
            </div>

            {/* Action buttons for assistant messages */}
            {message.role === 'assistant' && !message.content.startsWith('Error:') && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-secondary">
                <button
                  type="button"
                  onClick={() => handleInsert(message.id, message.content)}
                  disabled={message.isInserted}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                    message.isInserted
                      ? 'text-green-600 cursor-default'
                      : 'text-accent-primary hover:bg-accent-primary/10'
                  )}
                  title="Insert at cursor"
                >
                  {message.isInserted ? (
                    <>
                      <Check className="w-3 h-3" />
                      Inserted
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      Insert
                    </>
                  )}
                </button>

                {context.selectedText && onReplace && (
                  <button
                    type="button"
                    onClick={() => handleReplace(message.id, message.content)}
                    disabled={message.isInserted}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded text-amber-600 hover:bg-amber-500/10 transition-colors"
                    title="Replace selection"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Replace
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleCopy(message.id, message.content)}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded text-text-muted hover:bg-background-secondary transition-colors"
                  title="Copy to clipboard"
                >
                  {copiedId === message.id ? (
                    <>
                      <Check className="w-3 h-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Clipboard className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex-shrink-0 px-4 py-3 border-t border-border-primary"
      >
        {selectedAction && selectedAction !== 'rephrase' && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-accent-primary font-medium capitalize">
              {selectedAction.replace('_', ' ')} mode
            </span>
            <button
              type="button"
              onClick={handleCancelAction}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="relative">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={
              selectedAction === 'draft'
                ? 'Describe what content to draft...'
                : selectedAction === 'explain'
                ? 'Enter a term to explain...'
                : 'Type a message or select an action...'
            }
            disabled={isLoading || !hasAvailableModels}
            rows={2}
            className="w-full px-3 py-2 pr-10 text-sm border border-border-primary rounded-lg bg-background-primary text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading || !hasAvailableModels}
            className="absolute right-2 bottom-2 p-1.5 rounded-md bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-1.5 text-xs text-text-muted">
          Press Enter to send, Shift+Enter for new line
        </p>
      </form>
      </div>
    </>
  );
}

// ============================================================================
// Hook for AI Sidebar State
// ============================================================================

export interface UseAISidebarOptions {
  mode: AIContextMode;
  templateCategory?: DocumentCategory;
  templateName?: string;
  tenantId?: string;
  tenantName?: string;
  companyContext?: AIContext['companyContext'];
}

export function useAISidebar(options: UseAISidebarOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedText, setSelectedText] = useState<string | undefined>();
  const [surroundingContent, setSurroundingContent] = useState<string | undefined>();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const updateSelection = useCallback((text: string | undefined, surrounding?: string) => {
    setSelectedText(text);
    setSurroundingContent(surrounding);
  }, []);

  const context: AIContext = {
    mode: options.mode,
    templateCategory: options.templateCategory,
    templateName: options.templateName,
    tenantId: options.tenantId,
    tenantName: options.tenantName,
    companyContext: options.companyContext,
    selectedText,
    surroundingContent,
  };

  return {
    isOpen,
    open,
    close,
    toggle,
    context,
    updateSelection,
  };
}
