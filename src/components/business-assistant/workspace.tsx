'use client';

import { useRef, useState } from 'react';
import { Plus, Send, Sparkles, X, MessageSquare, SlidersHorizontal } from 'lucide-react';
import { useDebounce } from 'use-debounce';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAssistantConversations, useAssistantConversation, useAssistantConversationAction, useAssistantTurn, useAssistantResources, useAssistantFeedback,
  type AssistantResourceOption } from '@/hooks/use-business-assistant';
import type { BusinessAssistantMessageDto } from '@/lib/validations/business-assistant';
import { AssistantRunCard } from './run-card';
import { AssistantPreferencesPanel } from './preferences-panel';
import { BusinessAssistantAttachmentMenu } from './attachment-menu';
import { BizFileUploadDialog } from './bizfile-upload-dialog';

export function BusinessAssistantWorkspace({ workspaceId, firstName }: { workspaceId: string; firstName: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'conversation' | 'preferences'>('conversation');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [capability, setCapability] = useState('');
  const [attached, setAttached] = useState<AssistantResourceOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bizFileOpen, setBizFileOpen] = useState(false);
  const [resourceQuery, setResourceQuery] = useState('');
  const [debouncedQuery] = useDebounce(resourceQuery, 250);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversations = useAssistantConversations(workspaceId);
  const conversation = useAssistantConversation(workspaceId, conversationId);
  const conversationAction = useAssistantConversationAction(workspaceId);
  const conversationActionIds = useRef(new Map<string, string>());
  const [deletePrompt, setDeletePrompt] = useState<string | null>(null);
  const turn = useAssistantTurn(workspaceId);
  const resources = useAssistantResources(workspaceId, debouncedQuery, pickerOpen);
  const enabled = conversations.data?.enabled ?? false;
  const sending = turn.isPending;
  const newConversation = () => { setConversationId(null); setPanel('conversation'); setHistoryOpen(false); setAttached([]); setMessage(''); setCapability(''); setPickerOpen(false); setBizFileOpen(false); requestRef.current = null; turn.reset(); };
  async function send() {
    if (!message.trim() || sending || !enabled || (conversation.data && conversation.data.status !== 'ACTIVE')) return;
    const body = { workspaceId, conversationId, message: message.trim(), resources: attached.map(({ resourceType, resourceId, role }) => ({ resourceType, resourceId, role })),
      context: { route: '/business-assistant', ...(capability ? { capabilityId: capability } : {}) } };
    const fingerprint = JSON.stringify(body);
    if (requestRef.current?.fingerprint !== fingerprint) requestRef.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const result = await turn.mutateAsync({ ...body, clientRequestId: requestRef.current.id });
      setConversationId(result.conversationId); setMessage(''); setAttached([]); requestRef.current = null;
      textareaRef.current?.focus();
    } catch { /* The mutation error remains visible and retry retains the request key. */ }
  }
  async function manageConversation(action: 'ARCHIVE' | 'DELETE') {
    if (!conversationId) return;
    const key = `${conversationId}:${action}`;
    const clientRequestId = conversationActionIds.current.get(key) ?? crypto.randomUUID();
    conversationActionIds.current.set(key, clientRequestId);
    try {
      await conversationAction.mutateAsync({ id: conversationId, action, clientRequestId });
      setDeletePrompt(null); newConversation();
    } catch { /* Keep the same action identity for a retry. */ }
  }
  const activeError = conversations.error ?? conversation.error ?? turn.error ?? conversationAction.error;
  const conversationReadOnly = !!conversation.data && conversation.data.status !== 'ACTIVE';
  return <main className="flex min-h-[calc(100dvh-64px)] flex-col bg-background-primary text-text-primary" aria-label="Business Assistant workspace">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-primary px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-oak-primary/10 text-oak-light"><Sparkles className="h-5 w-5" aria-hidden="true" /></div>
        <div><h1 className="text-lg font-semibold">Business Assistant</h1><p className="text-xs text-text-secondary">Olaf · Your workspace assistant</p></div></div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" className="lg:hidden" leftIcon={<MessageSquare />} onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen}>History</Button>
        <Button variant={panel === 'preferences' ? 'secondary' : 'ghost'} leftIcon={<SlidersHorizontal />} onClick={() => setPanel(panel === 'preferences' ? 'conversation' : 'preferences')}>Preferences</Button>
        <Button variant="secondary" leftIcon={<Plus />} onClick={newConversation} disabled={sending}>New chat</Button>
      </div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside aria-label="Conversation history" className={cn('w-full shrink-0 border-b border-border-primary bg-background-secondary p-3 lg:block lg:w-56 lg:border-b-0 lg:border-r', !historyOpen && 'hidden')}>
        <h2 className="px-2 py-2 text-xs font-medium text-text-secondary">Recent conversations</h2>
        {conversations.isLoading && <p role="status" className="p-2 text-xs text-text-secondary">Loading history…</p>}
        {conversations.data?.conversations.length === 0 && <p className="p-2 text-xs text-text-secondary">Your conversations will appear here.</p>}
        <nav className="max-h-64 space-y-1 overflow-y-auto lg:max-h-[calc(100dvh-200px)]">{conversations.data?.conversations.map((item) =>
          <button key={item.id} type="button" aria-current={conversationId === item.id ? 'page' : undefined}
            className={cn('w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-background-tertiary', conversationId === item.id && 'bg-oak-primary/10 text-oak-light')}
            onClick={() => { setConversationId(item.id); setPanel('conversation'); setHistoryOpen(false); setAttached([]); setPickerOpen(false); turn.reset(); }}>
            {item.title || 'Untitled conversation'}
          </button>)}</nav>
      </aside>
      <div className="min-w-0 flex-1">
        {panel === 'preferences' ? <AssistantPreferencesPanel workspaceId={workspaceId} /> : <div className="mx-auto flex h-full max-w-4xl flex-col">
          <div className="flex-1 space-y-5 p-4 sm:p-6" aria-label="Conversation">
            {conversation.data && <div className="flex flex-wrap items-center gap-2 border-b border-border-primary pb-3">
              <h2 className="mr-auto text-sm font-medium">{conversation.data.title || 'Untitled conversation'}</h2>
              {conversation.data.status === 'ACTIVE' && <Button variant="ghost" size="xs" disabled={sending || conversationAction.isPending} onClick={() => void manageConversation('ARCHIVE')}>Archive conversation</Button>}
              {conversation.data.status !== 'DELETED' && <Button variant="ghost" size="xs" disabled={sending || conversationAction.isPending} onClick={() => setDeletePrompt(conversationId)}>Delete conversation</Button>}
            </div>}
            {deletePrompt === conversationId && conversationId && <section aria-label="Confirm conversation deletion" className="space-y-3 rounded-lg border border-border-primary p-3 text-sm">
              <p>Delete this conversation’s messages and stop work that has not started? Business records and required operation evidence remain available for audit and recovery.</p>
              <div className="flex gap-2"><Button variant="secondary" isLoading={conversationAction.isPending} onClick={() => void manageConversation('DELETE')}>Delete messages</Button>
                <Button variant="ghost" disabled={conversationAction.isPending} onClick={() => setDeletePrompt(null)}>Keep conversation</Button></div>
            </section>}
            {conversationReadOnly && <p className="text-sm text-text-secondary">This conversation is {conversation.data?.status.toLowerCase()}. Start a new chat to continue.</p>}
            {activeError && <div role="alert" className="rounded-lg border border-status-error/30 bg-status-error/5 p-3 text-sm">
              <p>{activeError.message}</p><Button variant="ghost" size="xs" onClick={() => { void conversations.refetch(); if (conversationId) void conversation.refetch(); }}>Refresh</Button>
            </div>}
            {!conversations.isLoading && conversations.data && !enabled && <p role="status" className="rounded-lg border border-border-primary bg-background-secondary p-3 text-sm text-text-secondary">The Business Assistant is not enabled for this workspace yet. Saved conversations remain available.</p>}
            {!conversationId && <section className="space-y-5 py-6 sm:py-12">
              <h2 className="text-2xl font-semibold">Hi{firstName ? `, ${firstName}` : ''}. What can I help you with?</h2>
              <p className="max-w-xl text-sm leading-6 text-text-secondary">Ask a question, find workspace information, or prepare a business action. I’ll show you proposed changes before asking you to approve them.</p>
              <div className="grid gap-3 sm:grid-cols-2">{conversations.data?.capabilities.map((item) => <button key={`${item.id}:${item.version}`} type="button" disabled={!enabled}
                onClick={() => { setCapability(item.id); setMessage(item.description); textareaRef.current?.focus(); }}
                className="rounded-xl border border-border-primary p-4 text-left transition-colors hover:bg-background-secondary disabled:opacity-60">
                <span className="block text-sm font-medium">{item.title}</span><span className="mt-2 block text-xs leading-5 text-text-secondary">{item.description}</span>
                <span className="mt-3 block text-xs text-oak-light">{item.executionKind === 'READ_ONLY' ? 'Read workspace information' : 'Review changes before approval'}</span>
              </button>)}</div>
              <p className="text-xs text-text-secondary">Working from a company profile? <button type="button" disabled={!enabled} onClick={() => setBizFileOpen(true)} className="text-oak-light underline underline-offset-2 disabled:opacity-50">Upload and review a BizFile here</button>.</p>
            </section>}
            {conversationId && conversation.isLoading && <p role="status" className="text-sm text-text-secondary">Loading conversation…</p>}
            {conversation.data?.messages.map((item) => <Message key={item.id} workspaceId={workspaceId} message={item} />)}
            {conversation.data?.runs.map((run) => <AssistantRunCard key={run.id} workspaceId={workspaceId} runId={run.id} />)}
          </div>
          <form className="sticky bottom-0 space-y-3 border-t border-border-primary bg-background-primary p-4 sm:px-6" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            {pickerOpen && <section aria-label="Attach workspace record" className="space-y-3 rounded-xl border border-border-primary bg-background-secondary p-3">
              <div className="flex items-center gap-2"><label htmlFor="assistant-resource-search" className="text-xs font-medium">Find a record</label>
                <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setPickerOpen(false)}>Close</Button></div>
              <input id="assistant-resource-search" value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder="Search by name…"
                className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm" />
              {resources.isLoading && <p className="text-xs" role="status">Finding records…</p>}
              {resources.error && <p role="alert" className="text-xs">{resources.error.message}</p>}
              {resources.data?.length === 0 && <p className="text-xs text-text-secondary">No accessible records found.</p>}
              <ul className="max-h-52 space-y-1 overflow-auto">{resources.data?.map((resource) => <li key={`${resource.resourceType}:${resource.resourceId}`}>
                <button type="button" disabled={attached.length >= 10 || attached.some((item) => item.resourceType === resource.resourceType && item.resourceId === resource.resourceId)}
                  className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-background-tertiary disabled:opacity-40"
                  onClick={() => setAttached((items) => [...items, resource])}>{resource.title}<span className="block text-xs text-text-secondary">{resource.description ?? resource.resourceType}</span></button>
              </li>)}</ul>
            </section>}
            {attached.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="Attached records">{attached.map((resource) => <li key={`${resource.resourceType}:${resource.resourceId}`}
              className="flex max-w-full items-center gap-2 rounded-lg bg-background-secondary px-2 py-1 text-xs"><span className="truncate">{resource.title}</span>
              <button type="button" aria-label={`Remove ${resource.title}`} disabled={sending} className="rounded p-1 focus-visible:ring-2 focus-visible:ring-oak-primary"
                onClick={() => setAttached((items) => items.filter((item) => item !== resource))}><X className="h-3 w-3" aria-hidden="true" /></button></li>)}</ul>}
            {capability && <p className="flex items-center gap-2 text-xs text-text-secondary">Using {conversations.data?.capabilities.find((item) => item.id === capability)?.title ?? capability}
              <button type="button" className="underline" onClick={() => setCapability('')}>Clear</button></p>}
            <label htmlFor="assistant-message" className="sr-only">Message Olaf</label>
            <textarea ref={textareaRef} id="assistant-message" rows={3} maxLength={12000} value={message} disabled={sending || !enabled || conversationReadOnly}
              onChange={(event) => setMessage(event.target.value)} placeholder="Ask Olaf to help with your work…"
              className="w-full resize-y rounded-xl border border-border-primary bg-background-secondary p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-oak-primary/30 disabled:opacity-60"
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <BusinessAssistantAttachmentMenu
                disabled={!enabled || sending || conversationReadOnly}
                onUploadBizFile={() => { setPickerOpen(false); setBizFileOpen(true); }}
                onChooseRecord={() => setPickerOpen(true)}
              />
              <div className="flex items-center gap-3"><span className="hidden text-xs text-text-muted sm:inline">Ctrl / ⌘ + Enter to send</span>
                <Button type="submit" leftIcon={<Send />} isLoading={sending} disabled={!enabled || !message.trim() || conversationReadOnly}>Send</Button></div>
            </div>
          </form>
          <BizFileUploadDialog
            isOpen={bizFileOpen}
            workspaceId={workspaceId}
            conversationId={conversationId}
            message={message}
            onClose={() => setBizFileOpen(false)}
            onAccepted={(acceptedConversationId) => {
              setConversationId(acceptedConversationId);
              setMessage('');
              setAttached([]);
              setCapability('');
              setPickerOpen(false);
              requestRef.current = null;
              textareaRef.current?.focus();
            }}
          />
        </div>}
      </div>
    </div>
  </main>;
}

