# Oakcloud Documentation

> **Last Updated**: 2026-09-27
> Central navigation for the current Oakcloud documentation set.

## Quick Start

| Document | Description |
|----------|-------------|
| [Getting Started](./GETTING_STARTED.md) | Local setup, data services, and first run |
| [Architecture](./ARCHITECTURE.md) | Runtime design, modules, and service layout |
| [README](./README.md) | Project overview and implemented modules |

## Tasks And Pipelines

| Document | Description |
|----------|-------------|
| [Architecture](./ARCHITECTURE.md#tasks-and-pipelines-architecture) | Versioned pipeline snapshots, lifecycle, stage-action adapters, and module integrations |
| [API Reference](./reference/API_REFERENCE.md#tasks-and-pipelines-endpoints) | Tenant-scoped pipeline, task, stage, and transition routes |
| [Database Schema](./reference/DATABASE_SCHEMA.md#tasks-and-pipelines-module-tables) | Task tables, enums, status rules, immutable snapshots, and legacy reset |

## Guides

| Guide | Description |
|-------|-------------|
| [RBAC Guideline](./guides/RBAC_GUIDELINE.md) | Authentication, roles, permissions, multi-tenancy |
| [Design Guideline](./guides/DESIGN_GUIDELINE.md) | UI components, styling, responsive patterns. Read [Start Here](./guides/DESIGN_GUIDELINE.md#start-here) first; the live showcase is at `/admin/components` (super admins, not in the sidebar) |
| [Keyboard Shortcuts](./guides/KEYBOARD_SHORTCUTS.md) | Shared shortcut mappings across modules |
| [Service Patterns](./guides/SERVICE_PATTERNS.md) | Service-layer architecture and conventions |
| [Staging & Deployment](./guides/STAGING_DEPLOYMENT.md) | Two-environment workflow for self-hosted Docker deployments |
| [Audit Logging](./guides/AUDIT_LOGGING.md) | Activity tracking and change logging |

## Infrastructure and Runtime

| Document | Description |
|----------|-------------|
| [Node 24 Runtime Migration](./plans/2026-09-05-node-24-runtime-migration.md) | Node 24, Chromium, Docker, CI, and verification plan |
| [Staging & Deployment](./guides/STAGING_DEPLOYMENT.md) | Staging runtime checks and production deployment guidance |

## Reference

| Reference | Description |
|-----------|-------------|
| [Database Schema](./reference/DATABASE_SCHEMA.md) | Tables, relationships, indexes, enums, [Tasks and Pipelines](./reference/DATABASE_SCHEMA.md#tasks-and-pipelines-module-tables), and contact identity operations |
| [API Reference](./reference/API_REFERENCE.md) | Authenticated and public API routes, including [Business Assistant](./reference/API_REFERENCE.md#business-assistant-endpoints), [Tasks and Pipelines](./reference/API_REFERENCE.md#tasks-and-pipelines-endpoints), and contact matching |
| [Environment Variables](./reference/ENVIRONMENT_VARIABLES.md) | Runtime and deployment configuration |

## Feature Specifications

| Document | Description |
|----------|-------------|
| [OakDoc Replacement Specification](./oakdoc-a4-retirement-readiness.md) | Historical (shipped in PRs #62-#66): replacement decisions D01-D07, native document contracts, migration rules. Current editor design is in [Architecture](./ARCHITECTURE.md#document-editor-oakdoc) |
| [OakDoc Parallel Implementation Handover](./plans/2026-09-26-oakdoc-replacement-implementation.md) | Historical: implementation packets and completion evidence for the OakDoc cutover |
| [Service Agreement Reference Fidelity Plan](./plans/2026-09-27-service-agreement-reference-fidelity.md) | Word-reference gap analysis, variables, formatting, structure, pagination and implementation acceptance |
| [Business Assistant Specification](./features/business-assistant/SPECIFICATION.md) | General assistant architecture; BizFile is a reference use case; repository-grounded v1.4 review |
| [Business Assistant BizFile Correction Workflow](./features/business-assistant/CORRECTION_WORKFLOW.md) | Implemented P12 deterministic-field correction UI, shared contract, API semantics, safety gates, and remaining correction work |
| [Business Assistant Implementation Handover](./plans/2026-09-05-business-assistant-implementation.md) | Current implementation checkpoint, completed correction UI review record, active P12-P16 work, validation evidence, and next-session scope |
| [SharePoint Signed-Document Filing](./superpowers/specs/2026-09-01-sharepoint-signed-document-filing-design.md) | Company folder mapping, template-relative routing, durable filing, and orphan recovery |
| [SharePoint Signed-Document Filing Implementation Plan](./superpowers/plans/2026-09-01-sharepoint-signed-document-filing.md) | Single-phase, test-first implementation tasks and completion gate |

## Forms Rollout Docs

The Forms module does not yet have a single stable spec file under `docs/features/`. The current implementation history lives in these rollout docs:

| Document | Description |
|----------|-------------|
| [Forms Improvements](./plans/2026-03-04-forms-improvements.md) | Main implementation plan for the Forms module |
| [Form Submission PDF Redesign](./plans/2026-03-09-form-submission-pdf-redesign.md) | HTML-to-PDF export for form responses |
| [Resume Draft UI Implementation](./plans/2026-03-09-resume-draft-ui-implementation.md) | Public draft resume and email flow |
| [Forms Implementation Review](./plans/2026-03-10-forms-implementation-review.md) | Security, performance, and logic review |
| [Singapore Company Incorporation Intake Form](./plans/2026-09-29-acra-incorporation-intake-form.md) | Guided template, advisory name check, review step, template lock, staff KYC checklist and readiness |
| [Forms API: option presets](./reference/API_REFERENCE.md#get-apiformspresets) | Managed CSV dropdown lists, protected built-ins, limits, and live form linkage |
| [Forms design: option presets](./guides/DESIGN_GUIDELINE.md#form-option-presets) | Preset manager and respondent dropdown interaction rules |
| [Forms API: URL health](./reference/API_REFERENCE.md#get-apiformsurl-health) | Tenant-scoped broken-link warning APIs, classifications, and safety bounds |
| [Forms design: URL information fields](./guides/DESIGN_GUIDELINE.md#form-url-information-fields) | Plain link styling and authenticated-only warning behavior |

## Other

| Document | Description |
|----------|-------------|
| [TODO / Roadmap](./TODO.md) | Known issues, roadmap, and completed work |
| [AI Debug](./debug/AI_DEBUG.md) | AI debugging guide, including form review traces |

## For AI Assistants

When working in this repo:

1. Start with this index.
2. Check [RBAC Guideline](./guides/RBAC_GUIDELINE.md) before changing protected routes or permissions.
3. Use [Service Patterns](./guides/SERVICE_PATTERNS.md) for backend work and [Design Guideline](./guides/DESIGN_GUIDELINE.md) for UI changes.
4. Use the Business Assistant implementation handover plus correction workflow for ongoing Business Assistant work.
5. Use the Forms rollout docs above for historical implementation context until a dedicated Forms feature spec exists.
6. Use the OakDoc specification and handover for document-editor replacement. September A4 implementation plans are historical; do not resume their editor-rewrite direction.
