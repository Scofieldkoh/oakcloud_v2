# Services Workspace Mockup Reference

## Purpose

This index records the approved visual direction for the Services workspace and
Service administration pages. The product design specification and
implementation plans must reference this file and the saved HTML gallery rather
than reinterpreting the layouts from prose alone.

## Saved Gallery

- Visual companion source:
  `.superpowers/brainstorm/1582-1786930476/content/services-complete-view-gallery-v2.html`
- Visual companion URL for the active local session:
  `http://localhost:49621/?key=fa0c36490fa609248cb83add0775e07c622a49a448be88d9a16317c77f05a848`

The local URL is session-specific. The HTML source is the durable workspace
artifact for this brainstorming session.

## View Index

1. Services roster
2. Deadlines table
3. Deadlines calendar
4. Billing
5. Administration — service catalog
6. Administration — deadline rules
7. Administration — business calendar

## Required Visual Decisions

- The operational page uses three tabs: Services, Deadlines, and Billing.
- Service-family filters sit beside the service-status filters on the Services
  roster.
- Deadline type, open-only, and service-family filters share one toolbar in
  both deadline views; no separate “Filter families” label is shown.
- Service-family colors are administrator-configured and appear consistently in
  table row accents, family badges, filters, and calendar events.
- Calendar events use the company alias. When it is absent, they use initials
  from meaningful legal-name words while excluding punctuation and corporate
  suffixes; for example, Oaktree Accounting & Corporate Solution Pte. Ltd.
  becomes OACS.
- Billing reconciliation lives inside the Billing tab and is collapsed by
  default. Configuration issue cards exist only when missing configuration is
  detected.
- Layout spacing follows the Oakcloud compact design system without crowding:
  clear separation between headers, filter controls, data surfaces, and
  pagination.
- Administration uses Service catalog, Deadline rules, and Business calendar
  tabs and is restricted to Tenant Admins and appropriately scoped Super Admins.

## Plan Referencing Requirement

The design specification and every implementation plan derived from it must
link to this mockup index. Tasks that implement a specific surface must cite its
view number from the list above.