function Message({ workspaceId, message }: { workspaceId: string; message: BusinessAssistantMessageDto }) {
  const feedback = useAssistantFeedback(workspaceId);
  const [comment, setComment] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const requestId = useRef<string | null>(null);
  const user = message.role === 'USER';
  return <article aria-label={user ? 'Your message' : 'Olaf response'} className={cn('rounded-xl p-4 text-sm', user ? 'ml-4 bg-background-secondary sm:ml-12' : 'border border-border-primary')}>
    <p className="mb-2 text-xs font-medium text-text-secondary">{user ? 'You' : 'Olaf'}</p>
    <p className="whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{message.content}</p>
    {['ACCEPTED', 'PROCESSING'].includes(message.status) && <p role="status" className="mt-2 text-xs text-text-muted">Working on this…</p>}
    {message.status === 'FAILED' && <p role="status" className="mt-2 text-xs text-status-error">This request could not be completed. You can send a revised request.</p>}
    {!user && message.status === 'PROCESSED' && <div className="mt-3">
      <button type="button" className="text-xs text-text-secondary underline underline-offset-2" onClick={() => setFeedbackOpen(!feedbackOpen)}>Give feedback</button>
      {feedbackOpen && <div className="mt-2 space-y-2"><label htmlFor={`feedback-${message.id}`} className="block text-xs">What was useful or needs improvement?</label>
        <textarea id={`feedback-${message.id}`} value={comment} maxLength={2000} rows={2} onChange={(event) => { setComment(event.target.value); requestId.current = null; }}
          className="w-full rounded-lg border border-border-primary bg-background-primary p-2 text-sm" />
        <Button variant="secondary" size="xs" disabled={!comment.trim() || feedback.isSuccess} isLoading={feedback.isPending} onClick={() => {
          requestId.current ??= crypto.randomUUID(); feedback.mutate({ clientEventId: requestId.current, targetType: 'MESSAGE', targetId: message.id, eventType: 'SENTIMENT', comment: comment.trim() });
        }}>Save feedback</Button>
        {feedback.isSuccess && <p role="status" className="text-xs">Thanks. Your feedback has been recorded.</p>}
        {feedback.error && <p role="alert" className="text-xs">{feedback.error.message}</p>}
      </div>}
    </div>}
  </article>;
}
