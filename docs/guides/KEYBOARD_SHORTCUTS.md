# Keyboard Shortcut Standards

> **Last Updated**: 2026-02-06
> **Audience**: Developers, QA

This guide documents the current keyboard shortcut standard used across Companies, Contacts, and Document Vault pages.

## Core Standard

| Shortcut | Standard Meaning |
|----------|------------------|
| `Ctrl+R` | Refresh current page/list data |
| `F1` | Primary action for current page (create/upload/approve) |
| `F2` | Secondary contextual action (upload/update/edit/approve-next) |
| `Ctrl+Backspace` | Cancel or navigate back |
| `Ctrl+S` | Save or confirm in forms/workflows |
| `Ctrl+K` | Focus search input on list pages |

## Companies

| Page | Shortcuts |
|------|-----------|
| `/companies` | `Ctrl+R` refresh, `F1` add company, `F2` upload BizFile, `Ctrl+K` focus search |
| `/companies/new` | `Ctrl+Backspace` cancel, `Ctrl+S` create, `F2` open BizFile upload |
| `/companies/[id]` | `Ctrl+Backspace` back, `Ctrl+R` refresh, `F1` add company, `F2` update via BizFile, `F3` retrieve ACRA (when available), `Ctrl+E` edit |
| `/companies/[id]/edit` | `Ctrl+Backspace` cancel, `Ctrl+S` save, `F1` add company, `F2` update via BizFile |
| `/companies/[id]/audit` | `Ctrl+Backspace` back, `Ctrl+R` refresh, `F1` add company, `F2` update via BizFile |
| `/companies/upload` | `Ctrl+Backspace` cancel/back, `F1` create company, `Ctrl+S` confirm/apply update on preview steps |

## Contacts

| Page | Shortcuts |
|------|-----------|
| `/contacts` | `Ctrl+R` refresh, `F1` add contact, `Ctrl+K` focus search |
| `/contacts/new` | `Ctrl+Backspace` cancel, `Ctrl+S` create |
| `/contacts/[id]` | `Ctrl+Backspace` back, `Ctrl+R` refresh, `F1` add contact, `Ctrl+E` edit |
| `/contacts/[id]/edit` | `Ctrl+Backspace` cancel, `Ctrl+S` save, `F1` add contact |
| `/contacts/[id]/audit` | `Ctrl+Backspace` back, `Ctrl+R` refresh, `F1` add contact |

## Document Vault

| Page | Shortcuts |
|------|-----------|
| `/processing` | `Ctrl+R` refresh, `F1` upload documents, `F2` approve next pending |
| `/processing/upload` | `Ctrl+Backspace` back, `F1` upload files, `F2` merge files (`Ctrl+M` alias retained) |
| `/processing/[id]` | `Ctrl+Backspace` cancel/back, `Ctrl+R` refresh, `F1` approve/confirm, `F2` edit, `F3` save, `F4` re-extract |

## Implementation Notes

- Always show shortcuts in button labels as `Action (Key)` where possible.
- Do not trigger page-level shortcuts while typing in input fields.
- Keep function-key meanings stable: `F1` is primary, `F2` is secondary.
