# Oakcloud Design Guidelines

> **Last Updated**: 2026-02-05
> **Audience**: Developers, Designers

This document outlines the design system, UI components, and styling standards for the Oakcloud application.

## Related Documents

- [Architecture](../ARCHITECTURE.md) - System design overview
- [RBAC Guideline](./RBAC_GUIDELINE.md) - Permission patterns

## Start Here

This guide is long; most UI changes only need this section. Open `/admin/components` (super admins; it is not in the sidebar) to see every shared component below in its common states, rendered from the production code.

| Need | Use | Notes |
|---|---|---|
| Buttons | `Button` | One `primary` per page; `danger` only for destructive acts. |
| Text, date and toggle fields | `FormInput`, `SingleDateInput`, `Checkbox`, `Toggle` | Label above, hint or error below. |
| Pick from a loaded list | `SearchableSelect` (`TableSelectFilter` in table filter rows) | See [SearchableSelect](#searchableselect). |
| Pick from server search | `CompanySelect`, `ContactSearchSelect`, `AccountSearchSelect` (all on `AsyncSearchSelect`) | Pass the current value as `pinned` so it shows before any search. |
| Messages | `Alert`, `useToast`, `LoadingState`, `ErrorState`, `StatusBadge` | Inline for local fixes, alerts for lasting issues, toasts for passing outcomes. |
| Empty lists | `ListEmptyState`, `EmptyState` | See [Empty State Patterns](#empty-state-patterns). |
| Active filters | `ActiveFilterBar`, `FilterChip` | Clear all must reset every filter, search included. |
| Tables | `TableShell`, `TableRoot`, `TableHeaderCell`, `TableRow`, `TableEmptyState`, `Pagination` | From `data-table.tsx`. |
| Resizable columns | `useColumnResize` | Wire `startResize` and `resizeWithKeyboard` to `TableHeaderCell`; drag or arrow keys, saved once on release. |
| Dialogs | `Modal`, `ConfirmDialog`, `useConfirmDialog` | Never `window.confirm` or `alert`. |
| Leaving with unsaved edits | `useUnsavedNavigationGuard` | Same dialog for links, back and in-page actions. |
| Search boxes | `useDebouncedSearch` (`SEARCH_DEBOUNCE_MS`, 300 ms) | Follows outside changes such as Clear all. |
| List search, filters, sort and paging in the URL | `useUrlListParams` with a `urlParam` spec (`@/lib/url-list-params`) | Every filter in the spec survives reload, shared links and Back; defaults stay out of the URL. |

When you add a shared component to `src/components/ui`, add it to the showcase (`src/components/admin/component-showcase.tsx`) and to this table.

## Table of Contents

- [Start Here](#start-here)
- [Design Philosophy](#design-philosophy)
- [Design Principles](#design-principles)
- [Typography](#typography)
  - [Typography Nesting Rules](#typography-nesting-rules)
- [Color Palette](#color-palette)
  - [Semantic Color Usage Guide](#semantic-color-usage-guide)
- [Spacing System](#spacing-system)
  - [Spacing Enforcement Guide](#spacing-enforcement-guide)
  - [4px Grid System Reality](#4px-grid-system-reality)
  - [Component Padding Standards](#component-padding-standards)
- [Component Specifications](#component-specifications)
  - [Buttons](#buttons)
  - [Button Hierarchy and Usage](#button-hierarchy-and-usage)
  - [Component State Patterns](#component-state-patterns)
  - [Inputs](#inputs)
  - [Form Element Sizing Contexts](#form-element-sizing-contexts)
  - [Icon Sizing Standards](#icon-sizing-standards)
- [Form Layout Patterns](#form-layout-patterns)
- [Empty State Patterns](#empty-state-patterns)
- [Alert and Banner Hierarchy](#alert-and-banner-hierarchy)
- [Filter Action Patterns](#filter-action-patterns)
- [CSS Classes Reference](#css-classes-reference)
  - [Badge and Pill Conventions](#badge-and-pill-conventions)
  - [Tables](#tables)
  - [Table Design Patterns](#table-design-patterns)
- [UI Consistency Standards](#ui-consistency-standards)
  - [Page Layout Patterns](#page-layout-patterns)
  - [Button Icon Pattern](#button-icon-pattern)
  - [TenantSelector Placement](#tenantselector-placement)
  - [Empty States for SUPER_ADMIN](#empty-states-for-super_admin)
- [Reusable Components](#reusable-components)
  - [Filter Components](#filter-components)
- [Layout Guidelines](#layout-guidelines)
- [Component Examples](#component-examples)
- [Best Practices](#best-practices)
  - [CSS Utility Classes vs React Components](#css-utility-classes-vs-react-components)
- [Mobile Responsiveness](#mobile-responsiveness)

---

## Design Philosophy

Oakcloud follows a **sleek, modern, and compact** design philosophy inspired by Linear.app. The UI prioritizes information density while maintaining readability.

---

## Design Principles

1. **Compact & Dense** - Minimize whitespace, use smaller font sizes for data-heavy interfaces
2. **Subtle Interactions** - Muted hover states, smooth transitions (150ms)
3. **Light/Dark Mode** - Full theme support with light mode as default, carefully tuned contrast for both modes
4. **Consistent Spacing** - Use the 4px grid system (4, 8, 12, 16, 20, 24, 32px)
5. **Minimal Borders** - Prefer subtle borders over shadows for separation (shadows enabled in light mode for depth)

---

## Typography

### Font Scale

Balanced font sizes for modern, readable interfaces:

| Token | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `text-2xs` | 11px | 16px | Timestamps, metadata |
| `text-xs` | 12px | 18px | Labels, badges, captions |
| `text-sm` | 13px | 20px | Body text, inputs, buttons |
| `text-base` | 14px | 24px | Primary content |
| `text-lg` | 16px | 26px | Section headers |
| `text-xl` | 18px | 28px | Page subtitles |
| `text-2xl` | 20px | 30px | Page titles |
| `text-3xl` | 24px | 34px | Hero text |

### Font Families

- **Sans**: Inter (UI text)
- **Mono**: JetBrains Mono (code blocks, technical IDs)

### Typography Nesting Rules

Typography hierarchy varies by context. Choose heading sizes based on the container and semantic importance.

#### Heading Scale by Context

| Context | H1 | H2 | H3 | H4 |
|---------|----|----|----|----|
| **Page Level** | `text-2xl` (20px) | `text-xl` (18px) | `text-lg` (16px) | `text-base` (14px) |
| **Card/Section** | `text-lg` (16px) | `text-base` (14px) | `text-sm` (13px) | - |
| **Modal** | `text-lg` (16px) | `text-base` (14px) | `text-sm` (13px) | - |
| **Table/Dense UI** | `text-base` (14px) | `text-sm` (13px) | `text-xs` (12px) | - |

**Responsive Scaling**: Page-level headings can scale up on larger screens:
```tsx
// Page title scales from text-xl to text-2xl
<h1 className="text-xl sm:text-2xl font-semibold">
  Company Details
</h1>

// Section headers stay consistent (no responsive scaling)
<h2 className="text-lg font-semibold">
  Basic Information
</h2>
```

#### Context-Specific Examples

##### Page Headers
```tsx
// Main page title - largest in hierarchy
<div className="mb-6">
  <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
    Companies
  </h1>
  <p className="text-sm text-text-secondary mt-1">
    Manage company records and documentation
  </p>
</div>

// Page sections use smaller headings
<section className="mb-6">
  <h2 className="text-xl font-semibold mb-4">
    Active Companies
  </h2>
  {/* Content */}
</section>
```

##### Form Section Headers
```tsx
// Full-page form (e.g., Add Company)
<form>
  <h2 className="text-lg font-semibold mb-4">
    Basic Information
  </h2>
  <FormInput label="Company Name" />
  <FormInput label="Registration Number" />

  <h2 className="text-lg font-semibold mb-4 mt-6">
    Contact Details
  </h2>
  <FormInput label="Email" />
  <FormInput label="Phone" />
</form>
```

##### Card Headers
```tsx
// Card within a page
<Card>
  <h3 className="text-lg font-semibold mb-3">
    Recent Activity
  </h3>
  <div className="space-y-2">
    {/* Activity items */}
  </div>
</Card>

// Stats card (no explicit heading, just value + label)
<Card className="p-4">
  <div className="text-2xl font-bold text-text-primary">
    142
  </div>
  <div className="text-xs text-text-secondary mt-1">
    Total Companies
  </div>
</Card>
```

##### Modal Headers
```tsx
// Modal title - text-lg is standard
<Modal>
  <ModalHeader>
    <h2 className="text-lg font-semibold">
      Add New Company
    </h2>
  </ModalHeader>
  <ModalBody>
    <FormInput label="Company Name" />
  </ModalBody>
</Modal>

// Confirmation dialog - slightly smaller
<ConfirmDialog>
  <h3 className="text-base font-semibold mb-2">
    Delete Company?
  </h3>
  <p className="text-sm text-text-secondary">
    This action cannot be undone.
  </p>
</ConfirmDialog>
```

##### Table Headers
```tsx
// Table column headers use text-xs with font-medium
<thead>
  <tr className="bg-bg-secondary">
    <th className="text-xs font-medium text-text-secondary uppercase tracking-wider">
      Name
    </th>
    <th className="text-xs font-medium text-text-secondary uppercase tracking-wider">
      Status
    </th>
  </tr>
</thead>
```

#### Font Weight Hierarchy

Use font weight to establish visual hierarchy within the same size:

| Weight | Class | Usage |
|--------|-------|-------|
| **Semibold** | `font-semibold` (600) | Headings (h1-h4), emphasized labels |
| **Medium** | `font-medium` (500) | Form labels, table headers, button text |
| **Normal** | `font-normal` (400) | Body text, descriptions, input values |

```tsx
// Heading with semibold weight
<h2 className="text-lg font-semibold">Section Title</h2>

// Form label with medium weight
<label className="text-xs font-medium text-text-secondary">
  Company Name
</label>

// Body text with normal weight
<p className="text-sm text-text-secondary">
  This is a description paragraph with normal weight.
</p>
```

#### Form Label Typography

Form labels use consistent styling across all contexts:

```tsx
// Standard form label
<label className="text-xs font-medium text-text-secondary mb-1.5 block">
  Email Address
</label>

// Required field indicator
<label className="text-xs font-medium text-text-secondary mb-1.5 block">
  Company Name
  <span className="text-error ml-1">*</span>
</label>

// Optional field hint
<label className="text-xs font-medium text-text-secondary mb-1.5 flex items-center justify-between">
  <span>Phone Number</span>
  <span className="text-2xs text-text-muted font-normal">(optional)</span>
</label>
```

**Label Spacing**: Always use `mb-1.5` (6px) or `mb-2` (8px) gap between label and input for clear association.

#### Body Text Sizing

| Size | Class | Usage |
|------|-------|-------|
| **Small** | `text-sm` (13px) | Default body text, descriptions, helper text |
| **Base** | `text-base` (14px) | Emphasis body text, list items |
| **Extra Small** | `text-xs` (12px) | Fine print, metadata, timestamps |

```tsx
// Standard paragraph
<p className="text-sm text-text-secondary">
  This company was registered in 2020 and has 5 active contracts.
</p>

// Emphasized paragraph
<p className="text-base text-text-primary">
  Important notice: Please review the following changes.
</p>

// Metadata text
<span className="text-xs text-text-muted">
  Last updated 2 hours ago
</span>
```

#### Typography Nesting Best Practices

**✅ Good: Clear hierarchy**
```tsx
<div>
  {/* Page title */}
  <h1 className="text-xl sm:text-2xl font-semibold mb-6">
    Company Details
  </h1>

  {/* Card with nested heading */}
  <Card>
    <h2 className="text-lg font-semibold mb-3">
      Basic Information
    </h2>
    <dl className="space-y-2">
      <dt className="text-xs font-medium text-text-secondary">Name</dt>
      <dd className="text-sm text-text-primary">Acme Corp</dd>
    </dl>
  </Card>
</div>
```

**❌ Bad: Inconsistent sizing**
```tsx
<div>
  {/* Page title too small */}
  <h1 className="text-lg font-semibold mb-6">
    Company Details
  </h1>

  {/* Card heading same size as page title - no hierarchy */}
  <Card>
    <h2 className="text-lg font-semibold mb-3">
      Basic Information
    </h2>
  </Card>
</div>
```

**✅ Good: Semantic HTML with appropriate sizing**
```tsx
<article>
  <h1 className="text-2xl font-semibold">Article Title</h1>
  <section>
    <h2 className="text-xl font-semibold">Section 1</h2>
    <h3 className="text-lg font-semibold">Subsection 1.1</h3>
    <p className="text-sm">Content here...</p>
  </section>
</article>
```

**❌ Bad: Wrong semantic element**
```tsx
<div>
  <div className="text-2xl font-semibold">Not a heading</div>
  <span className="text-xl font-semibold">Also not a heading</span>
</div>
```

**Key Rules**:
- Use semantic HTML (`h1`-`h6`, `p`, `label`, etc.)
- Size headings relative to their container, not just their semantic level
- Maintain clear visual hierarchy: page > section > card > element
- Keep font sizes within 2-3 steps apart for readability
- Form labels always use `text-xs font-medium`

---

## Color Palette

The application supports both light and dark modes with CSS variables. Light mode is the default.

### Light Mode (Default)

```css
/* Primary Brand (Teal-Green) */
--oak-primary: #294d44;    /* Buttons, active states */
--oak-hover: #23423a;      /* Button hover */
--oak-light: #3a6b5f;      /* Accent text, links */
--oak-dark: #1f3a33;       /* Button active/pressed */

/* Backgrounds (Soft off-white tones) */
--bg-primary: #f8f9fb;     /* Page background (soft gray) */
--bg-secondary: #ffffff;   /* Cards, sidebar (white) */
--bg-tertiary: #f1f3f5;    /* Hover states, table headers */
--bg-elevated: #ffffff;    /* Dropdowns, elevated cards */

/* Borders */
--border-primary: #e2e4e9; /* Default borders */
--border-secondary: #d0d3d9; /* Emphasized borders */
--border-focus: #294d44;   /* Focus rings */

/* Text */
--text-primary: #1a1d23;   /* Primary content */
--text-secondary: #5c6370; /* Secondary text */
--text-tertiary: #7d838f;  /* Placeholder, disabled */
--text-muted: #a0a5b0;     /* Muted, decorative */

/* Table Row Colors */
--oak-row-alt: #f7fbfa;           /* Alternate row background */
--oak-row-alt-hover: #f0f7f5;     /* Alternate row hover */
--oak-row-selected: #d4e8e2;      /* Selected row background (visible green) */
--oak-row-selected-hover: #c5ded6; /* Selected row hover */
```

### Dark Mode

```css
/* Primary Brand (Teal-Green) */
--oak-primary: #294d44;    /* Buttons, active states */
--oak-hover: #3a6b5f;      /* Button hover */
--oak-light: #4a8b7f;      /* Accent text, links */
--oak-dark: #1f3a33;       /* Button active/pressed */

/* Backgrounds (Darkest to Lightest) */
--bg-primary: #0d0d0d;     /* Page background */
--bg-secondary: #141414;   /* Cards, sidebar */
--bg-tertiary: #1a1a1a;    /* Hover states, table headers */
--bg-elevated: #212121;    /* Dropdowns, elevated cards */

/* Borders */
--border-primary: #2a2a2a; /* Default borders */
--border-secondary: #333;  /* Emphasized borders */
--border-focus: #294d44;   /* Focus rings */

/* Text */
--text-primary: #ffffff;   /* Primary content */
--text-secondary: #a1a1a1; /* Secondary text */
--text-tertiary: #6b6b6b;  /* Placeholder, disabled */
--text-muted: #525252;     /* Muted, decorative */

/* Table Row Colors */
--oak-row-alt: #161a19;           /* Alternate row background */
--oak-row-alt-hover: #1a2420;     /* Alternate row hover */
--oak-row-selected: #1f3830;      /* Selected row background (visible green) */
--oak-row-selected-hover: #264239; /* Selected row hover */
```

### Status Colors (Both Modes)

```css
--status-success: #22c55e; /* Success states */
--status-warning: #eab308; /* Warning states */
--status-error: #ef4444;   /* Error states */
--status-info: #3b82f6;    /* Info states */
```

### Semantic Color Usage Guide

Use colors consistently to communicate meaning across the application:

#### Status & State Colors

| Color | Usage | Badge Example | Text Example |
|-------|-------|---------------|--------------|
| **Success (Green)** | Completed actions, active status, positive states | `status="success"`, "Live", "Active", "Enabled", "OK" | Confirmation messages |
| **Warning (Yellow)** | Caution, pending review, attention needed | `status="warning"`, "Pending", "Review", "Overdue" | Warning alerts, notices |
| **Error (Red)** | Failures, critical issues, destructive actions | `status="error"`, "Failed", "Rejected", "Error" | Error messages, delete actions |
| **Info (Blue)** | Neutral information, metadata, secondary states | `status="info"`, "Draft", "Pending Setup", scope badges | Informational alerts |

#### Brand & Accent Colors

| Color | Usage | Examples |
|-------|-------|----------|
| **Oak Primary** | Primary actions, active navigation, selected states | Primary buttons, active sidebar items, checkboxes |
| **Oak Light** | Links, interactive text, accent highlights | Clickable text, icon accents |
| **Oak Hover** | Hover states for primary elements | Button hover backgrounds |

#### Badge Color Conventions

Different badge types use colors to convey semantic meaning:

```tsx
// Status badges - Use status colors
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="error">Rejected</Badge>

// Type badges - Use neutral colors
<Badge variant="default">Individual</Badge>
<Badge variant="default">Corporate</Badge>

// Scope badges - Use info color with icon
<Badge variant="info">
  <Icon name="building" />
  Tenant
</Badge>

// Pipeline/workflow badges - Use success with icon
<Badge variant="success">
  <Icon name="check" />
  Extracted
</Badge>
```

#### Text Color Hierarchy

| Color | Usage | CSS Variable |
|-------|-------|--------------|
| **Primary** | Headings, important content | `text-text-primary` |
| **Secondary** | Body text, descriptions | `text-text-secondary` |
| **Tertiary** | Placeholders, disabled text | `text-text-tertiary` |
| **Muted** | Decorative text, metadata | `text-text-muted` |

#### Stats Card Icon Colors

Stats cards can use themed icon colors to indicate status or category:

```tsx
// Neutral (default) - Standard metrics
<StatsCard icon={<Users />} iconColor="text-text-secondary" />

// Status-themed - Match the metric meaning
<StatsCard icon={<CheckCircle />} iconColor="text-status-success" /> // Positive metric
<StatsCard icon={<AlertCircle />} iconColor="text-status-warning" /> // Needs attention
<StatsCard icon={<XCircle />} iconColor="text-status-error" /> // Problem metric
<StatsCard icon={<InfoCircle />} iconColor="text-status-info" /> // Informational metric
```

**Best Practice**: Use themed colors sparingly in stats cards. Reserve color for metrics that truly indicate status (errors, warnings, completions). Most stats should use neutral colors to avoid visual noise.

#### Multiple Status Indicators

When displaying multiple status types in the same context (e.g., Connectors table showing both "Enabled" status and "Test OK" status):

- Use separate columns or clear visual grouping
- Ensure color combinations don't conflict or confuse
- Consider using icons to differentiate status types
- Keep color meanings consistent across the application

**Example**:
```tsx
// Good: Separate columns with distinct meanings
<TableCell>
  <Badge variant="success">Enabled</Badge> // Operational status
</TableCell>
<TableCell>
  <Badge variant="success"><Icon name="check" />OK</Badge> // Test status
</TableCell>
```

**See Also:**
- [Badge and Pill Conventions](#badge-and-pill-conventions) for semantic badge colors
- [Alert and Banner Hierarchy](#alert-and-banner-hierarchy) for alert color usage
- [Component State Patterns](#component-state-patterns) for focus ring colors
- [Table Design Patterns](#table-design-patterns) for selected row colors

### Theme Toggle

Users can switch themes via the toggle in the sidebar. The preference is persisted to localStorage.

---

## Spacing System

Based on a 4px grid system:

| Token | Value | Usage |
|-------|-------|-------|
| `p-1` | 4px | Icon padding |
| `p-2` | 8px | Compact elements |
| `p-3` | 12px | Card padding, nav items, alerts |
| `p-4` | 16px | Section padding, modal headers |
| `p-6` | 24px | Page padding |
| `gap-1` | 4px | Icon + text |
| `gap-2` | 8px | Related elements, form labels |
| `gap-4` | 16px | Sections |
| `mb-4` | 16px | Sub-element spacing within sections |
| `mb-6` | 24px | Major section spacing |

### Spacing Enforcement Guide

#### 4px Grid System Reality

**Important Note**: While we document a 4px grid system as the ideal, the application currently uses a **mixed approach** due to Chakra UI integration. This is intentional and acceptable:

**Why Mixed Spacing Exists:**
- Chakra UI components (Button, Input, etc.) have their own internal spacing that doesn't align to 4px
- Button heights: 28px (xs), 32px (sm), 36px (md), 44px (lg) - only xs aligns to 4px
- Input heights follow the same non-4px scale
- Forcing 4px alignment would require forking Chakra components (not worth the effort)

**The Practical Standard:**
- **Chakra Components**: Accept their built-in spacing (see scale below)
- **Custom Components**: Strictly follow 4px grid (p-2, p-3, p-4, gap-2, gap-4, mb-4, mb-6)
- **Layout & Sections**: Always use 4px grid (gap-4, mb-6, p-4)

#### 4px Grid System with Chakra UI

While we aim for a 4px grid system, Chakra UI components use their own spacing scale. This is acceptable when using Chakra components, but custom components should follow the 4px grid strictly:

**Chakra Spacing Scale** (for Chakra components only):
- 7 units = 28px (buttons, inputs xs) ✅ 4px-aligned
- 8 units = 32px (buttons, inputs sm) ❌ Not 4px-aligned
- 9 units = 36px (buttons, inputs md) ✅ 4px-aligned
- 11 units = 44px (buttons, inputs lg) ✅ 4px-aligned

**Tailwind 4px Grid** (for custom components):
- Use: `p-1, p-2, p-3, p-4, p-6, p-8`
- Avoid: `p-2.5, p-3.5, p-5, p-7` (not 4px-aligned)

#### Component Padding Standards

Maintain consistent padding across similar component types:

| Component | Padding | Rationale |
|-----------|---------|-----------|
| **Alert** | `p-3` (12px) | Compact but readable |
| **Card** | `p-4` (16px) | Standard content padding |
| **Card Compact** | `p-3` (12px) | Dense layouts (dashboards) |
| **Modal Header** | `p-4` (16px) | Prominent, clear separation |
| **Modal Body** | `p-4` (16px) | Consistent with header |
| **Table Cell** | `px-3 py-2` (12px/8px) | Standard tables |
| **Table Cell Dense** | `px-2 py-1.5` (8px/6px) | Complex tables (document processing) |
| **Sidebar Item** | `px-3 py-2` (12px/8px) | Navigation items |

**Example**:
```tsx
// ✅ Good: Consistent component padding
<Alert className="p-3">Warning message</Alert>
<div className="card p-4">Card content</div>
<div className="card card-compact p-3">Dense card</div>

// ❌ Bad: Mixed padding values
<Alert className="p-2.5">Warning</Alert> // Not grid-aligned
<div className="card p-5">Card</div> // Use p-4 or p-6
```

#### Section Spacing

Use consistent spacing between major page sections:

```tsx
// ✅ Good: Single mb-6 between major sections
<div className="mb-6">
  <PageHeader />
</div>
<div className="mb-6">
  <StatsCards />
</div>
<div>
  <DataTable />
</div>

// ❌ Bad: Multiple mb-6 creating 48px gaps
<div className="mb-6">
  <PageHeader className="mb-6" /> {/* Double spacing! */}
</div>
<div className="mb-6">
  <StatsCards />
</div>
```

**Rule**: Use `mb-6` for major section gaps, `mb-4` for related sub-elements within a section.

#### Responsive Grid Gaps

Grid gaps should stay consistent or get smaller on larger screens (never larger):

```tsx
// ✅ Good: Consistent gap
<div className="grid gap-4">

// ✅ Good: Larger gap on mobile (for touch targets)
<div className="grid gap-4 sm:gap-3">

// ❌ Bad: Gap increases on desktop (inverted pattern)
<div className="grid gap-3 sm:gap-4">
```

**Rationale**: Desktop users can handle denser layouts. Mobile users need more spacing for touch targets.

#### Form Label Spacing

Form labels should have consistent spacing from their inputs:

```tsx
// ✅ Good: gap-2 (8px) between label and input
<Box display="flex" flexDirection="column" gap="2">
  <FormLabel>Email</FormLabel>
  <Input />
</Box>

// ❌ Bad: gap-1.5 (6px) too small, not grid-aligned
<Box display="flex" flexDirection="column" gap="1.5">
  <FormLabel>Email</FormLabel>
  <Input />
</Box>
```

#### Avoiding Negative Margins

Negative margins create confusion and break the grid system:

```tsx
// ✅ Good: Proper padding without negative margin
<Button className="p-2">
  <Icon />
</Button>

// ❌ Bad: Negative margin to compensate for padding
<Button className="p-2 -m-1">
  <Icon />
</Button>
```

**Rule**: If you need negative margins to fix spacing, the padding is wrong. Adjust the padding instead.

---

## Component Specifications

### Buttons

| Size | Height | Padding | Font | Border Radius | Use Case |
|------|--------|---------|------|---------------|----------|
| `xs` | 28px | 12px | 12px | 4px | Inline actions, table rows |
| `sm` | 32px | 16px | 13px | 4px | Default, most actions |
| `md` | 36px | 20px | 13px | 4px | Primary actions, forms |
| `lg` | 40px | 24px | 14px | 6px | Hero CTAs |

#### Button Hierarchy and Usage

Use button variants consistently to establish clear visual hierarchy:

##### Variant Selection Guide

| Variant | Visual Style | When to Use | Examples |
|---------|-------------|-------------|----------|
| **Primary** | Oak green background, white text | Main action on the page, call-to-action | "Add Company", "Save", "Create", "Submit" |
| **Secondary** | White/gray background, border, text | Supporting actions, less emphasis | "Cancel", "Back", "View Details" |
| **Ghost** | Transparent background, text only | Tertiary actions, inline operations | "Edit", "Delete", table row actions |
| **Danger** | Red tint, destructive emphasis | Destructive actions (delete, remove) | "Delete Company", "Remove User" |

##### Button Combinations

Follow these patterns for common action groups:

```tsx
// ✅ Good: Clear hierarchy
<div className="flex gap-2">
  <Button variant="primary">Save Changes</Button>
  <Button variant="secondary">Cancel</Button>
</div>

// ✅ Good: Destructive action with confirmation
<div className="flex gap-2">
  <Button variant="danger">Delete</Button>
  <Button variant="secondary">Cancel</Button>
</div>

// ❌ Bad: Multiple primary buttons (confusing)
<div className="flex gap-2">
  <Button variant="primary">Save</Button>
  <Button variant="primary">Save & Close</Button>
  <Button variant="secondary">Cancel</Button>
</div>
```

**Rule**: One primary action per section. All other actions should be secondary or ghost.

##### Page Header Button Patterns

Consistent button usage in page headers:

```tsx
// ✅ Good: Primary CTA on right, secondary actions on left
<PageHeader>
  <div className="flex items-center justify-between">
    <div className="flex gap-2">
      <Button variant="ghost" leftIcon={<RefreshIcon />}>Refresh</Button>
      <Button variant="secondary" leftIcon={<UploadIcon />}>Import</Button>
    </div>
    <Button variant="primary" leftIcon={<PlusIcon />}>Add Company</Button>
  </div>
</PageHeader>

// ❌ Bad: Multiple primary actions, unclear hierarchy
<PageHeader>
  <Button variant="primary">Upload</Button>
  <Button variant="primary">Add Company</Button>
</PageHeader>
```

##### Icon Button Sizing

Icon-only buttons should maintain consistent icon sizing:

| Button Size | Icon Size | Example |
|-------------|-----------|---------|
| `xs` | 14px (`w-3.5 h-3.5`) | Table row actions |
| `sm` | 16px (`w-4 h-4`) | Standard icon buttons |
| `md` | 16px (`w-4 h-4`) | Form actions |
| `lg` | 20px (`w-5 h-5`) | Hero CTAs |

```tsx
// ✅ Good: Icon size matches button size
<Button size="sm" variant="ghost">
  <Icon className="w-4 h-4" />
</Button>

// ❌ Bad: Icon too large for button
<Button size="sm" variant="ghost">
  <Icon className="w-6 h-6" /> {/* Too large! */}
</Button>
```

##### Keyboard Shortcuts Display

When buttons have keyboard shortcuts, display them consistently:

```tsx
// ✅ Good: Keyboard shortcut in subtle badge
<Button variant="ghost" rightIcon={<Badge variant="subtle">Ctrl+R</Badge>}>
  Refresh
</Button>

// ✅ Good: Keyboard shortcut in parentheses (simpler approach)
<Button variant="ghost">Refresh (Ctrl+R)</Button>

// ❌ Bad: Inconsistent formatting
<Button variant="ghost">Refresh - Ctrl+R</Button>
<Button variant="ghost">Upload [F1]</Button>
```

**Recommendation**: Use parentheses format for simplicity: `Action (Key)`. Reserve badge format for complex shortcuts.

##### Button Loading States

Show loading feedback for async operations:

```tsx
// ✅ Good: Loading state with spinner
<Button
  variant="primary"
  isLoading={isSubmitting}
  loadingText="Saving..."
>
  Save Changes
</Button>

// ❌ Bad: No loading feedback
<Button variant="primary" onClick={handleSubmit}>
  Save Changes
</Button>
```

##### Disabled State Guidance

Use disabled states sparingly and provide context:

```tsx
// ✅ Good: Disabled with tooltip explaining why
<Tooltip label="Select a tenant first">
  <Button variant="primary" isDisabled={!selectedTenant}>
    Continue
  </Button>
</Tooltip>

// ❌ Bad: Disabled with no explanation
<Button variant="primary" isDisabled>Continue</Button>
```

### Inputs

| Size | Height | Padding | Font | Border Radius | Use Case |
|------|--------|---------|------|---------------|----------|
| `xs` | 28px | 12px | 12px | 4px | Compact filters |
| `sm` | 32px | 12px | 13px | 4px | Table inline edit |
| `md` | 36px | 14px | 13px | 4px | Default forms |
| `lg` | 40px | 16px | 14px | 6px | Login, prominent inputs |

#### Form Element Sizing Contexts

Choose input size based on context and importance to maintain visual hierarchy and usability.

##### Size Selection Guide

| Context | Recommended Size | Rationale | Examples |
|---------|------------------|-----------|----------|
| **Login / Auth Forms** | `lg` (40px) | High importance, prominent placement, generous touch targets | Email, password fields on login page |
| **Standard Forms** | `md` (36px) | Default for most form inputs, balanced size | Company name, contact fields, settings |
| **Table Filters** | `xs` (28px) | Compact to fit in dense layouts, minimize vertical space | Dropdown filters in table headers, search in tables |
| **Inline Edit** | `sm` (32px) | Slightly larger than filters, but still compact | Editable cells in tables, quick edit modals |
| **Search Bars** | `md` or `lg` | Depends on prominence - `lg` for hero search, `md` for page search | Global search (lg), page-level search (md) |
| **Settings Pages** | `md` (36px) | Standard size, consistency with other forms | Configuration inputs, preferences |

##### Contextual Examples

###### Login Page
```tsx
// Use lg size for prominent, important inputs
<FormInput
  size="lg"
  label="Email"
  type="email"
  placeholder="you@company.com"
/>

<FormInput
  size="lg"
  label="Password"
  type="password"
/>

<Button size="lg" variant="primary" className="w-full">
  Sign In
</Button>
```

###### Standard Form (Add Company)
```tsx
// Use md size for standard forms
<FormInput
  size="md"
  label="Company Name"
  placeholder="Enter company name"
  required
/>

<FormInput
  size="md"
  label="Registration Number"
  placeholder="e.g., 201234567K"
/>

<FormInput
  size="md"
  label="Email"
  type="email"
  placeholder="contact@company.com"
/>
```

###### Table Filter (Document Processing)
```tsx
// Use xs size for compact table header filters
<thead>
  <tr className="bg-bg-secondary">
    <th>
      <FormInput
        size="xs"
        type="search"
        placeholder="Search..."
        className="min-w-[120px]"
      />
    </th>
    <th>
      <Select size="xs" placeholder="All statuses">
        <option>Extracted</option>
        <option>Approved</option>
      </Select>
    </th>
  </tr>
</thead>
```

###### Inline Edit (Table Cell)
```tsx
// Use sm size for inline editing in tables
<TableCell>
  <FormInput
    size="sm"
    defaultValue={row.amount}
    onBlur={handleSave}
  />
</TableCell>
```

##### Context-Specific Dropdown Styling

Dropdown styling varies by context to match visual density:

**Form Selects (Standard Context)**
```tsx
// Bordered, clear boundaries
<Select
  size="md"
  className="border border-border-primary bg-bg-primary"
>
  <option>Option 1</option>
</Select>
```

**Table Header Filters (Dense Context)**
```tsx
// Transparent background, no border until focused
// Blends with table header background
<Select
  size="xs"
  className="bg-transparent border-0 focus:border focus:border-border-primary focus:bg-bg-primary"
>
  <option>All</option>
</Select>
```

**Rationale**: Table filters use transparent styling to reduce visual noise in dense layouts. The border appears on focus to indicate interactivity.

##### Mobile Touch Targets

All interactive form elements must meet minimum touch target size of **44px** on mobile:

```tsx
// Inputs automatically meet touch target with padding
<FormInput
  size="md"  // 36px height + padding = 44px+ touch target
  className="min-h-[44px]"
/>

// Small inputs need explicit min-height on mobile
<FormInput
  size="xs"  // 28px height
  className="min-h-[44px] sm:min-h-0"  // 44px on mobile, auto on desktop
/>
```

**Best Practice**: Avoid using `xs` or `sm` sizes on mobile unless within a scrollable container (like a table) where the entire row is tappable.

##### Size Consistency Guidelines

- **Within a form**: Use the same size for all inputs (typically `md`)
- **Within a table**: Use the same size for all filters (typically `xs`)
- **Within a modal**: Match the form type (standard form = `md`, quick edit = `sm`)
- **Exception**: Login/auth pages use `lg` for prominence

```tsx
// ✅ Good: Consistent sizing within form
<form>
  <FormInput size="md" label="Name" />
  <FormInput size="md" label="Email" />
  <Select size="md" label="Type" />
</form>

// ❌ Bad: Mixed sizes create visual inconsistency
<form>
  <FormInput size="lg" label="Name" />
  <FormInput size="md" label="Email" />
  <Select size="sm" label="Type" />
</form>
```

### Icon Sizing Standards

Use consistent icon sizing across the application:

#### Icon Size Reference

| Size | Pixels | Tailwind Class | Use Case |
|------|--------|----------------|----------|
| **XS** | 12px | `w-3 h-3` | Inline text, dense badges, small buttons |
| **SM** | 14px | `w-3.5 h-3.5` | Form inputs xs, table row actions, compact UI |
| **MD** | 16px | `w-4 h-4` | Default buttons, form inputs sm/md, navigation |
| **LG** | 20px | `w-5 h-5` | Large buttons, page headers, empty states |
| **XL** | 24px | `w-6 h-6` | Prominent actions, hero sections |
| **2XL** | 32px | `w-8 h-8` | Large empty states, standalone icons |
| **3XL** | 48px | `w-12 h-12` | Empty state illustrations |

#### Implementation Patterns by Context

##### Button Icons

Match icon size to button size (see Button Hierarchy section for details):

```tsx
// Button xs - Icon 14px (w-3.5 h-3.5)
<Button size="xs" leftIcon={<PlusIcon className="w-3.5 h-3.5" />}>
  Add
</Button>

// Button sm - Icon 16px (w-4 h-4)
<Button size="sm" leftIcon={<PlusIcon className="w-4 h-4" />}>
  Add
</Button>

// Button md - Icon 16px (w-4 h-4)
<Button size="md" leftIcon={<PlusIcon className="w-4 h-4" />}>
  Add
</Button>

// Button lg - Icon 20px (w-5 h-5)
<Button size="lg" leftIcon={<PlusIcon className="w-5 h-5" />}>
  Add
</Button>
```

##### Form Input Icons

Input icons should match or be slightly smaller than the input text:

```tsx
// Input xs - Icon 14px
<FormInput
  size="xs"
  leftIcon={<SearchIcon className="w-3.5 h-3.5" />}
  placeholder="Search..."
/>

// Input sm/md - Icon 16px (default)
<FormInput
  size="md"
  leftIcon={<EmailIcon className="w-4 h-4" />}
  placeholder="Email"
/>

// Input lg - Icon 20px
<FormInput
  size="lg"
  leftIcon={<LockIcon className="w-5 h-5" />}
  placeholder="Password"
/>
```

##### Navigation Icons

Sidebar and menu icons use consistent 16px (w-4 h-4):

```tsx
// Sidebar navigation
<NavItem icon={<HomeIcon className="w-4 h-4" />}>
  Home
</NavItem>

// Dropdown menu items
<MenuItem icon={<EditIcon className="w-4 h-4" />}>
  Edit
</MenuItem>
```

##### Badge Icons

Badge icons should be compact (12-14px):

```tsx
// Badge with icon - 12px
<Badge variant="success">
  <Icon name="check" className="w-3 h-3" />
  Approved
</Badge>

// Larger badge - 14px
<Badge size="lg" variant="info">
  <Icon name="building" className="w-3.5 h-3.5" />
  Tenant
</Badge>
```

##### Empty State Icons

Empty states use large icons (48px) for visual impact:

```tsx
// Empty state icon - 48px (w-12 h-12)
<div className="flex flex-col items-center justify-center p-12">
  <Icon name="inbox" className="w-12 h-12 text-text-tertiary mb-4" />
  <h3 className="text-lg font-semibold">No items found</h3>
  <p className="text-sm text-text-secondary">Get started by creating your first item</p>
</div>
```

##### Brand/Provider Icons

Brand logos in tables use 32px with circular backgrounds:

```tsx
// Provider icon with brand color background
<div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
  <OpenAIIcon className="w-5 h-5 text-green-600" />
</div>
```

#### Icon Alignment

Icons should be vertically centered with adjacent text:

```tsx
// ✅ Good: Icon centered with flexbox
<div className="flex items-center gap-2">
  <Icon className="w-4 h-4" />
  <span>Label text</span>
</div>

// ❌ Bad: Icon not aligned
<div>
  <Icon className="w-4 h-4" />
  <span>Label text</span>
</div>
```

#### Avoid Inline Pixel Sizing

Use Tailwind classes instead of inline styles for consistency:

```tsx
// ✅ Good: Tailwind classes
<Icon className="w-4 h-4" />

// ❌ Bad: Inline pixel sizing
<Icon style={{ width: 16, height: 16 }} />
```

**Exception**: Chakra UI components may use unit-based sizing (`'4'`, `'5'`), which is acceptable for Chakra components only.

**See Also:**
- [Button Hierarchy and Usage](#button-hierarchy-and-usage) for button size/icon pairings
- [Form Element Sizing Contexts](#form-element-sizing-contexts) for input icon sizing
- [Empty State Patterns](#empty-state-patterns) for empty state icon sizing (48px standard)
- [Badge and Pill Conventions](#badge-and-pill-conventions) for badge icon sizing

### Component State Patterns

All interactive components should implement consistent visual feedback across these states:

#### Interactive State Standards

| State | Visual Treatment | Transition | When to Apply |
|-------|-----------------|------------|---------------|
| **Default** | Base styling | N/A | Component at rest |
| **Hover** | Subtle background change, cursor pointer | 150ms ease | Mouse over interactive element |
| **Active/Pressed** | Darker background, slight scale | 100ms ease | Mouse down or touch |
| **Focus** | Oak primary ring (2px), ring-offset-2 | Instant | Keyboard navigation, programmatic focus |
| **Disabled** | Reduced opacity (0.5), cursor not-allowed | N/A | Non-interactive state |
| **Loading** | Spinner overlay, reduced opacity | Fade 200ms | Async operation in progress |

#### Button State Examples

```tsx
// Complete button state implementation
<Button
  variant="primary"
  className="
    /* Default */
    bg-oak-primary text-white

    /* Hover */
    hover:bg-oak-hover

    /* Active */
    active:bg-oak-dark active:scale-[0.98]

    /* Focus */
    focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 focus-visible:ring-offset-2

    /* Disabled */
    disabled:opacity-50 disabled:cursor-not-allowed

    /* Transition */
    transition-all duration-150 ease-in-out
  "
>
  Save
</Button>
```

#### Input State Examples

```tsx
// Complete input state implementation
<Input
  className="
    /* Default */
    border border-border-primary bg-bg-elevated

    /* Hover */
    hover:border-border-secondary

    /* Focus */
    focus:outline-none focus:ring-2 focus:ring-oak-primary/30 focus:ring-offset-2 focus:border-oak-primary

    /* Error */
    data-[error]:border-status-error data-[error]:focus:ring-status-error/30

    /* Disabled */
    disabled:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50

    /* Transition */
    transition-all duration-150 ease-in-out
  "
/>
```

#### Card State Examples

Cards can be interactive (clickable) or display-only:

```tsx
// Interactive card
<div className="
  card p-4

  /* Hover - only for interactive cards */
  hover:bg-bg-tertiary hover:border-border-secondary hover:shadow-elevation-2
  cursor-pointer

  /* Active */
  active:scale-[0.99]

  /* Transition */
  transition-all duration-150 ease-in-out
">
  Card content
</div>

// Display-only card (no hover states)
<div className="card p-4">
  Card content
</div>
```

**Rule**: Only add hover states to actually interactive elements. Display-only cards, stats cards, and informational components should not have hover effects.

#### Table Row State Examples

Table rows have distinct states for selection and interaction:

```tsx
// Table row with states
<tr className="
  /* Default */
  bg-bg-secondary border-b border-border-primary

  /* Hover - subtle */
  hover:bg-bg-tertiary

  /* Selected */
  data-[selected]:bg-oak-row-selected hover:data-[selected]:bg-oak-row-selected-hover

  /* Transition */
  transition-colors duration-150 ease-in-out
">
  <td>...</td>
</tr>

// Alternate row styling (zebra striping) - optional
<tr className="
  odd:bg-bg-secondary even:bg-oak-row-alt
  hover:bg-bg-tertiary
  ...
">
```

**Document Processing Table Pattern**: For complex tables with dense information (e.g., [/processing](../src/app/(dashboard)/processing/page.tsx)), use:
- Compact cell padding: `px-2 py-1.5`
- Subtle hover states to avoid overwhelming the dense layout
- Focus ring on interactive cells (filters, inputs)
- Clear selected row highlighting with oak-row-selected

#### Focus Ring Standards

Focus rings are critical for accessibility (keyboard navigation):

```tsx
// ✅ Good: Visible focus ring with offset
<button className="
  focus:outline-none
  focus-visible:ring-2
  focus-visible:ring-oak-primary/30
  focus-visible:ring-offset-2
">
  Click me
</button>

// ❌ Bad: No focus indicator
<button className="focus:outline-none">
  Click me
</button>
```

**Focus Ring Offset Rationale**:
- **React/Chakra Components**: Use `ring-offset-2` (8px offset). Chakra components have built-in padding that creates visual space, requiring larger offset for visibility.
- **CSS-Only Elements**: Use `ring-offset-1` (4px offset) in `globals.css`. Native HTML elements without framework padding need smaller offset to avoid excessive spacing.
- This intentional difference ensures consistent visual appearance across component types.

#### Loading State Patterns

Show loading feedback without blocking the UI:

```tsx
// Button loading
<Button isLoading={isSubmitting} loadingText="Saving...">
  Save
</Button>

// Card loading (skeleton)
<Card>
  {isLoading ? (
    <div className="space-y-3">
      <div className="h-4 bg-bg-tertiary rounded animate-pulse" />
      <div className="h-4 bg-bg-tertiary rounded animate-pulse w-3/4" />
    </div>
  ) : (
    <CardContent />
  )}
</Card>

// Table loading (overlay)
<div className="relative">
  <Table data={data} />
  {isLoading && (
    <div className="absolute inset-0 bg-bg-primary/50 flex items-center justify-center">
      <Spinner />
    </div>
  )}
</div>
```

#### Disabled vs Hidden

Choose the appropriate pattern for unavailable actions:

| Pattern | When to Use | Example |
|---------|-------------|---------|
| **Disabled** | Action will become available (with explanation) | "Submit" button disabled until form is valid |
| **Hidden** | Action is not applicable in current context | "Delete" action hidden for users without permission |

```tsx
// ✅ Good: Disabled with tooltip
<Tooltip label="Fill in all required fields first">
  <Button isDisabled={!formValid}>Submit</Button>
</Tooltip>

// ✅ Good: Hidden based on permission
{hasPermission('company:delete') && (
  <Button variant="danger">Delete</Button>
)}

// ❌ Bad: Disabled without explanation
<Button isDisabled>Submit</Button>
```

---

## Form Layout Patterns

Consistent patterns for different form contexts across the application.

### Form Layout Types

| Type | Layout | Spacing | Use Case | Example |
|------|--------|---------|----------|---------|
| **Full-Page Form** | Single column, sections with headers | `mb-6` between sections | Complex multi-section forms | Add Company, Edit Settings |
| **Modal Form** | Compact, minimal sections | `mb-4` between fields | Quick edits, simple creation | Add Contact, Edit Name |
| **Inline Form** | Horizontal or compact | `gap-2` between fields | Table row edit, search bars | Inline table edit |
| **Multi-Column Form** | 2-column grid | `gap-4` between columns | Wide forms with many fields | Advanced filters |

### Full-Page Form Pattern

Use for complex forms with multiple sections (Add Company, Edit Profile, Settings):

```tsx
<div className="max-w-3xl mx-auto p-6">
  {/* Page header */}
  <div className="mb-6">
    <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
      Add New Company
    </h1>
    <p className="text-sm text-text-secondary mt-1">
      Enter company information and registration details
    </p>
  </div>

  <form className="space-y-6">
    {/* Section 1: Basic Information */}
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-4">
        Basic Information
      </h2>
      <div className="space-y-4">
        <FormInput
          label="Company Name"
          placeholder="Acme Corporation"
          required
        />
        <FormInput
          label="Registration Number"
          placeholder="201234567K"
          required
        />
        <FormInput
          label="Industry"
          placeholder="Technology"
        />
      </div>
    </section>

    {/* Section 2: Contact Details */}
    <section>
      <h2 className="text-lg font-semibold text-text-primary mb-4">
        Contact Details
      </h2>
      <div className="space-y-4">
        <FormInput
          label="Email"
          type="email"
          placeholder="contact@acme.com"
          required
        />
        <FormInput
          label="Phone"
          type="tel"
          placeholder="+65 1234 5678"
        />
      </div>
    </section>

    {/* Form actions */}
    <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-primary">
      <Button variant="secondary" onClick={handleCancel}>
        Cancel
      </Button>
      <Button variant="primary" type="submit">
        Create Company
      </Button>
    </div>
  </form>
</div>
```

**Key Elements:**
- Page header with title and description: `mb-6`
- Section headers: `text-lg font-semibold mb-4`
- Fields within section: `space-y-4` (16px gap)
- Sections separated by: `space-y-6` (24px gap) on form
- Form actions: Border top, right-aligned buttons with `gap-3`

### Modal Form Pattern

Use for quick edits or simple creation forms within modals:

```tsx
<Modal isOpen={isOpen} onClose={onClose}>
  <ModalHeader>
    <h2 className="text-lg font-semibold">Add New Contact</h2>
  </ModalHeader>

  <ModalBody>
    <form className="space-y-4">
      <FormInput
        label="Full Name"
        placeholder="John Doe"
        required
      />
      <FormInput
        label="Email"
        type="email"
        placeholder="john@company.com"
        required
      />
      <FormInput
        label="Phone"
        type="tel"
        placeholder="+65 1234 5678"
      />
    </form>
  </ModalBody>

  <ModalFooter>
    <Button variant="secondary" onClick={onClose}>
      Cancel
    </Button>
    <Button variant="primary" onClick={handleSubmit}>
      Add Contact
    </Button>
  </ModalFooter>
</Modal>
```

**Key Elements:**
- No section headers (keep it simple)
- Fields: `space-y-4` (16px gap)
- Modal header: `text-lg font-semibold`
- Actions in ModalFooter (right-aligned by default)

### Multi-Column Form Pattern

Use for forms with many related fields that can be organized in columns:

```tsx
<form className="space-y-6">
  <section>
    <h2 className="text-lg font-semibold mb-4">Company Details</h2>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormInput label="Company Name" required />
      <FormInput label="Registration Number" required />
      <FormInput label="Industry" />
      <FormInput label="Website" type="url" />
      <FormInput label="Email" type="email" />
      <FormInput label="Phone" type="tel" />
    </div>
  </section>
</form>
```

**Key Elements:**
- Grid layout: `grid-cols-1 md:grid-cols-2` (single column on mobile, two columns on desktop)
- Field gaps: `gap-4` (16px between fields)
- Fields span full width of their grid cell

### Section Grouping Rules

**When to use sections:**
- Forms with 6+ fields → Group into logical sections
- Forms with diverse field types → Group by category (Basic Info, Contact, Address)
- Settings pages → Group by feature area (Account, Security, Notifications)

**When to skip sections:**
- Forms with 1-5 related fields → Use single form with no section headers
- Quick edit modals → No sections, just fields
- Search/filter forms → No sections needed

**Section Spacing:**
```tsx
// ✅ Good: Clear section separation with consistent spacing
<form className="space-y-6">
  <section>
    <h2 className="text-lg font-semibold mb-4">Section 1</h2>
    <div className="space-y-4">{/* Fields */}</div>
  </section>

  <section>
    <h2 className="text-lg font-semibold mb-4">Section 2</h2>
    <div className="space-y-4">{/* Fields */}</div>
  </section>
</form>

// ❌ Bad: Inconsistent spacing, too tight
<form className="space-y-3">
  <h2 className="text-base font-semibold mb-2">Section 1</h2>
  <div className="space-y-2">{/* Fields */}</div>

  <h2 className="text-base font-semibold mb-2 mt-5">Section 2</h2>
  <div className="space-y-2">{/* Fields */}</div>
</form>
```

### Form Validation States

Display validation errors clearly with consistent styling:

```tsx
// Field-level error
<FormInput
  label="Email"
  type="email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  error={errors.email}  // "Please enter a valid email address"
  required
/>

// Form-level error (at top of form)
{formError && (
  <Alert variant="error" className="mb-4">
    <Icon name="alert-circle" className="w-4 h-4" />
    {formError}
  </Alert>
)}

// Success message after submission
{showSuccess && (
  <Alert variant="success" className="mb-4">
    <Icon name="check-circle" className="w-4 h-4" />
    Company created successfully!
  </Alert>
)}
```

**Error Display Guidelines:**
- Field errors appear below the input in red text
- Form-level errors appear at the top of the form in an Alert
- Success messages use Alert variant="success"
- Validate on blur or on submit, not on every keystroke (reduces friction)

### Form Action Button Placement

| Context | Placement | Alignment | Spacing |
|---------|-----------|-----------|---------|
| **Full-Page Form** | Below form, border-top separator | Right-aligned | `gap-3` between buttons |
| **Modal Form** | ModalFooter component | Right-aligned | `gap-3` between buttons |
| **Inline Form** | Same row as fields | Left or right based on layout | `gap-2` for compact |

```tsx
// Full-page form actions
<div className="flex items-center justify-end gap-3 pt-4 border-t border-border-primary">
  <Button variant="secondary">Cancel</Button>
  <Button variant="primary" type="submit">Save</Button>
</div>

// Modal form actions (ModalFooter handles styling)
<ModalFooter>
  <Button variant="secondary" onClick={onClose}>Cancel</Button>
  <Button variant="primary" onClick={handleSave}>Save</Button>
</ModalFooter>

// Inline form actions (compact)
<div className="flex items-center gap-2">
  <FormInput size="sm" />
  <Button size="sm" variant="primary">Save</Button>
  <Button size="sm" variant="ghost">Cancel</Button>
</div>
```

**Button Order:** Always place primary action on the right (Save, Submit, Create), secondary/cancel on the left.

---

## Empty State Patterns

Consistent patterns for displaying empty states when no data is available.

### Shared Components

Use `ListEmptyState` from `@/components/ui/empty-state` for every list or table. It shows "No matching {noun}" with a Clear filters button when a search or filter is set, and "No {noun} yet" with your create action otherwise. `EmptyState` is the plain version (icon, title, description, actions) for anything else. Tables take the node through their `emptyState` prop, and `TableEmptyState` accepts it as `message`, so the message stays inside the table body under the column headers. The Clear filters handler must reset everything the page counts as a filter, including inline column filters and the search box.

```tsx
<CompanyTable
  emptyState={(
    <ListEmptyState
      icon={Building2}
      noun="companies"
      filtered={activeFilterChips.length > 0}
      onClearFilters={clearAllFilters}
      emptyDescription="Add a company or upload a BizFile to get started."
      createAction={<Link href="/companies/new" className="btn-primary btn-sm">Add Company</Link>}
    />
  )}
/>
```

The markup below describes the anatomy these components follow.

### Empty State Anatomy

All empty states should follow this structure:

1. **Icon** (48px, muted color)
2. **Heading** (text-lg font-semibold)
3. **Description** (text-sm, max-w-md)
4. **Action Button** (optional, only when user can add data)

### Standard Empty State

Use for lists, tables, and collections with no items:

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  {/* Icon */}
  <Icon name="briefcase" className="w-12 h-12 text-text-muted mb-4" />

  {/* Heading */}
  <h3 className="text-lg font-semibold text-text-primary mb-2">
    No companies found
  </h3>

  {/* Description */}
  <p className="text-sm text-text-secondary mb-4 max-w-md">
    Get started by adding your first company to begin managing your portfolio.
  </p>

  {/* Action button */}
  <Button size="md" variant="primary" onClick={handleAdd}>
    <Icon name="plus" className="w-4 h-4 mr-2" />
    Add Company
  </Button>
</div>
```

**Spacing:**
- Icon to heading: `mb-4` (16px)
- Heading to description: `mb-2` (8px)
- Description to action: `mb-4` (16px)
- Container padding: `py-12` (48px vertical)

### Empty State with Filters Applied

When a table/list is empty because of active filters, adjust the message:

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <Icon name="search" className="w-12 h-12 text-text-muted mb-4" />

  <h3 className="text-lg font-semibold text-text-primary mb-2">
    No results found
  </h3>

  <p className="text-sm text-text-secondary mb-4 max-w-md">
    Try adjusting your filters or search query to find what you're looking for.
  </p>

  {/* Action: Clear filters instead of add button */}
  <Button size="md" variant="secondary" onClick={handleClearFilters}>
    <Icon name="x" className="w-4 h-4 mr-2" />
    Clear Filters
  </Button>
</div>
```

**Key Differences:**
- Icon: Search icon instead of content-specific icon
- Message: "No results found" instead of "No {items} found"
- Action: "Clear Filters" instead of "Add" button

### Conditional Empty State

Dynamically choose between "add new" and "clear filters" messages:

```tsx
function EmptyState({ hasFilters, onAdd, onClearFilters }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon
        name={hasFilters ? 'search' : 'briefcase'}
        className="w-12 h-12 text-text-muted mb-4"
      />

      <h3 className="text-lg font-semibold text-text-primary mb-2">
        {hasFilters ? 'No results found' : 'No companies found'}
      </h3>

      <p className="text-sm text-text-secondary mb-4 max-w-md">
        {hasFilters
          ? 'Try adjusting your filters or search query.'
          : 'Get started by adding your first company.'}
      </p>

      {hasFilters ? (
        <Button size="md" variant="secondary" onClick={onClearFilters}>
          <Icon name="x" className="w-4 h-4 mr-2" />
          Clear Filters
        </Button>
      ) : (
        <Button size="md" variant="primary" onClick={onAdd}>
          <Icon name="plus" className="w-4 h-4 mr-2" />
          Add Company
        </Button>
      )}
    </div>
  );
}
```

### Empty State Variants

Different contexts may need different icon and message combinations:

| Context | Icon | Heading | Action |
|---------|------|---------|--------|
| **No Companies** | `briefcase` (w-12 h-12) | "No companies found" | "Add Company" (primary) |
| **No Contacts** | `users` (w-12 h-12) | "No contacts found" | "Add Contact" (primary) |
| **No Documents** | `file-text` (w-12 h-12) | "No documents found" | "Upload Document" (primary) |
| **No Services** | `package` (w-12 h-12) | "No services found" | "Add Service" (primary) |
| **Search Results** | `search` (w-12 h-12) | "No results found" | "Clear Filters" (secondary) |
| **Permission Denied** | `lock` (w-12 h-12) | "Access denied" | No action button |
| **Error State** | `alert-triangle` (w-12 h-12) | "Failed to load" | "Try Again" (secondary) |

### Icon Selection Guidelines

**Use semantic icons that match the content type:**
- Collections/lists: Use content-specific icons (briefcase, users, file-text)
- Search/filters: Use search icon
- Errors: Use alert-triangle or x-circle
- Permissions: Use lock or shield
- Empty state after action: Use check-circle with success message

**Icon Sizing:**
- Always use `w-12 h-12` (48px) for consistency
- Always use `text-text-muted` color for subtle appearance

### Empty State Loading Pattern

When initially loading, show skeleton instead of empty state:

```tsx
{isLoading ? (
  <div className="space-y-2">
    <div className="skeleton h-12 w-full" />
    <div className="skeleton h-12 w-full" />
    <div className="skeleton h-12 w-full" />
  </div>
) : items.length === 0 ? (
  <EmptyState hasFilters={hasFilters} onAdd={handleAdd} onClearFilters={handleClearFilters} />
) : (
  <DataTable items={items} />
)}
```

**Loading Sequence:**
1. Initial load → Skeleton/loading state
2. Data loaded, no items → Empty state
3. Data loaded, has items → Display data

### Compact Empty State (for Cards)

For empty states within cards or smaller containers, use a more compact version:

```tsx
<Card className="p-6">
  <div className="flex flex-col items-center justify-center text-center">
    <Icon name="calendar" className="w-8 h-8 text-text-muted mb-3" />
    <p className="text-sm text-text-secondary mb-3">
      No upcoming events
    </p>
    <Button size="sm" variant="ghost" onClick={handleAdd}>
      <Icon name="plus" className="w-3.5 h-3.5 mr-2" />
      Add Event
    </Button>
  </div>
</Card>
```

**Differences from Standard:**
- Smaller icon: `w-8 h-8` (32px) instead of 48px
- No heading, just description
- Smaller button: `size="sm"`
- Less vertical padding: `py-6` or based on card padding

### Inline Empty State (for Sections)

For empty sections within a page (not full-page empty state):

```tsx
<section className="mb-6">
  <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>

  <Card className="p-8">
    <div className="flex flex-col items-center justify-center text-center">
      <Icon name="activity" className="w-10 h-10 text-text-muted mb-3" />
      <p className="text-sm text-text-secondary">
        No recent activity to display
      </p>
    </div>
  </Card>
</section>
```

**Key Points:**
- Medium icon: `w-10 h-10` (40px)
- Single line description, no heading
- No action button (not always needed for secondary sections)

---

## Alert and Banner Hierarchy

Consistent patterns for displaying alerts, banners, and notifications across the application.

### Alert Types and Usage

| Type | Color | Icon | Use Case | Example |
|------|-------|------|----------|---------|
| **Success** | Green | `check-circle` | Successful actions, confirmations | "Company created successfully" |
| **Warning** | Yellow | `alert-triangle` | Caution, attention needed | "Please select a tenant before continuing" |
| **Error** | Red | `x-circle` or `alert-circle` | Errors, failures, blocked actions | "Failed to save. Please try again" |
| **Info** | Blue | `info` | Informational messages, tips | "This action requires admin permission" |

### Standard Alert Pattern

Use the `<Alert>` component for inline messages:

```tsx
// Success alert
<Alert variant="success">
  <Icon name="check-circle" className="w-4 h-4" />
  <span>Company created successfully!</span>
</Alert>

// Warning alert
<Alert variant="warning">
  <Icon name="alert-triangle" className="w-4 h-4" />
  <span>Please select a tenant before continuing</span>
</Alert>

// Error alert
<Alert variant="error">
  <Icon name="x-circle" className="w-4 h-4" />
  <span>Failed to save changes. Please try again.</span>
</Alert>

// Info alert
<Alert variant="info">
  <Icon name="info" className="w-4 h-4" />
  <span>This action cannot be undone</span>
</Alert>
```

**Standard Alert Styling:**
- Padding: `p-3` (12px) for compact but readable
- Icon size: `w-4 h-4` (16px)
- Text: `text-sm` (13px)
- Border radius: `rounded-md`
- Background: Tinted with variant color (light green, yellow, red, blue)

### Complex Alert with Heading

For alerts with more content, add a heading and multi-line description:

```tsx
<Alert variant="warning" className="p-4">
  <div className="flex items-start gap-3">
    <Icon name="alert-triangle" className="w-5 h-5 flex-shrink-0 mt-0.5" />
    <div>
      <h4 className="font-semibold text-sm mb-1">
        Permanent Deletion Warning
      </h4>
      <p className="text-sm text-text-secondary leading-relaxed">
        Items in the recycle bin will be permanently deleted after 30 days.
        This action cannot be undone. Please ensure you have backups of any
        important data.
      </p>
    </div>
  </div>
</Alert>
```

**Complex Alert Characteristics:**
- Larger padding: `p-4` (16px) for multi-line content
- Larger icon: `w-5 h-5` (20px)
- Icon positioned at top with `mt-0.5` for alignment
- Heading: `font-semibold text-sm mb-1`
- Description: `text-sm text-text-secondary leading-relaxed`

### Banner Pattern (Full-Width)

For page-level messages that need prominence, use full-width banners:

```tsx
{/* Error banner - tenant context required */}
<div className="bg-error/10 border-l-4 border-error p-4 mb-6">
  <div className="flex items-center gap-3">
    <Icon name="x-circle" className="w-5 h-5 text-error flex-shrink-0" />
    <div>
      <p className="text-sm font-medium text-error">
        Tenant context required
      </p>
      <p className="text-sm text-text-secondary mt-1">
        Please select a tenant from the sidebar to continue.
      </p>
    </div>
  </div>
</div>

{/* Warning banner - tenant selection */}
<div className="bg-warning/10 border-l-4 border-warning p-4 mb-6">
  <div className="flex items-center gap-3">
    <Icon name="alert-triangle" className="w-5 h-5 text-warning flex-shrink-0" />
    <p className="text-sm font-medium text-warning">
      Please select a tenant to view templates
    </p>
  </div>
</div>
```

**Banner Styling:**
- Background: Variant color at 10% opacity (`bg-error/10`)
- Border: Left border 4px with variant color (`border-l-4 border-error`)
- Padding: `p-4` (16px)
- Margin: `mb-6` (24px) to separate from content below
- Icon: Colored with variant color (`text-error`, `text-warning`)

### Alert Placement Guidelines

| Context | Placement | Example |
|---------|-----------|---------|
| **Form Validation Error** | Top of form, above all fields | "Please fix the errors below" |
| **Page-Level Message** | Below page header, above content | "Tenant context required" |
| **Section Message** | Top of section/card | "No data available for this period" |
| **Inline Field Error** | Below field with error styling | Field-specific error via FormInput `error` prop |
| **Toast Notification** | Top-right corner, auto-dismiss | "Saved successfully" (temporary) |

### Alert with Actions

Add action buttons to alerts when user can take immediate action:

```tsx
<Alert variant="warning" className="p-4">
  <div className="flex items-start justify-between gap-4">
    <div className="flex items-start gap-3">
      <Icon name="alert-triangle" className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium mb-1">
          Your session will expire soon
        </p>
        <p className="text-sm text-text-secondary">
          Click "Continue" to stay logged in.
        </p>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={handleLogout}>
        Logout
      </Button>
      <Button size="sm" variant="primary" onClick={handleExtendSession}>
        Continue
      </Button>
    </div>
  </div>
</Alert>
```

**Action Button Guidelines:**
- Use `size="sm"` for buttons in alerts
- Place buttons on the right side
- Primary action on the right, secondary on the left
- Use `gap-2` between buttons

### Dismissible Alerts

Allow users to dismiss alerts that don't require action:

```tsx
<Alert variant="info" className="p-3">
  <div className="flex items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <Icon name="info" className="w-4 h-4" />
      <span className="text-sm">You have 3 pending invitations</span>
    </div>
    <button
      onClick={handleDismiss}
      className="p-1 rounded hover:bg-bg-tertiary transition-colors"
      aria-label="Dismiss"
    >
      <Icon name="x" className="w-4 h-4 text-text-secondary" />
    </button>
  </div>
</Alert>
```

**Dismissible Alert Elements:**
- Close button: `p-1 rounded` with hover state
- Close icon: `w-4 h-4` (16px)
- Button positioned on right with `justify-between`

### Toast Notifications

For temporary success/error messages, use toast notifications (auto-dismiss):

```tsx
import { toast } from '@/components/ui/toast';

// Success toast
toast.success('Company created successfully');

// Error toast
toast.error('Failed to save changes');

// Warning toast
toast.warning('Changes not saved');

// Info toast
toast.info('New updates available');
```

**Toast Characteristics:**
- Position: Top-right corner of viewport
- Auto-dismiss: 3-5 seconds (success/info), 7 seconds (error/warning)
- Animation: Slide in from right, fade out
- Max width: `max-w-sm` (384px)
- Use for: Feedback after actions (save, delete, create)

### Alert Hierarchy Guidelines

**Use Error Alerts when:**
- Action failed and user needs to retry
- Required field validation failed
- Permission denied
- Server error occurred

**Use Warning Alerts when:**
- Action has consequences user should know about
- Missing context (e.g., "select a tenant")
- Data might be lost
- Action is irreversible

**Use Success Alerts when:**
- Action completed successfully
- Data saved
- Item created/updated/deleted
- Process completed

**Use Info Alerts when:**
- Providing contextual information
- Explaining feature or limitation
- Showing tips or recommendations
- Displaying status updates

### Alert vs Toast Decision

| Use Alert | Use Toast |
|-----------|-----------|
| Message requires user action | Message is informational only |
| Error blocks workflow | Success confirmation |
| Warning about consequences | Quick feedback after action |
| Persistent until dismissed/resolved | Auto-dismiss after 3-5 seconds |
| Part of page content | Temporary overlay |

**Example Decision Flow:**
- Form validation error → Alert (persistent, blocks submit)
- Company created → Toast (temporary, confirms action)
- Missing permissions → Alert (persistent, blocks access)
- Settings saved → Toast (temporary, confirms save)

---

## Filter Action Patterns

Consistent patterns for filter buttons, quick actions, and view controls in data tables and lists.

### Filter Button Groups

Use filter button groups for quick filtering of table data:

```tsx
<div className="flex items-center gap-2 mb-4">
  <Button
    size="sm"
    variant={filter === 'today' ? 'default' : 'ghost'}
    onClick={() => setFilter('today')}
  >
    <Icon name="calendar" className="w-4 h-4 mr-2" />
    Today
  </Button>

  <Button
    size="sm"
    variant={filter === 'review' ? 'default' : 'ghost'}
    onClick={() => setFilter('review')}
  >
    <Icon name="eye" className="w-4 h-4 mr-2" />
    Review
  </Button>

  <Button
    size="sm"
    variant={filter === 'duplicates' ? 'default' : 'ghost'}
    onClick={() => setFilter('duplicates')}
  >
    <Icon name="copy" className="w-4 h-4 mr-2" />
    Duplicates
  </Button>
</div>
```

**Filter Button Characteristics:**
- Size: `size="sm"` for compact appearance
- Variant: `default` when active, `ghost` when inactive
- Icon: `w-4 h-4` (16px) with `mr-2` spacing
- Spacing: `gap-2` between buttons
- Placement: Above table, below page header

#### Reference Implementation: ProcessingToolbar

The document processing page has the reference implementation of quick filter buttons:

**File**: `src/components/processing/processing-toolbar.tsx`

```tsx
// Toggle filter - clicking an active filter clears it
const toggleQuickFilter = (key: 'needsReview' | 'uploadDatePreset' | 'duplicateStatus', value: boolean | 'TODAY' | DuplicateStatus) => {
  const currentValue = quickFilters[key];
  onQuickFilterChange({
    [key]: currentValue === value ? undefined : value,
  });
};

// Quick Filter Buttons with CSS classes
<div className="flex items-center gap-2">
  <button
    onClick={() => toggleQuickFilter('uploadDatePreset', 'TODAY')}
    className={`btn-sm flex items-center gap-1.5 ${
      quickFilters.uploadDatePreset === 'TODAY'
        ? 'bg-oak-primary text-white'
        : 'btn-ghost'
    }`}
    title="Uploaded today"
  >
    <Calendar className="w-4 h-4" />
    <span className="hidden lg:inline">Today</span>
  </button>

  <button
    onClick={() => toggleQuickFilter('needsReview', true)}
    className={`btn-sm flex items-center gap-1.5 ${
      quickFilters.needsReview
        ? 'bg-oak-primary text-white'
        : 'btn-ghost'
    }`}
    title="Needs review"
  >
    <Eye className="w-4 h-4" />
    <span className="hidden lg:inline">Review</span>
  </button>

  <button
    onClick={() => toggleQuickFilter('duplicateStatus', 'SUSPECTED')}
    className={`btn-sm flex items-center gap-1.5 ${
      quickFilters.duplicateStatus === 'SUSPECTED'
        ? 'bg-oak-primary text-white'
        : 'btn-ghost'
    }`}
    title="Show duplicates"
  >
    <Copy className="w-4 h-4" />
    <span className="hidden lg:inline">Duplicates</span>
  </button>
</div>
```

**Key Implementation Details:**
- **Toggle behavior**: Clicking an active filter clears it (toggles off)
- **Active state**: `bg-oak-primary text-white` (uses brand color)
- **Inactive state**: `btn-ghost` class (transparent background)
- **Responsive labels**: `<span className="hidden lg:inline">` hides text on smaller screens
- **Icon spacing**: `gap-1.5` between icon and text
- **Accessibility**: `title` attribute provides tooltip for icon-only state

**When to Create a Reusable Component:**
The ProcessingToolbar is tightly coupled to the document processing page. If you need similar quick filter buttons on another page, consider extracting a `<QuickFilterButton>` component:

```tsx
interface QuickFilterButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}

function QuickFilterButton({ icon, label, active, onClick, title }: QuickFilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`btn-sm flex items-center gap-1.5 ${
        active ? 'bg-oak-primary text-white' : 'btn-ghost'
      }`}
      title={title || label}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
```

### Filter Buttons with Count Badges

Show item counts in filter buttons for better context:

```tsx
<Button
  size="sm"
  variant={showDuplicates ? 'default' : 'ghost'}
  onClick={() => setShowDuplicates(!showDuplicates)}
>
  <Icon name="copy" className="w-4 h-4 mr-2" />
  Duplicates
  {duplicateCount > 0 && (
    <Badge size="sm" variant="default" className="ml-2">
      {duplicateCount}
    </Badge>
  )}
</Button>
```

**Count Badge Guidelines:**
- Size: `size="sm"` to match button size
- Placement: After button text with `ml-2`
- Only show when count > 0
- Use neutral badge color (`variant="default"`)

### Column Visibility Toggle

Allow users to show/hide table columns:

```tsx
<Button
  size="sm"
  variant="ghost"
  onClick={openColumnSelector}
>
  <Icon name="columns" className="w-4 h-4 mr-2" />
  Columns
  <Badge size="sm" variant="default" className="ml-2">
    {visibleColumnCount}
  </Badge>
</Button>
```

**Column Toggle Pattern:**
- Shows count of visible columns
- Opens modal or dropdown with column checkboxes
- Persists selection to local storage
- Default: All columns visible

### View Mode Toggle (List/Grid)

Toggle between different view modes:

```tsx
<div className="flex items-center gap-1 p-1 bg-bg-secondary rounded">
  <Button
    size="xs"
    variant={viewMode === 'list' ? 'default' : 'ghost'}
    onClick={() => setViewMode('list')}
    className="px-2"
  >
    <Icon name="list" className="w-4 h-4" />
  </Button>
  <Button
    size="xs"
    variant={viewMode === 'grid' ? 'default' : 'ghost'}
    onClick={() => setViewMode('grid')}
    className="px-2"
  >
    <Icon name="grid" className="w-4 h-4" />
  </Button>
</div>
```

**View Toggle Styling:**
- Contained in rounded background (`bg-bg-secondary rounded`)
- Icon-only buttons with minimal padding
- Active button uses `variant="default"`
- Tight spacing: `gap-1` between buttons

### Quick Action Buttons with Keyboard Shortcuts

Display keyboard shortcuts for frequently used actions:

```tsx
<div className="flex items-center gap-2 mb-4">
  <Button
    size="sm"
    variant="ghost"
    onClick={handleRefresh}
  >
    <Icon name="refresh" className="w-4 h-4 mr-2" />
    Refresh (Ctrl+R)
  </Button>

  <Button
    size="sm"
    variant="ghost"
    onClick={handleUpload}
  >
    <Icon name="upload" className="w-4 h-4 mr-2" />
    Upload (F1)
  </Button>

  <Button
    size="sm"
    variant="primary"
    onClick={handleAdd}
  >
    <Icon name="plus" className="w-4 h-4 mr-2" />
    Add New (F2)
  </Button>
</div>

// Implement keyboard listener
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only trigger if not in input field
    if (document.activeElement?.tagName === 'INPUT') return;

    if (e.key === 'r') handleRefresh();
    if (e.key === 'F1') handleUpload();
    if (e.key === 'F2') handleAdd();
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

**Keyboard Shortcut Guidelines:**
- Show shortcuts in button text: `Action (Key)`
- Use single letters for non-destructive global actions (R, E)
- Use function keys for primary/secondary actions (F1, F2, F3)
- Don't trigger when input fields are focused
- Use uppercase in display, lowercase in listener
- Keep mappings aligned with [Keyboard Shortcuts](./KEYBOARD_SHORTCUTS.md)

### Filter Pill Groups (see Reusable Components)

For multi-select category filters, use the FilterPillGroup component documented in [Reusable Components → FilterPillGroup](#filter-components).

### Combined Filter Bar Pattern

Complete example of a filter bar with multiple controls:

```tsx
<div className="flex items-center justify-between mb-4">
  {/* Left: Quick filters */}
  <div className="flex items-center gap-2">
    <Button size="sm" variant={filter === 'today' ? 'default' : 'ghost'} onClick={() => setFilter('today')}>
      Today
    </Button>
    <Button size="sm" variant={filter === 'week' ? 'default' : 'ghost'} onClick={() => setFilter('week')}>
      This Week
    </Button>
    <Button size="sm" variant={filter === 'all' ? 'default' : 'ghost'} onClick={() => setFilter('all')}>
      All
    </Button>
  </div>

  {/* Right: Actions and view controls */}
  <div className="flex items-center gap-2">
    <Button size="sm" variant="ghost" onClick={openColumnSelector}>
      <Icon name="columns" className="w-4 h-4 mr-2" />
      Columns
    </Button>

    <Button size="sm" variant="ghost" onClick={handleRefresh}>
      <Icon name="refresh" className="w-4 h-4 mr-2" />
      Refresh (Ctrl+R)
    </Button>

    <Button size="sm" variant="primary" onClick={handleAdd}>
      <Icon name="plus" className="w-4 h-4 mr-2" />
      Add New
    </Button>
  </div>
</div>
```

**Filter Bar Layout:**
- Quick filters on the left
- Actions and controls on the right
- Use `justify-between` to separate groups
- All buttons use `size="sm"` for consistency

---

## CSS Classes Reference

### Buttons

```css
/* Variants (combine with size) */
.btn-primary    /* Oak green, white text */
.btn-secondary  /* Dark bg, border, white text */
.btn-ghost      /* Transparent, text only */
.btn-danger     /* Red tint for destructive */

/* Sizes */
.btn-xs / .btn-sm / .btn-md / .btn-lg

/* Modifiers */
.btn-icon       /* Square icon-only button */
```

### Inputs

```css
.input          /* Base input styles */
.input-xs / .input-sm / .input-md / .input-lg
.input-error    /* Red border for errors */
```

### Labels

```css
.label          /* Form labels (12px, medium) */
.label-sm       /* Small labels (10px) */
```

### Cards

```css
.card           /* bg-secondary, subtle border */
.card-elevated  /* bg-elevated, shadow */
```

### Badges

```css
.badge          /* Base (10px, pill-shaped) */
.badge-success  /* Green - active, linked */
.badge-warning  /* Yellow - pending, caution */
.badge-error    /* Red - error, failed */
.badge-info     /* Blue - informational */
.badge-neutral  /* Gray - inactive, default */
```

#### Badge and Pill Conventions

Use badges consistently to communicate status, type, and metadata:

##### Badge vs Pill vs Chip

| Component | Size | Shape | Use Case | Example |
|-----------|------|-------|----------|---------|
| **Badge** | Small (10-12px text) | Pill-shaped, compact | Status indicators, counts | "Active", "3", "Live" |
| **Pill** | Medium (12-13px text) | Rounded rectangle, more padding | Tags, categories, types | "Individual", "Corporate" |
| **Chip** | Medium with icon | Rounded, dismissible | Filters, selections | "Category: Finance ×" |

##### Status Badge Patterns

Status badges communicate the current state:

```tsx
// Status badges - Use semantic colors
<Badge variant="success">Active</Badge>       // Green - positive state
<Badge variant="success">Live</Badge>         // Green - operational
<Badge variant="warning">Pending</Badge>      // Yellow - needs attention
<Badge variant="warning">Review</Badge>       // Yellow - action required
<Badge variant="error">Failed</Badge>         // Red - error state
<Badge variant="error">Rejected</Badge>       // Red - negative outcome
<Badge variant="info">Draft</Badge>           // Blue - informational
```

##### Type Indicator Badges

Type badges categorize entities (neutral colors):

```tsx
// Type badges - Use neutral/muted colors
<Badge variant="neutral">Individual</Badge>
<Badge variant="neutral">Corporate</Badge>
<Badge variant="neutral">Partnership</Badge>
```

##### Scope Badges

Scope badges indicate the level or context (use info with icon):

```tsx
// Scope badges - Blue with descriptive icon
<Badge variant="info">
  <Icon name="building" className="w-3 h-3" />
  Tenant
</Badge>

<Badge variant="info">
  <Icon name="globe" className="w-3 h-3" />
  Global
</Badge>
```

##### Pipeline/Workflow Badges

Pipeline badges show progress in a workflow (use success with icon):

```tsx
// Pipeline badges - Green with checkmark/status icon
<Badge variant="success">
  <Icon name="check" className="w-3 h-3" />
  Extracted
</Badge>

<Badge variant="success">
  <Icon name="check-circle" className="w-3 h-3" />
  Approved
</Badge>

<Badge variant="warning">
  <Icon name="clock" className="w-3 h-3" />
  Processing
</Badge>
```

##### Badge Sizing

Match badge size to context:

```tsx
// Small badges (10px text) - Compact contexts like table cells
<Badge size="sm">Active</Badge>

// Default badges (12px text) - Standard usage
<Badge>Active</Badge>

// Large badges (13px text) - Prominent display
<Badge size="lg">Active</Badge>
```

##### Multiple Badges in Context

When displaying multiple badge types together:

**Good Practice**:
- Group similar badge types together
- Use consistent spacing (gap-2)
- Don't overload with too many badges
- Prioritize most important information

```tsx
// ✅ Good: Organized badge groups
<div className="flex items-center gap-3">
  {/* Status badges group */}
  <div className="flex gap-2">
    <Badge variant="success">Enabled</Badge>
    <Badge variant="success"><Icon name="check" />OK</Badge>
  </div>

  {/* Type badge */}
  <Badge variant="neutral">Tenant</Badge>
</div>

// ❌ Bad: Too many badges, unclear hierarchy
<div className="flex gap-1">
  <Badge>Active</Badge>
  <Badge>Live</Badge>
  <Badge>OK</Badge>
  <Badge>Verified</Badge>
  <Badge>Premium</Badge>
</div>
```

##### Badge Density in Tables

For data-heavy tables (e.g., document processing), use compact badges with icons:

```tsx
// Dense table cell with multiple status indicators
<TableCell>
  <div className="flex items-center gap-2">
    <Badge size="sm" variant="success">
      <Icon name="check" className="w-3 h-3" />
      Extracted
    </Badge>
    <Badge size="sm" variant="info">
      <Icon name="shield-check" className="w-3 h-3" />
      None
    </Badge>
  </div>
</TableCell>
```

**Guidelines**:
- Use `size="sm"` in dense tables
- Include icons only when they add meaning
- Limit to 2-3 badges per cell
- Use muted colors to reduce visual noise

##### Badge Icon Placement

Icons in badges should be consistently positioned:

```tsx
// ✅ Good: Icon before text (left)
<Badge variant="success">
  <Icon name="check" />
  Approved
</Badge>

// ✅ Good: Icon only (no text)
<Badge variant="info">
  <Icon name="building" />
</Badge>

// ❌ Bad: Inconsistent icon placement
<Badge>Approved<Icon name="check" /></Badge>
```

##### Count Badges

Count badges show numerical values:

```tsx
// Count badges on buttons (filter counts, notifications)
<Button variant="ghost">
  Today
  <Badge variant="info" className="ml-2">5</Badge>
</Button>

// Count badges in tabs
<Tab>
  All Documents
  <Badge variant="neutral" className="ml-2">127</Badge>
</Tab>
```

**Rule**: Count badges should always use neutral or info variants unless the count indicates a specific status.

### Toggle Switch

Use toggle switches for binary on/off settings. Prefer toggle switches over checkboxes for:
- Feature enable/disable settings
- Active/inactive status toggles
- Boolean preferences with descriptive labels

**When to use Toggle Switch vs Checkbox:**

| Use Toggle Switch | Use Checkbox |
|-------------------|--------------|
| Enable/disable a feature | Multi-select in tables |
| Active/inactive status | Boolean form fields |
| Settings with clear on/off state | Inline filter toggles |
| Has descriptive subtitle | Simple yes/no without description |

**Standard Toggle Switch Pattern:**

```tsx
// Full toggle switch with card container, title, and description
<div className="flex items-center justify-between p-3 rounded-lg border border-border-primary bg-bg-tertiary">
  <div className="flex flex-col">
    <span className="text-sm font-medium text-text-primary">Setting Name</span>
    <span className="text-xs text-text-muted">
      {isEnabled ? 'Description when enabled' : 'Description when disabled'}
    </span>
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={isEnabled}
    onClick={() => setIsEnabled(!isEnabled)}
    className={cn(
      'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-oak-primary focus:ring-offset-2',
      isEnabled ? 'bg-oak-primary border-oak-primary' : 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
    )}
  >
    <span
      className={cn(
        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out',
        isEnabled ? 'translate-x-5' : 'translate-x-0'
      )}
    />
  </button>
</div>
```

**Compact Toggle Switch (inline):**

```tsx
// Inline toggle without card container
<label className="flex items-center gap-3 cursor-pointer">
  <button
    type="button"
    role="switch"
    aria-checked={isEnabled}
    onClick={() => setIsEnabled(!isEnabled)}
    className={cn(
      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-oak-primary focus:ring-offset-2',
      isEnabled ? 'bg-oak-primary border-oak-primary' : 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
    )}
  >
    <span
      className={cn(
        'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out',
        isEnabled ? 'translate-x-4' : 'translate-x-0'
      )}
    />
  </button>
  <span className="text-sm text-text-primary">Setting label</span>
</label>
```

**Key Features:**
- iOS-style sliding toggle animation
- Oak primary (`bg-oak-primary` / `#294d44`) when enabled
- Gray (`bg-gray-300` light / `bg-gray-600` dark) when disabled
- White knob with shadow (`shadow-md`) for visibility
- Proper accessibility with `role="switch"` and `aria-checked`
- Focus ring for keyboard navigation
- Smooth 200ms transition

### Tables

```css
.table-container  /* Scrollable wrapper with border and rounded corners */
.table            /* Full table styles */
.table th         /* Header: px-4 py-2.5, uppercase, xs font, text-text-secondary */
.table td         /* Cell: px-4 py-3, sm font, text-text-primary */
.table-compact    /* Compact: px-3 py-2 for both th and td */
.table-dense      /* Dense: px-2 py-1.5 for very tight layouts */
```

#### Table Padding Tiers

| Tier | Header Padding | Cell Padding | Use Case |
|------|----------------|--------------|----------|
| **Default** | `px-4 py-2.5` | `px-4 py-3` | Standard data tables (companies, contacts, documents) |
| **Compact** | `px-3 py-2` | `px-3 py-2` | Dense data (audit logs, processing tables) |
| **Dense** | `px-2 py-1.5` | `px-2 py-1.5` | Very tight layouts, embedded tables |

```tsx
// Default table - comfortable padding
<div className="table-container">
  <table className="table">...</table>
</div>

// Compact table for dense data
<div className="table-container">
  <table className="table table-compact">...</table>
</div>

// Dense table for embedded/nested tables
<div className="table-container">
  <table className="table table-dense">...</table>
</div>
```

#### Sortable Table Headers

All data tables should have sortable column headers (desktop only). Use the `SortableHeader` pattern:

```tsx
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

interface SortableHeaderProps {
  label: string;
  field: string;
  currentSortBy?: string;
  currentSortOrder?: 'asc' | 'desc';
  onSort: (field: string) => void;
}

function SortableHeader({ label, field, currentSortBy, currentSortOrder, onSort }: SortableHeaderProps) {
  const isActive = currentSortBy === field;
  return (
    <th
      onClick={() => onSort(field)}
      className="cursor-pointer hover:bg-bg-tertiary transition-colors select-none"
    >
      <div className="flex items-center gap-1.5">
        <span>{label}</span>
        {isActive ? (
          currentSortOrder === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5 text-oak-light" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-oak-light" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100" />
        )}
      </div>
    </th>
  );
}
```

**Sort Behavior:**
- First click: Sort ascending
- Second click: Sort descending
- Visual indicator shows current sort state (ArrowUp/ArrowDown when active)
- Inactive columns show ArrowUpDown on hover
- URL params updated for shareability where applicable
- Desktop only - mobile card views don't show column sorting

**Usage in Tables:**
```tsx
<thead>
  <tr>
    {selectable && <th className="w-10">...</th>}
    <SortableHeader label="Name" field="name" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={onSort} />
    <SortableHeader label="Status" field="status" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={onSort} />
    <SortableHeader label="Created" field="createdAt" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={onSort} />
    <th>Actions</th> {/* Non-sortable */}
  </tr>
</thead>
```

**Page-level Handler:**
```tsx
const handleSort = (field: string) => {
  setParams((prev) => {
    if (prev.sortBy === field) {
      return { ...prev, sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' };
    }
    return { ...prev, sortBy: field, sortOrder: 'asc' };
  });
};
```

#### Table Selection Pattern

For tables with bulk selection, place the "select all" checkbox in the **table header (`<th>`)**, not above the table.

```tsx
import { Checkbox } from '@/components/ui/checkbox';

// Compute selection states
const isAllSelected = items.length > 0 && selectedIds.size === items.length;
const isIndeterminate = selectedIds.size > 0 && selectedIds.size < items.length;

<table className="table">
  <thead>
    <tr>
      <th className="w-10">
        <Checkbox
          size="sm"
          checked={isAllSelected}
          indeterminate={isIndeterminate}
          onChange={toggleSelectAll}
          aria-label="Select all"
        />
      </th>
      <th>Name</th>
      {/* ... */}
    </tr>
  </thead>
  <tbody>
    {items.map((item) => (
      <tr key={item.id} className={selectedIds.has(item.id) ? 'bg-oak-row-selected' : ''}>
        <td>
          <Checkbox
            size="sm"
            checked={selectedIds.has(item.id)}
            onChange={() => toggleSelection(item.id)}
            aria-label={`Select ${item.name}`}
          />
        </td>
        {/* ... */}
      </tr>
    ))}
  </tbody>
</table>
```

**Key points:**
- Use `size="sm"` for table checkboxes
- Support `indeterminate` state for partial selection
- Highlight selected rows with `bg-oak-row-selected` (deeper green than alternate rows)
- Show bulk action buttons conditionally when items are selected

### Floating Bulk Actions Toolbar

When items are selected via checkboxes in a table, display a **floating action bar** at the bottom of the screen. This provides a consistent, prominent way to perform bulk operations across all list views.

**Key Features:**
- Fixed position at bottom center of the viewport
- Slides in with animation when items are selected
- Shows selection count with clear button
- Action buttons with icons and labels
- Color-coded actions (default, warning, danger)
- Confirmation dialogs for destructive actions

**Standard Pattern:**

```tsx
import { X, Download, CheckCircle, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BulkActionsToolbarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  className?: string;
}

// Define operations with configuration
const operations = [
  { id: 'DOWNLOAD', label: 'Download', icon: Download, variant: 'default', requiresConfirmation: false },
  { id: 'APPROVE', label: 'Approve', icon: CheckCircle, variant: 'default', requiresConfirmation: true },
  { id: 'DELETE', label: 'Delete', icon: Trash2, variant: 'danger', requiresConfirmation: true },
];

function BulkActionsToolbar({ selectedIds, onClearSelection, className }: BulkActionsToolbarProps) {
  if (selectedIds.length === 0) return null;

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-40',
        'bg-background-primary border border-border-primary rounded-lg shadow-xl',
        'flex items-center gap-2 px-4 py-3',
        'animate-in slide-in-from-bottom-4',
        className
      )}
    >
      {/* Selection count */}
      <div className="flex items-center gap-2 pr-3 border-r border-border-primary">
        <span className="text-sm text-text-secondary">
          <span className="font-medium text-text-primary">{selectedIds.length}</span> selected
        </span>
        <button
          onClick={onClearSelection}
          className="btn-ghost btn-xs p-1"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        {operations.map((op) => {
          const Icon = op.icon;
          return (
            <button
              key={op.id}
              onClick={() => handleOperation(op.id)}
              className={cn(
                'btn-sm flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors',
                op.variant === 'danger'
                  ? 'hover:bg-status-error/10 hover:text-status-error text-text-secondary'
                  : op.variant === 'warning'
                  ? 'hover:bg-status-warning/10 hover:text-status-warning text-text-secondary'
                  : 'hover:bg-oak-light/10 hover:text-oak-primary text-text-secondary'
              )}
              title={op.description}
            >
              <Icon className="w-4 h-4" />
              <span className="text-sm">{op.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

**Usage in Pages:**

```tsx
// State management
const [selectedIds, setSelectedIds] = useState<string[]>([]);

const clearSelection = useCallback(() => {
  setSelectedIds([]);
}, []);

// Clear selection when filters/page changes
useEffect(() => {
  setSelectedIds([]);
}, [params]);

// Render at the bottom of the page (outside any scrollable container)
return (
  <div className="p-4 sm:p-6">
    {/* ... table with checkboxes ... */}

    {/* Floating bulk actions - always at root level */}
    <BulkActionsToolbar
      selectedIds={selectedIds}
      onClearSelection={clearSelection}
    />
  </div>
);
```

**When to Use:**
| Use Floating Toolbar | Use Inline Actions |
|---------------------|-------------------|
| Multiple bulk actions available | Single action only |
| Actions require prominent visibility | Actions are secondary |
| Table has pagination | Short, non-paginated lists |
| User may scroll while selecting | Content fits on screen |

**Styling Guidelines:**
- Background: `bg-background-primary` with `border-border-primary`
- Shadow: `shadow-xl` for elevation
- Animation: `animate-in slide-in-from-bottom-4`
- Z-index: `z-40` (above content, below modals)
- Position: `fixed bottom-6 left-1/2 -translate-x-1/2`

#### Table Design Patterns

##### Canonical Reusable Table System

All application data tables should use the shared table system in `src/components/ui/data-table.tsx`. Do not reimplement table shells, sortable headers, resize handles, zebra/selected row states, selection controls, inline text/select filters, or row click suppression inside feature modules.

Use one of two composition levels:

- **`DataGrid`** (`src/components/ui/data-grid.tsx`) for configuration-driven tables. Define columns once and opt into sorting, resizing, selection, inline filters, pagination, mobile cards, and row activation.
- **`data-table.tsx` primitives** for feature-rich tables whose cells or filters need custom domain components. Compose `TableShell`, `TableViewport`, `TableRoot`, `TableHead`, `TableFilterRow`, `TableHeaderRow`, `TableHeaderCell`, `TableBody`, `TableRow`, and `TableSelectionButton`; keep only domain-specific cell/filter content in the feature module.

The shared primitives own these interaction and visual rules:

- standard desktop cell density (`px-3 py-2`) and compact variants where explicitly needed;
- inline filter row height/alignment;
- sortable header icons and `aria-sort`;
- pointer and keyboard column resizing;
- alternating row backgrounds, hover states, and selected-row states;
- keyboard-accessible row activation;
- suppression of row activation when the user interacts with links, buttons, inputs, menus, or resize handles;
- common selection and empty-state presentation.

Example for a custom table:

```tsx
<TableShell isFetching={isFetching}>
  <TableViewport>
    <TableRoot>
      <TableHead>
        <TableFilterRow>
          <TableFilterCell>
            <TableTextFilter
              ariaLabel="Filter company"
              value={filters.company}
              onChange={(company) => setFilters({ ...filters, company })}
            />
          </TableFilterCell>
        </TableFilterRow>
        <TableHeaderRow>
          <TableHeaderCell
            label="Company"
            sorted={sortBy === 'company'}
            sortOrder={sortOrder}
            onSort={() => setSortBy('company')}
            resizable
            onResizePointerDown={handleResize}
          />
        </TableHeaderRow>
      </TableHead>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow
            key={row.id}
            index={index}
            onActivate={() => openRow(row)}
          >
            <TableCell>{row.company}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableRoot>
  </TableViewport>
</TableShell>
```

Feature modules may use specialized filter controls such as `CompanySelect`, `DatePicker`, or `AmountFilter` inside `TableFilterCell`; they should not recreate the surrounding table/filter/header behavior.

##### Inline Filter Visual Contract

Every visible control in an inline table-filter row must use the canonical `table-filter` visual contract from `src/components/ui/table-filter-styles.ts`. Do not style an inline filter independently in a feature module.

| Property | Canonical value |
|---|---|
| Control height | 36px (`h-9 min-h-9`) |
| Horizontal padding | 12px (`px-3`) |
| Border radius | `rounded-lg` |
| Border | `border-border-primary` |
| Background | `bg-background-secondary/30` |
| Text | `text-xs font-normal text-text-primary` |
| Placeholder | `text-xs font-normal text-text-muted` |
| Hover | `border-oak-primary/50` |
| Focus/open | Oak primary border + 2px `oak-primary/30` ring |
| Disabled | Existing shared disabled opacity/cursor treatment |

The following reusable widgets support this contract and should receive `variant="table-filter"` when used in an inline filter row:

- `SearchableSelect` / `TableSelectFilter`
- `CompanySelect` and `CompanySearchableSelect`
- `DatePicker`
- `SingleDateInput`
- `AmountFilter`
- `CountFilter`

Use `TableTextFilter` for native text/search/number inputs; it applies the contract automatically. The selected-value state must not become bolder, darker, taller, or use a different surface from the empty state. Icons, clear buttons, and chevrons may differ by control type, but they must not change the control height, typography, surface, or padding.

Comprehensive patterns for data tables, from simple lists to complex data grids with advanced filtering.

##### Table Types

| Type | Use Case | Characteristics | Example |
|------|----------|-----------------|---------|
| **Simple Table** | Basic lists (companies, contacts) | Sortable columns, row selection, pagination | Companies list |
| **Compact Table** | Dense data (logs, audit trails) | Smaller padding, compact text | Audit logs |
| **Data Grid** | Complex data with advanced filtering | Multi-row headers, inline filters, resizable columns | Document processing |

##### Cell Padding Standards

| Table Type | Cell Padding | Font Size | Row Height |
|------------|-------------|-----------|------------|
| **Standard** | `px-3 py-2` (12px/8px) | `text-sm` (13px) | ~40px |
| **Dense/Compact** | `px-2 py-1.5` (8px/6px) | `text-sm` (13px) | ~32px |

```tsx
// Standard table
<table className="table">
  <thead>
    <tr className="bg-bg-secondary">
      <th className="px-3 py-2 text-xs font-medium text-text-secondary uppercase">Name</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td className="px-3 py-2 text-sm text-text-primary">Acme Corp</td>
    </tr>
  </tbody>
</table>

// Dense table (document processing)
<table className="table-compact">
  <thead>
    <tr className="bg-bg-secondary">
      <th className="px-2 py-1.5 text-xs font-medium text-text-secondary uppercase">Name</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td className="px-2 py-1.5 text-sm text-text-primary">Acme Corp</td>
    </tr>
  </tbody>
</table>
```

##### Complex Table Pattern (Shared Primitive Composition)

Document Processing is a useful example of a complex domain table, but the **shared primitives are the source of truth**. Advanced tables should compose domain-specific controls into the shared structure rather than copy Document Processing markup.

**Key features supported by the shared system:**
1. Multi-row headers (filter row + column headers)
2. Mixed filter types (select, text, date, amount, company, tags)
3. Pointer and keyboard-resizable columns
4. Sortable headers with consistent indicators and `aria-sort`
5. Dense badges and rich domain cells
6. Alternating, selected, hover, and focus row states
7. Keyboard-accessible row activation with nested-control click suppression
8. Pagination outside the scroll viewport but inside the table shell

###### Multi-Row Filter Headers

Use `TableFilterRow` above `TableHeaderRow`. Put specialized controls inside `TableFilterCell`.

```tsx
<TableHead>
  <TableFilterRow>
    <TableFilterCell>
      <TableTextFilter
        ariaLabel="Filter document name"
        value={filters.documentName}
        onChange={(documentName) => updateFilters({ documentName })}
      />
    </TableFilterCell>
    <TableFilterCell>
      <CompanySelect
        value={filters.companyId ?? ''}
        onChange={(companyId) => updateFilters({ companyId: companyId || undefined })}
        placeholder="All companies"
      />
    </TableFilterCell>
  </TableFilterRow>

  <TableHeaderRow>
    <TableHeaderCell
      label="Document"
      sorted={sortBy === 'document'}
      sortOrder={sortOrder}
      onSort={() => setSortBy('document')}
      resizable
      onResizePointerDown={(event) => startResize(event, 'document')}
      onResizeKeyDown={(event) => resizeWithKeyboard(event, 'document')}
    />
    <TableHeaderCell
      label="Company"
      sorted={sortBy === 'company'}
      sortOrder={sortOrder}
      onSort={() => setSortBy('company')}
      resizable
      onResizePointerDown={(event) => startResize(event, 'company')}
      onResizeKeyDown={(event) => resizeWithKeyboard(event, 'company')}
    />
  </TableHeaderRow>
</TableHead>
```

###### Column Resizing

Do not add custom resize handles to feature modules. Set `resizable` on `TableHeaderCell` and provide pointer/keyboard callbacks. The shared resize handle owns cursor, focus, hover, separator semantics, and row-click suppression.

###### Row Interaction

Use `TableRow onActivate` when the row opens a detail page or performs a primary action. The shared row supports Enter/Space and ignores activation originating from links, buttons, inputs, menus, labels, or resize handles.

```tsx
<TableRow
  index={index}
  selected={selectedIds.has(row.id)}
  onActivate={() => router.push(`/items/${row.id}`)}
>
  <TableCell>{row.name}</TableCell>
  <TableCell>
    <Button onClick={() => edit(row)}>Edit</Button>
  </TableCell>
</TableRow>
```

###### Dense Badge Layout in Cells

Rich status content remains domain-specific, but its container belongs inside the shared cell.

```tsx
<TableCell>
  <div className="flex flex-wrap items-center gap-2">
    <Badge size="sm" variant="success">Extracted</Badge>
    <Badge size="sm" variant="info">Approved</Badge>
  </div>
</TableCell>
```


##### Table Row States

| State | Background | Border | Hover | Use Case |
|-------|-----------|--------|-------|----------|
| **Default** | `bg-bg-secondary` | `border-b border-border-primary` | `hover:bg-bg-tertiary` | Standard row |
| **Selected** | `bg-oak-row-selected` | Same | `hover:bg-oak-row-selected-hover` | Row checkbox checked |
| **Focused** | Same as default | `ring-2 ring-oak-primary` | Same | Keyboard navigation |
| **Disabled** | `bg-bg-tertiary` | Same | No hover | Archived/inactive items |

```tsx
<tr
  className={cn(
    'border-b border-border-primary transition-colors duration-150',
    selectedIds.has(row.id)
      ? 'bg-oak-row-selected hover:bg-oak-row-selected-hover'
      : 'bg-bg-secondary hover:bg-bg-tertiary',
    isFocused && 'ring-2 ring-oak-primary',
    row.isDisabled && 'bg-bg-tertiary opacity-60 pointer-events-none'
  )}
  data-selected={selectedIds.has(row.id)}
>
  {/* Cell content */}
</tr>
```

##### Context-Specific Dropdown Styling

Dropdown styling varies by context to match visual density:

**Standard Form Context (Bordered)**
```tsx
<Select
  size="md"
  className="border border-border-primary bg-bg-primary focus:ring-2 focus:ring-oak-primary"
>
  <option>Option 1</option>
</Select>
```

**Table Header Filter Context (Transparent)**
```tsx
<Select
  size="xs"
  className="bg-transparent border-0 focus:border focus:border-border-primary focus:bg-bg-primary"
>
  <option>All</option>
  <option>Active</option>
</Select>
```

**Rationale**: Table filters use transparent styling to reduce visual noise in dense layouts. The border appears on focus to clearly indicate the active filter.

---

###### Real-World Implementation: Document Processing Table

**Reference**: [src/app/(dashboard)/processing/page.tsx](../../src/app/(dashboard)/processing/page.tsx)

This is the **production reference implementation** showcasing all advanced table patterns in action.

**Complete Feature Set:**
- ✅ Multi-row filter headers (filter row + column headers)
- ✅ 15+ filter types (text, searchable select, date, amount)
- ✅ Resizable columns with Pointer Events API
- ✅ Sortable headers with visual indicators
- ✅ Row selection (none/partial/all states)
- ✅ Dense badge layouts (pipeline, status, duplicate, tags)
- ✅ Click-to-navigate rows with modifier key support
- ✅ Column visibility toggle
- ✅ User preference persistence (widths, visibility)
- ✅ Keyboard shortcuts (Refresh: Ctrl+R, Upload: F1, Approve Next: F2)
- ✅ Pagination with page info

**1. Multi-Row Header Structure** (Lines 1842-2263)

```tsx
<thead className="bg-background-tertiary border-b border-border-primary">
  {/* Row 1: Filter Controls */}
  <tr className="bg-background-secondary/50">
    <th className="px-4 py-2"></th> {/* Checkbox column */}
    {visibleColumns.map((col) => (
      <th key={col.id} className="px-4 py-2 max-w-0">
        {/* Render appropriate filter for column type */}
        {col.filterType === 'text' && (
          <div className="w-full flex items-center gap-2 h-9 rounded-lg border bg-background-secondary/30 border-border-primary hover:border-oak-primary/50 focus-within:ring-2 focus-within:ring-oak-primary/30 transition-colors">
            <input
              type="text"
              value={filters[col.id] || ''}
              onChange={(e) => handleFilterChange(col.id, e.target.value)}
              placeholder="All"
              className="flex-1 bg-transparent outline-none px-3 min-w-0 text-xs text-text-primary placeholder:text-text-secondary"
            />
            {filters[col.id] && (
              <button onClick={() => handleFilterChange(col.id, undefined)}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {col.filterType === 'select' && (
          <SearchableSelect
            options={col.options}
            value={filters[col.id] || ''}
            onChange={(value) => handleFilterChange(col.id, value)}
            className="text-xs"
            showChevron={false}
            showKeyboardHints={false}
          />
        )}
      </th>
    ))}
  </tr>

  {/* Row 2: Column Headers with Sort */}
  <tr className="border-t border-border-primary">
    <th className="w-10 px-4 py-2.5">
      <button onClick={toggleSelectAll}>
        {selectionState === 'all' ? (
          <CheckSquare className="w-4 h-4 text-oak-primary" />
        ) : selectionState === 'partial' ? (
          <MinusSquare className="w-4 h-4 text-oak-light" />
        ) : (
          <Square className="w-4 h-4 text-text-muted" />
        )}
      </button>
    </th>
    {visibleColumns.map((col) => (
      <th key={col.id} className="relative text-xs font-medium text-text-secondary px-4 py-2.5">
        {col.sortable ? (
          <button
            onClick={() => handleSort(col.sortField)}
            className={cn(
              'inline-flex items-center gap-1 hover:text-text-primary',
              sortBy === col.sortField && 'text-text-primary'
            )}
          >
            {col.label}
            {sortBy === col.sortField ? (
              sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
            ) : (
              <ArrowUpDown className="w-3.5 h-3.5 text-text-muted" />
            )}
          </button>
        ) : (
          <span>{col.label}</span>
        )}
        {/* Resize handle */}
        <div
          onPointerDown={(e) => startResize(e, col.id)}
          className="absolute top-0 -right-2 h-full w-4 cursor-col-resize hover:bg-border-secondary/60 z-10 touch-none"
        />
      </th>
    ))}
  </tr>
</thead>
```

**Key Implementation Details:**
- Filter row: `bg-background-secondary/50` (50% opacity for subtle distinction)
- Column header row: `border-t border-border-primary` (visual separator)
- Text filters: `h-9` height (36px, matches button height)
- Filter inputs: `bg-background-secondary/30` with `border-border-primary`
- Focus state: `focus-within:ring-2 focus-within:ring-oak-primary/30`
- Clear button: Only shown when filter has value (`{filters[col.id] && ...}`)
- Searchable selects: `showChevron={false}` and `showKeyboardHints={false}` for compact inline display

**2. Resizable Columns Implementation** (Lines 712-765)

```tsx
// State
const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
const isResizingRef = useRef(false);

// Resize handler
const startResize = useCallback((e: React.PointerEvent, columnId: string) => {
  e.preventDefault();
  e.stopPropagation();

  const handle = e.currentTarget as HTMLElement;
  const th = handle.closest('th') as HTMLTableCellElement;
  const startWidth = columnWidths[columnId] ?? th.getBoundingClientRect().width ?? 120;
  const startX = e.clientX;
  const pointerId = e.pointerId;

  isResizingRef.current = true;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';

  try {
    handle.setPointerCapture(pointerId);
  } catch {}

  const onMove = (ev: globalThis.PointerEvent) => {
    const nextWidth = Math.max(40, startWidth + (ev.clientX - startX));
    setColumnWidths((prev) => ({ ...prev, [columnId]: nextWidth }));
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    try {
      handle.releasePointerCapture(pointerId);
    } catch {}
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    isResizingRef.current = false;

    // Persist to user preferences
    saveColumnWidths.mutate({ columnWidths });
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}, [columnWidths, saveColumnWidths]);

// Apply widths with <colgroup>
<colgroup>
  <col style={{ width: '40px' }} />
  {visibleColumns.map((col) => (
    <col
      key={col.id}
      style={columnWidths[col.id] ? { width: `${columnWidths[col.id]}px` } : undefined}
    />
  ))}
</colgroup>
```

**Key Features:**
- Uses **Pointer Events API** (not MouseEvent) for cross-device support
- `setPointerCapture(pointerId)` ensures drag continues even if cursor leaves element
- Minimum width: **40px** (prevents columns from becoming unusable)
- Resize handle: `absolute top-0 -right-2 h-full w-4` (4px wide, offset 2px left)
- Touch-friendly: `touch-none` class prevents scrolling during resize
- `isResizingRef` prevents row navigation clicks during resize operation
- Persists widths to user preferences for session continuity

**3. Inline Filter Styling Patterns**

```tsx
// Text Input Filter (compact, transparent)
<div className="w-full flex items-center gap-2 h-9 rounded-lg border bg-background-secondary/30 border-border-primary hover:border-oak-primary/50 focus-within:ring-2 focus-within:ring-oak-primary/30 transition-colors">
  <input
    className="flex-1 bg-transparent outline-none px-3 min-w-0 text-xs"
  />
</div>

// Searchable Select (no chevron, no hints)
<SearchableSelect
  className="text-xs"
  showChevron={false}
  showKeyboardHints={false}
/>

// Amount Filter (range or single value)
<AmountFilter
  size="sm"
  className="text-xs"
  showChevron={false}
/>
```

**Styling Rules:**
| Property | Standard Form | Table Header Filter |
|----------|--------------|-------------------|
| Background | `bg-background-primary` | `bg-background-secondary/30` |
| Border | `border-border-primary` (visible) | `border-border-primary` (visible) |
| Border Hover | `hover:border-oak-light` | `hover:border-oak-primary/50` |
| Focus Ring | `ring-2 ring-oak-primary` | `ring-2 ring-oak-primary/30` |
| Height | `h-10` (40px) | `h-9` (36px) |
| Font Size | `text-sm` (13px) | `text-xs` (12px) |
| Chevron | Visible | Hidden (`showChevron={false}`) |
| Keyboard Hints | Visible | Hidden (`showKeyboardHints={false}`) |

**4. Dense Badge Layouts** (Lines 192-205, 519-579)

```tsx
// Badge Component for Status
function StatusBadge({ config }: { config: BadgeConfig }) {
  const Icon = config.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium max-w-full',
        config.color
      )}
      title={config.label}
    >
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

// Badge Configuration
const pipelineStatusConfig: Record<PipelineStatus, BadgeConfig> = {
  UPLOADED: { label: 'Uploaded', color: 'text-text-secondary bg-background-tertiary', icon: Upload },
  EXTRACTION_DONE: { label: 'Extracted', color: 'text-status-success bg-status-success/10', icon: CheckCircle },
  FAILED_PERMANENT: { label: 'Failed', color: 'text-status-error bg-status-error/10', icon: XCircle },
  // ...
};

// Cell Rendering
<td className="px-4 py-3 max-w-0">
  <div className="min-w-0">
    <StatusBadge config={pipelineStatusConfig[doc.pipelineStatus]} />
  </div>
</td>

// Tags with Overflow
<td className="px-4 py-3 max-w-0">
  <div className="flex flex-wrap items-center gap-1 min-w-0">
    {tags.slice(0, 3).map((tag) => (
      <TagChip key={tag.id} name={tag.name} color={tag.color} size="xs" />
    ))}
    {tags.length > 3 && (
      <span className="text-xs text-text-muted">+{tags.length - 3}</span>
    )}
  </div>
</td>
```

**Badge Sizing:**
- Padding: `px-2 py-0.5` (8px horizontal, 2px vertical)
- Font: `text-xs font-medium` (12px)
- Icon: `w-3 h-3` (12px, same as text)
- Gap: `gap-1` (4px between icon and text)
- Overflow: `truncate` on text span, `flex-shrink-0` on icon

**Color Pattern:**
- Success: `text-status-success bg-status-success/10`
- Warning: `text-status-warning bg-status-warning/10`
- Error: `text-status-error bg-status-error/10`
- Info: `text-status-info bg-status-info/10`
- Neutral: `text-text-secondary bg-background-tertiary`

**5. Row Navigation with Modifier Keys** (Lines 848-862)

```tsx
const handleRowNavigate = useCallback((e: MouseEvent, docId: string) => {
  // Only handle plain left-clicks
  if (e.defaultPrevented) return;
  if (isResizingRef.current) return; // Don't navigate during resize
  if (e.button !== 0) return; // Only left mouse button
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // Allow Ctrl+click for new tab

  // Don't navigate if clicking interactive elements
  const target = e.target as HTMLElement;
  if (target.closest('a,button,input,select,textarea,[role="button"]')) return;

  router.push(`/processing/${docId}`);
}, [router]);

// Row rendering
<tr
  onClick={(e) => handleRowNavigate(e, doc.id)}
  className={cn(
    'border-b border-border-primary transition-colors cursor-pointer',
    isSelected
      ? 'bg-oak-row-selected hover:bg-oak-row-selected-hover'
      : isAlternate
        ? 'bg-oak-row-alt hover:bg-oak-row-alt-hover'
        : 'hover:bg-background-tertiary/50'
  )}
>
```

**Navigation Rules:**
- ✅ Plain left-click → Navigate to detail page
- ✅ Ctrl/Cmd + click → Open in new tab (browser default)
- ✅ Right-click → Context menu (browser default)
- ✅ Clicking buttons/links/inputs → Execute that action (don't navigate)
- ✅ During column resize → Don't navigate
- ✅ Shift/Alt + click → Ignore (reserved for future selection features)

**6. Selection State Management** (Lines 825-927)

```tsx
const [selectedIds, setSelectedIds] = useState<string[]>([]);

const toggleSelectAll = useCallback(() => {
  const allIds = data?.documents.map((d) => d.id) || [];
  const allSelected = allIds.every((id) => selectedIds.includes(id));
  setSelectedIds(allSelected ? [] : allIds);
}, [data, selectedIds]);

const toggleSelect = useCallback((id: string) => {
  setSelectedIds((prev) =>
    prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
  );
}, []);

const selectionState = useMemo(() => {
  if (!data?.documents || data.documents.length === 0) return 'none';
  const allIds = data.documents.map((d) => d.id);
  const selectedCount = allIds.filter((id) => selectedIds.includes(id)).length;
  if (selectedCount === 0) return 'none';
  if (selectedCount === allIds.length) return 'all';
  return 'partial';
}, [data, selectedIds]);

// Clear selection when filters change
useEffect(() => {
  setSelectedIds([]);
}, [params]); // params includes filters, page, sortBy, sortOrder
```

**Selection States:**
- **none**: No rows selected → `Square` icon (empty checkbox)
- **partial**: Some rows selected → `MinusSquare` icon (indeterminate)
- **all**: All rows selected → `CheckSquare` icon (filled checkbox)

**Key Behaviors:**
- Selection persists during sorting
- Selection **clears** when filters/page changes (prevents selecting invisible rows)
- `toggleSelectAll` checks current state: if all selected → deselect all, otherwise select all
- Individual row selection toggles on/off

---

**Implementation Checklist** for creating similar advanced tables:

- [ ] Multi-row header (filters above, headers with sort below)
- [ ] Column width persistence (user preferences)
- [ ] Resizable columns with Pointer Events API
- [ ] Inline filter styling (transparent background, compact height)
- [ ] Sortable headers (three states: asc/desc/none)
- [ ] Row selection (none/partial/all checkbox states)
- [ ] Click-to-navigate with modifier key support
- [ ] Dense badge layouts with overflow handling
- [ ] Keyboard shortcuts for common actions
- [ ] Responsive mobile view (card layout fallback)
- [ ] Pagination with page info and per-page selector
- [ ] Column visibility toggle (show/hide columns)
- [ ] Accessibility: ARIA labels, keyboard navigation, focus management

##### Table Pagination Pattern

Standard pagination for all tables:

```tsx
<div className="flex items-center justify-between px-4 py-3 border-t border-border-primary bg-bg-secondary">
  {/* Left: Results info */}
  <div className="text-sm text-text-secondary">
    Showing <span className="font-medium text-text-primary">{start}</span> to{' '}
    <span className="font-medium text-text-primary">{end}</span> of{' '}
    <span className="font-medium text-text-primary">{total}</span> results
  </div>

  {/* Center: Page numbers */}
  <div className="flex items-center gap-1">
    <Button
      size="sm"
      variant="ghost"
      disabled={currentPage === 1}
      onClick={() => setPage(currentPage - 1)}
    >
      <Icon name="chevron-left" className="w-4 h-4" />
      Previous
    </Button>

    {pageNumbers.map((pageNum) => (
      <Button
        key={pageNum}
        size="sm"
        variant={pageNum === currentPage ? 'default' : 'ghost'}
        onClick={() => setPage(pageNum)}
        className="min-w-[36px]"
      >
        {pageNum}
      </Button>
    ))}

    <Button
      size="sm"
      variant="ghost"
      disabled={currentPage === totalPages}
      onClick={() => setPage(currentPage + 1)}
    >
      Next
      <Icon name="chevron-right" className="w-4 h-4" />
    </Button>
  </div>

  {/* Right: Per page selector */}
  <div className="flex items-center gap-2">
    <span className="text-sm text-text-secondary">Per page:</span>
    <Select
      size="xs"
      value={perPage}
      onChange={(e) => setPerPage(Number(e.target.value))}
      className="w-20"
    >
      <option value={10}>10</option>
      <option value={25}>25</option>
      <option value={50}>50</option>
      <option value={100}>100</option>
    </Select>
  </div>
</div>
```

**Key Elements:**
- Results info on left shows range and total
- Page buttons in center with active state highlighting
- Per-page selector on right for adjusting results
- Previous/Next buttons with icons and disabled states

##### Table Empty State

When tables have no data, display an empty state:

```tsx
{items.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <Icon name="briefcase" className="w-12 h-12 text-text-muted mb-4" />
    <h3 className="text-lg font-semibold text-text-primary mb-2">
      No items found
    </h3>
    <p className="text-sm text-text-secondary mb-4 max-w-md">
      {hasFilters
        ? 'Try adjusting your filters or search query.'
        : 'Get started by creating your first item.'}
    </p>
    {!hasFilters && (
      <Button size="md" variant="primary" onClick={handleCreate}>
        <Icon name="plus" className="w-4 h-4 mr-2" />
        Add Item
      </Button>
    )}
  </div>
) : (
  <table className="table">
    {/* Table content */}
  </table>
)}
```

**Empty State Components:**
- Icon: 48px (w-12 h-12) in muted color
- Heading: text-lg font-semibold
- Description: text-sm, max-w-md for readability
- Action button: Only when no filters applied (otherwise show "adjust filters" message)

##### Table Accessibility

Ensure tables are accessible to all users:

**ARIA Labels:**
```tsx
<table aria-label="Companies list" className="table">
  <thead>
    <tr>
      <th scope="col">Name</th>
      <th scope="col">Status</th>
      <th scope="col">Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>{name}</td>
      <td>{status}</td>
      <td>
        <Button aria-label={`Edit ${name}`}>Edit</Button>
      </td>
    </tr>
  </tbody>
</table>
```

**Keyboard Navigation:**
- `Tab`: Navigate between interactive elements (checkboxes, buttons, inputs)
- `Enter` / `Space`: Activate buttons and checkboxes
- `Arrow keys`: Navigate between rows (when implementing roving tabindex)
- `Cmd/Ctrl + A`: Select all rows (when implemented)

**Screen Reader Support:**
- Use `scope="col"` on `<th>` elements
- Use `aria-label` for icon-only buttons
- Announce selection changes with `aria-live` regions
- Use `aria-sort` on sortable column headers

##### Table Performance Optimization

For large datasets, optimize table rendering:

**Virtualization:**
```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualTable({ rows }) {
  const parentRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40, // Row height in pixels
    overscan: 5, // Render extra rows for smooth scrolling
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <table className="table">
        <thead>{/* Column headers */}</thead>
        <tbody style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <tr
                key={row.id}
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {/* Row content */}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

**When to Use Virtualization:**
- Tables with 100+ rows
- Rows with complex content (images, badges, nested elements)
- Mobile devices (limited memory and CPU)

**Alternative: Pagination** (simpler, recommended for most cases)
- Limit rows per page (10, 25, 50, 100)
- Use server-side pagination for large datasets
- Show loading states during page transitions

##### Multi-Section Tables

When displaying related but distinct data groups, use section headers within a page:

```tsx
<div className="space-y-6">
  {/* AI Providers Section */}
  {aiProviders.length > 0 && (
    <div className="card">
      <div className="p-4 border-b border-border-primary">
        <h2 className="font-medium text-text-primary flex items-center gap-2">
          <Brain className="w-5 h-5 text-oak-light" />
          AI Providers
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="table">{/* Table content */}</table>
      </div>
    </div>
  )}

  {/* Storage Section */}
  {storageProviders.length > 0 && (
    <div className="card">
      <div className="p-4 border-b border-border-primary">
        <h2 className="font-medium text-text-primary flex items-center gap-2">
          <Cloud className="w-5 h-5 text-sky-500" />
          Storage
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="table">{/* Table content */}</table>
      </div>
    </div>
  )}
</div>
```

**Multi-Section Table Pattern:**
- Wrap each section in a `.card` container
- Section header: `p-4 border-b border-border-primary` with icon + title
- Icon: `w-5 h-5` with semantic color (oak-light for primary, sky-500 for secondary, etc.)
- Title: `font-medium text-text-primary`
- Spacing between sections: `space-y-6` on parent container
- Each table shares the same column structure when appropriate
- Only render sections that have data (conditional rendering)

**Reference Implementation:** [connectors/page.tsx](../src/app/(dashboard)/admin/connectors/page.tsx)

##### Multi-Line Cell Content

For cells that display multiple related data points, use vertical stacking with consistent spacing:

```tsx
{/* Contact Information Cell - Multiple items */}
<td>
  <div className="text-xs space-y-0.5">
    {email && (
      <div className="flex items-center gap-1.5 text-text-secondary">
        <Mail className="w-3 h-3 flex-shrink-0" />
        <span className="truncate max-w-[160px]">{email}</span>
      </div>
    )}
    {phone && (
      <div className="flex items-center gap-1.5 text-text-secondary">
        <Phone className="w-3 h-3 flex-shrink-0" />
        <span>{phone}</span>
      </div>
    )}
    {!email && !phone && (
      <span className="text-text-muted">—</span>
    )}
  </div>
</td>

{/* Usage Metrics Cell - With progress bars */}
<td>
  <div className="space-y-2 min-w-[140px]">
    {/* Users metric */}
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-text-muted flex items-center gap-1">
          <Users className="w-3 h-3" />
          Users
        </span>
        <span className="text-text-secondary font-medium">
          {current}/{max}
        </span>
      </div>
      <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-oak-primary'
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
    {/* Additional metrics... */}
  </div>
</td>
```

**Multi-Line Cell Guidelines:**
| Content Type | Spacing | Icon Size | Text Size |
|--------------|---------|-----------|-----------|
| Simple list (email, phone) | `space-y-0.5` | `w-3 h-3` | `text-xs` |
| Metrics with progress bars | `space-y-2` | `w-3 h-3` | `text-xs` |
| Primary + secondary info | `space-y-1` | `w-4 h-4` | `text-sm` / `text-xs` |

**Best Practices:**
- Use `flex-shrink-0` on icons to prevent compression
- Set `min-w-[Xpx]` on container to prevent column collapse
- Show em-dash (`—`) when all values are empty
- Use `truncate` with `max-w-[Xpx]` for potentially long text
- Group related items (contact info together, metrics together)

**Reference Implementation:** [tenants/page.tsx](../src/app/(dashboard)/admin/tenants/page.tsx)

##### Stats Card Variations

Stats cards use semantic colors based on the metric's meaning:

```tsx
<div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
  {/* Primary/Total metric - Brand color */}
  <div className="card card-compact sm:p-4">
    <div className="flex items-center gap-3">
      <div className="p-2 rounded bg-oak-primary/10">
        <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-oak-light" />
      </div>
      <div>
        <p className="text-xl sm:text-2xl font-semibold text-text-primary">{total}</p>
        <p className="text-xs sm:text-sm text-text-tertiary">Total</p>
      </div>
    </div>
  </div>

  {/* In-progress/Pending metric - Info color */}
  <div className="card card-compact sm:p-4">
    <div className="flex items-center gap-3">
      <div className="p-2 rounded bg-status-info/10">
        <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-status-info" />
      </div>
      <div>
        <p className="text-xl sm:text-2xl font-semibold text-text-primary">{queued}</p>
        <p className="text-xs sm:text-sm text-text-tertiary">Queued</p>
      </div>
    </div>
  </div>

  {/* Needs attention metric - Warning color */}
  <div className="card card-compact sm:p-4">
    <div className="flex items-center gap-3">
      <div className="p-2 rounded bg-status-warning/10">
        <Eye className="w-4 h-4 sm:w-5 sm:h-5 text-status-warning" />
      </div>
      <div>
        <p className="text-xl sm:text-2xl font-semibold text-text-primary">{pendingReview}</p>
        <p className="text-xs sm:text-sm text-text-tertiary">Pending Review</p>
      </div>
    </div>
  </div>

  {/* Success metric - Success color */}
  <div className="card card-compact sm:p-4">
    <div className="flex items-center gap-3">
      <div className="p-2 rounded bg-status-success/10">
        <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-status-success" />
      </div>
      <div>
        <p className="text-xl sm:text-2xl font-semibold text-text-primary">{approved}</p>
        <p className="text-xs sm:text-sm text-text-tertiary">Approved</p>
      </div>
    </div>
  </div>

  {/* Error/Failed metric - Error color */}
  <div className="card card-compact sm:p-4">
    <div className="flex items-center gap-3">
      <div className="p-2 rounded bg-status-error/10">
        <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-status-error" />
      </div>
      <div>
        <p className="text-xl sm:text-2xl font-semibold text-text-primary">{failed}</p>
        <p className="text-xs sm:text-sm text-text-tertiary">Failed</p>
      </div>
    </div>
  </div>
</div>
```

**Stats Card Color Semantics:**
| Metric Type | Background | Icon Color | Use Case |
|-------------|------------|------------|----------|
| **Primary/Total** | `bg-oak-primary/10` | `text-oak-light` | Total counts, primary metrics |
| **In Progress** | `bg-status-info/10` | `text-status-info` | Queued, processing, pending |
| **Needs Attention** | `bg-status-warning/10` | `text-status-warning` | Pending review, expiring soon |
| **Success** | `bg-status-success/10` | `text-status-success` | Approved, completed, active |
| **Error/Failed** | `bg-status-error/10` | `text-status-error` | Failed, errors, overdue |
| **Neutral/Info** | `bg-background-tertiary` | `text-text-muted` | General info, non-status metrics |

**Stats Card Structure:**
- Container: `.card.card-compact` or `.card` with `p-4`
- Layout: `flex items-center gap-3`
- Icon wrapper: `p-2 rounded` with semantic background
- Icon size: `w-4 h-4 sm:w-5 sm:h-5` (responsive)
- Number: `text-xl sm:text-2xl font-semibold text-text-primary`
- Label: `text-xs sm:text-sm text-text-tertiary`

**Grid Layout for Stats:**
- Mobile: `grid-cols-2` (2 cards per row)
- Desktop: `grid-cols-4` to `grid-cols-6` depending on count
- Gap: `gap-4` (16px)

**Reference Implementation:** [processing/page.tsx](../src/app/(dashboard)/processing/page.tsx)

##### DataGrid Component

The `DataGrid` component provides a feature-rich, reusable table component for complex data displays.

**File:** `src/components/ui/data-grid.tsx`

```tsx
import { DataGrid, DataGridColumn, useDataGridSort, useDataGridSelection, useDataGridPagination } from '@/components/ui/data-grid';

// Define columns
const columns: DataGridColumn<User>[] = [
  { id: 'name', label: 'Name', sortField: 'name', render: (row) => row.name },
  { id: 'email', label: 'Email', render: (row) => row.email },
  { id: 'balance', label: 'Balance', rightAligned: true, render: (row) => formatCurrency(row.balance) },
];

// Use in component
function UsersTable() {
  const { sortBy, sortOrder, handleSort } = useDataGridSort('name');
  const { selectedKeys, setSelectedKeys } = useDataGridSelection();
  const { page, setPage, limit, setLimit } = useDataGridPagination(20);

  return (
    <DataGrid
      data={users}
      columns={columns}
      getRowKey={(user) => user.id}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onSort={handleSort}
      selectable
      selectedKeys={selectedKeys}
      onSelectionChange={setSelectedKeys}
      page={page}
      totalPages={data.totalPages}
      total={data.total}
      limit={limit}
      onPageChange={setPage}
      onLimitChange={setLimit}
    />
  );
}
```

**DataGrid Features:**
- **Sortable columns** with direction indicators (ArrowUp/ArrowDown/ArrowUpDown)
- **Resizable columns** with drag handles and width persistence
- **Row selection** with checkbox support (none/some/all states)
- **Pagination** integration with the `Pagination` component
- **Column visibility** control for hiding/showing columns
- **Mobile responsive** with optional card view rendering
- **Loading states** with skeleton rows
- **Variants**: `default` and `compact` padding modes

**DataGridColumn Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique column identifier |
| `label` | `string` | Column header label |
| `sortField` | `string?` | Field name for sorting (if sortable) |
| `rightAligned` | `boolean?` | Right-align cell content (for numbers) |
| `defaultWidth` | `number?` | Default width in pixels |
| `minWidth` | `number?` | Minimum width in pixels |
| `fixedWidth` | `number?` | Fixed width (prevents resizing) |
| `defaultVisible` | `boolean?` | Visible by default (default: true) |
| `showOnMobile` | `boolean?` | Show on mobile card view |
| `render` | `(row, index) => ReactNode` | Cell content renderer |
| `renderHeader` | `() => ReactNode?` | Custom header renderer |
| `renderFilter` | `() => ReactNode?` | Inline filter for the column (adds the filter row) |

**Other DataGrid props worth knowing:**
- `emptyState` renders inside the table body, so headers and inline filters stay usable when nothing matches (use `ListEmptyState`).
- `isFetching` dims the table during a refetch; pair it with `placeholderData: keepPreviousData` so rows stay on screen.
- `getRowName` names the row in its selection button ("Select First Board Resolution").
- A column with a width keeps it; long content truncates instead of widening the column.

**Saved column layout:** `useTableColumnPreference(key, columnIds, { locked, hiddenByDefault })` (`src/hooks/use-table-column-preference.ts`) keeps column order, visibility and widths per user. Feed `columnOrder` into the columns you pass, `columnVisibility`/`columnWidths`/`setColumnWidth` into `DataGrid`, and the rest into `ServiceColumnModal` behind a Columns button (`ServiceFilterToolbar`).

**Reference list page:** the Document Templates and Partials pages (`src/app/(dashboard)/template-partials/`) combine `DataGrid` with a search box, quick filter buttons, `ActiveFilterBar`, the Columns modal, URL-kept filters (`useUrlListParams`), bulk actions and mobile cards.

**Utility Hooks:**

```tsx
// Sorting state management
const { sortBy, sortOrder, handleSort } = useDataGridSort('createdAt', 'desc');

// Selection state management
const { selectedKeys, setSelectedKeys, clearSelection, selectAll } = useDataGridSelection();

// Pagination state management
const { page, setPage, limit, setLimit, resetPage } = useDataGridPagination(20);
```

**When to Use DataGrid vs Custom Table:**
- Use `DataGrid` for: Standard data tables needing sorting, selection, pagination, inline filters and adjustable columns
- Use custom table for: Highly specialized layouts (like document processing)

**Reference:** [src/components/ui/data-grid.tsx](../src/components/ui/data-grid.tsx)

### Navigation

```css
.nav-item         /* Sidebar item (12px) */
.nav-item-active  /* Active state with oak tint */
```

### Utilities

```css
.divider          /* Horizontal rule */
.section-title    /* Uppercase label (10px) */
.skeleton         /* Loading placeholder */
```

---

## UI Consistency Standards

All pages follow these consistency standards for a unified look and feel:

| Element | Standard Class |
|---------|---------------|
| Buttons | `btn-{variant} btn-sm` (use `btn-sm` by default) |
| Inputs | `input input-sm` |
| Page Padding | `p-4 sm:p-6` (responsive) |
| Page Headers | `text-xl sm:text-2xl font-semibold text-text-primary` |
| Description Text | `text-sm text-text-secondary mt-1` |
| Back Links | `text-sm text-text-secondary hover:text-text-primary mb-3 transition-colors` |
| Error Messages | `text-xs text-status-error mt-1.5` |
| Card Headers | `p-4 border-b border-border-primary` |
| Form Labels | `label` class (12px, medium weight) |

### Page Layout Patterns

The application uses three distinct page patterns:

#### 1. List Pages (All Dashboard Pages)

All list pages follow the same pattern - no icons in page headers. This applies to both main navigation pages (Companies, Contacts, Documents) and admin pages (Tenants, Users, Roles, etc.).

```tsx
<div className="p-4 sm:p-6">
  {/* Header - NO icon in title */}
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
        Page Title
      </h1>
      <p className="text-sm text-text-secondary mt-1">
        Description text here
      </p>
    </div>
    <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
      Add Item
    </Button>
  </div>

  {/* TenantSelector for SUPER_ADMIN (after header) */}
  {session?.isSuperAdmin && (
    <div className="mb-6">
      <TenantSelector value={...} onChange={...} />
    </div>
  )}

  {/* Filters */}
  {/* Content */}
</div>
```

**Note:** Icons should NOT be placed next to page headers/titles. Icons are reserved for:
- Buttons (via `leftIcon` prop)
- Sidebar navigation items
- Stats cards and badges
- Table cells and inline indicators
- Section headers within pages (not the main page title)

#### 2. Detail/Form/Wizard Pages

These are pages accessed via ID or for specific actions (view, edit, create).

```tsx
<div className="min-h-screen bg-background-primary">
  {/* Header with back button */}
  <div className="border-b border-border-primary bg-background-secondary">
    <div className="max-w-6xl mx-auto px-6 py-4">
      <div className="flex items-center gap-4">
        <Link href="/parent-page">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="h-6 w-px bg-border-secondary" />
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            Page Title
          </h1>
          <p className="text-sm text-text-muted">
            Subtitle or context
          </p>
        </div>
      </div>
    </div>
  </div>

  {/* Content */}
  <div className="max-w-6xl mx-auto px-6 py-8">
    {/* TenantSelector for SUPER_ADMIN (if applicable) */}
    {/* Page content */}
  </div>
</div>
```

#### 3. Full-Page Editor with Sidebars (e.g., Template Editor)

Complex editors with resizable sidebars and multiple tool panels.

### Document editor toolbar and task panel

Document-editor toolbars group actions by authoring purpose: History, Text, Paragraph, Insert, Page, and View. Use subtle separators between groups, 32px compact controls, visible pressed states, accessible names, shortcut-aware tooltips, and 150ms state transitions. Multi-setting actions belong in labeled popovers; narrow layouts move uncommon actions into an overflow menu without changing their accessible names.

Editor side panels use a small set of task-oriented tabs rather than exposing implementation categories. For template authoring, use `Template`, `Fields`, and `Test & Preview`. Keep the panel collapsible and keyboard accessible, and constrain drag resizing to documented minimum and maximum widths. Preserve the selected task and usable content area at narrow viewport widths; avoid nested horizontal scroll traps.

Guided template builders insert balanced constructs in one transaction. Show human-readable choices first and keep exact template syntax in a collapsed `View syntax` disclosure for advanced users. Validation actions should describe the corrective action and focus the relevant document block when a stable flow identifier is available.

```tsx
<div className="h-screen flex flex-col bg-background-primary">
  {/* Fixed Header */}
  <div className="flex-none border-b border-border-primary bg-background-secondary px-4 py-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-lg font-semibold">Editor Title</h1>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Save</Button>
      </div>
    </div>
  </div>

  {/* Main Content with Resizable Panels */}
  <div className="flex-1 flex overflow-hidden">
    {/* Left Panel - Collapsible */}
    <div style={{ width: leftPanelWidth }} className="flex-none border-r">
      {/* Tab navigation and content */}
    </div>

    {/* Resize Handle */}
    <div className="w-1 cursor-col-resize hover:bg-accent-primary/20" />

    {/* Center Editor */}
    <div className="flex-1 overflow-auto p-6">
      <RichTextEditor value={content} onChange={setContent} />
    </div>

    {/* Right Panel - Collapsible */}
    <div style={{ width: rightPanelWidth }} className="flex-none border-l">
      {/* Preview, AI Assistant, etc. */}
    </div>
  </div>
</div>
```

**Template Editor specific features:**
- **Left Panel Tabs**: Details (tenant selector for SUPER_ADMIN, name, category, description, active), Placeholders (with partials), Test Data (with company selector)
- **Right Panel Tabs**: Preview (live PDF preview), AI Assistant (with tenant context)
- **Resizable**: Both panels can be resized via drag handles (min: 200px, max: 500px)
- **Collapsible**: Both panels can be collapsed to icons-only mode
- **Placeholder Syntax Info**: Display via info icon with hover tooltip instead of inline text

### Button Icon Pattern

Use the `leftIcon` prop for buttons with icons (preferred over inline icons):

```tsx
// Preferred: Using leftIcon prop
<Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>
  Add Item
</Button>

// Alternative: Inline icon (acceptable for Link-wrapped buttons)
<Link href="/path">
  <Button variant="primary" size="sm">
    <Plus className="w-4 h-4 mr-2" />
    Add Item
  </Button>
</Link>
```

### Centralized Tenant Selection for SUPER_ADMIN

Tenant selection for SUPER_ADMIN users is centralized in the **sidebar**. A "Select Tenant" button appears above the dark/light mode toggle, visible only to SUPER_ADMIN users. When clicked, it opens a modal with a searchable tenant list.

**Key benefits:**
1. **Single source of truth** - Selection persists across all pages via Zustand store with localStorage
2. **Consistent UX** - No repeated tenant selectors on each page
3. **Always accessible** - Visible in sidebar regardless of current page

**Usage in pages:**
```tsx
import { useActiveTenantId, useTenantSelection } from '@/components/ui/tenant-selector';

function AdminPage() {
  const { data: session } = useSession();
  const isSuperAdmin = session?.isSuperAdmin ?? false;

  // Get tenant selection from centralized store
  const { selectedTenantId, selectedTenantName } = useTenantSelection();

  // Get active tenant (session tenant for normal users, store value for SUPER_ADMIN)
  const activeTenantId = useActiveTenantId(isSuperAdmin, session?.tenantId);

  // Fetch data using activeTenantId
  const { data } = useQuery({
    queryKey: ['resource', activeTenantId],
    queryFn: () => fetchData(activeTenantId),
    enabled: !!activeTenantId,
  });

  return <div>...</div>;
}
```

### Empty States for SUPER_ADMIN

When SUPER_ADMIN hasn't selected a tenant, show an appropriate empty state directing them to the sidebar:

```tsx
{session?.isSuperAdmin && !activeTenantId && (
  <div className="flex flex-col items-center justify-center py-12 text-text-muted">
    <IconName className="w-12 h-12 mb-3 opacity-50" />
    <p className="text-sm">Please select a tenant from the sidebar to view resources</p>
  </div>
)}
```

---

## Reusable Components

Located in `src/components/ui/`. These components use **Chakra UI** primitives with custom styling to match the Oakcloud design system.

### Core Components

| Component | Props | Description |
|-----------|-------|-------------|
| `Button` | `variant`, `size`, `isLoading`, `iconOnly`, `leftIcon`, `rightIcon` | Chakra-based button with oak theme |
| `FormInput` | `label`, `error`, `hint`, `inputSize`, `leftIcon`, `rightIcon`, `type` | Chakra Input with validation (supports type="date") |
| `Alert` | `variant`, `title`, `compact`, `onClose` | Chakra Box-based notifications |
| `Modal` | `isOpen`, `onClose`, `title`, `size`, `closeOnEscape` | Accessible modal dialog |
| `ConfirmDialog` | `title`, `description`, `variant`, `requireReason` | Confirmation dialog with optional reason input |
| `Dropdown` | Composable: `Trigger`, `Menu`, `Item`, `align` | Portal-rendered dropdown (prevents clipping in tables) |
| `Pagination` | `page`, `totalPages`, `total`, `limit`, `onPageChange`, `onLimitChange`, `showJumpToPage` | Table pagination with page size selector and jump-to-page input |
| `Checkbox` | `indeterminate`, `label`, `description`, `size` | Checkbox with indeterminate state for bulk selection |
| `DatePicker` | `value`, `onChange`, `placeholder`, `size`, `label`, `disabled` | Date/range picker with presets (see Filter Components) |
| `SingleDateInput` | `value`, `onChange`, `label`, `minDate`, `maxDate`, `showTodayButton` | Typed single date with calendar popover; `showTodayButton` adds a "Today" button beside the field (Singapore date), off by default and on in document generation Configure |
| `SearchableSelect` | `options`, `value`, `onChange`, `placeholder`, `clearable`, `size` | Searchable dropdown with keyboard navigation |
| `AmountFilter` | `value`, `onChange`, `placeholder`, `size`, `className` | Numeric filter with single/range modes (see Filter Components) |
| `FilterPillGroup` | `options`, `value`, `onChange`, `label`, `allowSelectAll`, `allowEmpty` | Multi-select filter pills (see Filter Components) |
| `FilterPillToggle` | `label`, `active`, `onChange`, `icon` | Single toggleable filter pill |
| `FilterChip` | `label`, `value`, `onRemove` | Active filter indicator with remove button |
| `ActiveFilterBar` | `filters`, `onClearAll` | Row of `FilterChip`s with a Clear all link; renders nothing when no filter is set |

### Form Utilities

| Hook | Props | Description |
|------|-------|-------------|
| `useUnsavedNavigationGuard` | `isDirty`, dialog copy | Warns in the app's dialog before in-app links, Back, or `requestNavigation`/`requestAction` leave a page with unsaved changes; closing the tab still uses the browser's own warning |
| `useConfirmDialog` | - | `await confirm({ title, description, confirmLabel, variant })` in place of `window.confirm`; render the returned `dialog` once |
| `useDebouncedSearch` | `value`, `onCommit`, `delayMs` | Search box draft that applies after typing pauses (300 ms, `SEARCH_DEBOUNCE_MS`) |
| `useUrlListParams` | `basePath`, module-level `UrlParamSpec`, optional `parse` | List state read from and written to the URL; `updateParams(patch)` goes back to page 1 unless the patch sets `page` |

Never use `window.confirm` or `alert`; use `ConfirmDialog`, `useConfirmDialog`, or the unsaved-changes guard.

**Usage:**
```tsx
import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';

function EditForm() {
  const { formState: { isDirty, isSubmitting } } = useForm();
  // Disabled while submitting so the success redirect is not blocked
  const navigationGuard = useUnsavedNavigationGuard(isDirty && !isSubmitting);

  return (
    <form>
      ...
      <Button onClick={() => navigationGuard.requestNavigation('/contacts')}>Cancel</Button>
      {navigationGuard.dialog}
    </form>
  );
}
```

### Utility Components

| Component | Props | Description |
|-----------|-------|-------------|
| `Toast` | Via `useToast()` hook | Toast notifications (success, error, warning, info) |
| `Sidebar` | - | Responsive navigation with mobile drawer and theme toggle |
| `AuthGuard` | - | Route protection wrapper |
| `ErrorBoundary` | `fallback`, `onError` | React error boundary with fallback UI |
| `ThemeProvider` | - | Theme context provider, applies theme class to document |
| `ThemeToggle` | `variant` | Theme switcher (button or dropdown variant) |
| `SidebarTenantButton` | `collapsed` | Sidebar button for SUPER_ADMIN tenant selection (opens modal) |
| `useTenantSelection` | - | Hook to access centralized tenant selection state |
| `useActiveTenantId` | `isSuperAdmin`, `sessionTenantId` | Hook to get active tenant (store value for SUPER_ADMIN, session for others) |
| `AIModelSelector` | `value`, `onChange`, `showContextInput`, `showStandardContexts`, etc. | AI model selection with optional context input |
| `RichTextEditor` | `value`, `onChange`, `placeholder`, `minHeight`, `autofocus` | TipTap-based rich text editor |
| `RichTextDisplay` | `content`, `className` | XSS-safe HTML renderer (DOMPurify sanitization) |
| `PrefetchLink` | `href`, `prefetchType`, `prefetchId`, ...LinkProps | Link with data prefetching on hover |

### Table Pagination Guidelines

**All table views MUST include the Pagination component** with both page navigation and page size selector.

#### Required Implementation Pattern

```tsx
// 1. Add state for pagination
const [page, setPage] = useState(1);
const [limit, setLimit] = useState(20);

// 2. Use in API query
const { data } = useData({ page, limit, ...filters });

// 3. Include Pagination component after table
{data && data.totalPages > 0 && (
  <div className="mt-4">
    <Pagination
      page={data.page}
      totalPages={data.totalPages}
      total={data.total}
      limit={data.limit}
      onPageChange={setPage}
      onLimitChange={(newLimit) => {
        setLimit(newLimit);
        setPage(1); // Reset to first page when changing limit
      }}
    />
  </div>
)}
```

#### Page Size Options

- Available options: **10, 20, 50, 100, 200**
- Default: **20** for most tables, **50** for audit logs
- Maximum API limit: **200** (enforced by Zod validation)

#### Pagination Component Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `page` | number | Yes | Current page number |
| `totalPages` | number | Yes | Total number of pages |
| `total` | number | Yes | Total number of records |
| `limit` | number | Yes | Current page size |
| `onPageChange` | (page: number) => void | Yes | Page change handler |
| `onLimitChange` | (limit: number) => void | No | Page size change handler |
| `showPageSize` | boolean | No | Show/hide page size selector (default: true) |

#### Display Rules

- Always show pagination when `totalPages > 0` (even for single page)
- Shows "Showing X to Y of Z results" with page size dropdown
- Page numbers with ellipsis for large page counts
- Previous/Next arrows disabled at boundaries

#### Pagination Button Styling

Pagination uses custom styling that aligns with the button hierarchy:

**Reference Implementation**: `src/components/ui/pagination.tsx`

| Element | Active State | Inactive State | Disabled State |
|---------|-------------|----------------|----------------|
| Page numbers | `bg-oak-primary text-white font-medium` | `text-text-primary hover:bg-background-tertiary` | N/A |
| Previous/Next | N/A | `text-text-primary hover:bg-background-tertiary` | `text-text-muted cursor-not-allowed` |
| Page size dropdown | N/A | `border-border-primary hover:border-oak-primary/50` | N/A |

```tsx
// Page number button styling
<button
  className={cn(
    'min-w-[32px] h-8 px-2 text-sm rounded-lg transition-colors',
    pageNum === page
      ? 'bg-oak-primary text-white font-medium'      // Active: primary color
      : 'text-text-primary hover:bg-background-tertiary'  // Inactive: ghost-like
  )}
  aria-current={pageNum === page ? 'page' : undefined}
>
  {pageNum}
</button>

// Previous/Next button styling
<button
  disabled={page === 1}
  className={cn(
    'flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors',
    page === 1
      ? 'text-text-muted cursor-not-allowed'          // Disabled state
      : 'text-text-primary hover:bg-background-tertiary'  // Enabled state
  )}
  aria-label="Previous page"
>
  <ChevronLeft className="w-4 h-4" />
  <span className="hidden sm:inline">Previous</span>
</button>
```

**Key Styling Guidelines:**
- **Active page**: Uses `bg-oak-primary text-white` to match primary button styling
- **Inactive pages**: Uses ghost-like styling with hover state (not actual `btn-ghost` class)
- **Disabled navigation**: Uses `text-text-muted cursor-not-allowed` for clear disabled state
- **Responsive text**: Previous/Next labels hidden on mobile with `hidden sm:inline`
- **Minimum width**: `min-w-[32px]` ensures consistent button sizing
- **Icon sizing**: `w-4 h-4` (16px) matches button size `sm` guidelines

#### Pagination Accessibility

- Use `aria-label` on Previous/Next buttons
- Use `aria-current="page"` on the active page button
- Disabled buttons use `disabled` attribute (not just styling)
- Page size `<select>` should have associated `<label>` with `htmlFor`

### Filter Components

Filter components for data tables. Located in `src/components/ui/`.

#### FilterPillGroup

Multi-select toggleable pills for filtering by categories. Pills use oak-primary (`#294d44`) when active.

```tsx
import { FilterPillGroup } from '@/components/ui/filter-pill';
import { Globe, Pencil } from 'lucide-react';

const SOURCE_OPTIONS = [
  { value: 'API', label: 'API', icon: <Globe className="w-3.5 h-3.5" /> },
  { value: 'MANUAL', label: 'Manual', icon: <Pencil className="w-3.5 h-3.5" /> },
];

const [sources, setSources] = useState(['API', 'MANUAL']); // All selected by default

<FilterPillGroup
  label="Sources"
  options={SOURCE_OPTIONS}
  value={sources}
  onChange={setSources}
  allowSelectAll={false}  // Hide "Select all" / "Deselect all" button
  allowEmpty={false}      // Prevent deselecting all (at least one must be selected)
/>
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `FilterPillOption[]` | required | Array of `{ value, label, icon? }` |
| `value` | `string[]` | required | Currently selected values |
| `onChange` | `(value: string[]) => void` | required | Selection change handler |
| `label` | `string` | - | Group label |
| `allowSelectAll` | `boolean` | `true` | Show "Select all" button when >2 options |
| `allowEmpty` | `boolean` | `false` | Allow deselecting all options |

**Styling:**
- Active: `bg-oak-primary text-white border-oak-primary`
- Inactive: `bg-background-secondary text-text-secondary border-border-primary`
- Pill shape: `rounded-full` with `px-3 py-1.5`

#### FilterPillToggle

Single toggleable filter pill for boolean filters.

```tsx
import { FilterPillToggle } from '@/components/ui/filter-pill';
import { Star } from 'lucide-react';

const [showFavorites, setShowFavorites] = useState(false);

<FilterPillToggle
  label="Favorites"
  active={showFavorites}
  onChange={setShowFavorites}
  icon={<Star className="w-3.5 h-3.5" />}
/>
```

#### FilterChip

Displays active filters with a remove button. Used to show current filter state.

```tsx
import { FilterChip } from '@/components/ui/filter-chip';

{currencyFilter && (
  <FilterChip
    label="Currency"
    value={currencyFilter}
    onRemove={() => setCurrencyFilter('')}
  />
)}
```

**Best Practice:** Show active filter chips inside a filter box with a border-top separator:
```tsx
{hasActiveFilters && (
  <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border-primary">
    <span className="text-xs text-text-muted">Active filters:</span>
    <FilterChip label="..." value="..." onRemove={() => {...}} />
  </div>
)}
```

#### DatePicker

Feature-rich date and range picker with presets, single date, and date range modes.

```tsx
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';

const [dateValue, setDateValue] = useState<DatePickerValue | undefined>();

<DatePicker
  value={dateValue}
  onChange={setDateValue}
  placeholder="Select date or range"
  size="sm"
/>
```

**Features:**
- **Presets tab**: Quick options (Last 7/30/90 days, This month, Last month, This year)
- **Custom presets**: Enter X days/months/years ago
- **Single Date tab**: Calendar for single date selection
- **Date Range tab**: Dual-month calendar with phase-based selection
- **Oak design system colors**: Uses `#294d44` for selected states (not default blue)

**DatePickerValue type:**
```typescript
type DatePickerValue =
  | { mode: 'single'; date: Date }
  | { mode: 'range'; range: { from?: Date; to?: Date } };
```

**Range Selection Behavior:**
- Click once to set start date (shows "Click to select start date")
- Click again to set end date (shows "Click to select end date")
- Clicking after a complete range starts a new selection
- Dates auto-swap if end date is before start date

#### SearchableSelect

Searchable dropdown with keyboard navigation and optional descriptions.

`SearchableSelect` (options already loaded) and `AsyncSearchSelect` (server search, used by `CompanySelect`, `ContactSearchSelect` and `AccountSearchSelect`) share `src/components/ui/select-popover.tsx`, so every picker behaves the same:

- The list stays attached to the control on scroll and resize, and opens above it when there is no room below.
- Up/Down, Home, End, Enter, Tab and Esc work the same way; the hint footer is shared.
- Loading shows a spinner with `role="status"`. A failed search shows "Couldn't load …" with Try again (`error` and `onRetry` on `AsyncSearchSelect`), never an empty list.
- Empty results read "No {noun} match your search"; nothing to choose reads "No {noun} available".
- The clear button is labelled "Clear {label}" when the picker has a label, otherwise "Clear selection".
- Search boxes debounce by `SEARCH_DEBOUNCE_MS` (300 ms).

Company pickers: use `CompanySelect` to choose any company in the workspace. It searches the server, so it is never capped at the first page of companies. Pass the current company as `pinned` (built with `toCompanySearchOption`) so its name shows before any search. Use `CompanySearchableSelect` only to pick from a list the page already has, such as the companies with e-signing envelopes. `CompanySelectorModal` is the sidebar's company scope chooser.

```tsx
import { SearchableSelect } from '@/components/ui/searchable-select';

const OPTIONS = [
  { value: 'USD', label: 'USD - US Dollar', description: 'United States' },
  { value: 'EUR', label: 'EUR - Euro', description: 'European Union' },
];

const [currency, setCurrency] = useState('');

<SearchableSelect
  options={OPTIONS}
  value={currency}
  onChange={setCurrency}
  placeholder="All Currencies"
  clearable
  size="sm"
/>
```

**Features:**
- Type-ahead search filtering
- Keyboard navigation (↑↓ arrows, Enter to select, Esc to close)
- Clear button (when `clearable={true}`)
- Portal-rendered popover (avoids clipping)
- Optional description line per option

#### AmountFilter

Currency-agnostic numeric filter with single value and range modes. Perfect for filtering amount columns in tables.

```tsx
import { AmountFilter, type AmountFilterValue } from '@/components/ui/amount-filter';

const [totalFilter, setTotalFilter] = useState<AmountFilterValue | undefined>();

<AmountFilter
  value={totalFilter}
  onChange={setTotalFilter}
  placeholder="All amounts"
  size="sm"
/>
```

**Features:**
- **Two modes**: Single value (exact match) or Range (min/max)
- **Currency-agnostic**: Works with raw numbers, ignores currency symbols
- **Auto-formatting**: Displays numbers with commas (1000 → 1,000)
- **Decimal support**: Handles decimal values (1000.50)
- **Keyboard navigation**: Enter to apply, Escape to close (global)
- **Portal-rendered**: Dropdown renders outside table DOM to avoid clipping
- **Smart positioning**: Automatically adjusts to viewport edges (opens left if no space on right, opens above if no space below)
- **Fixed dimensions**: Modal maintains consistent width when switching between modes to prevent UI shifts
- **Responsive**: Handles scroll, resize, and small viewports gracefully
- **Compact design**: Suitable for inline table filters

**AmountFilterValue type:**
```typescript
type AmountFilterValue =
  | { mode: 'single'; single: number }
  | { mode: 'range'; range: { from?: number; to?: number } };
```

**Display behavior:**
- Single value: Shows formatted number (e.g., "1,000")
- Range with both: Shows "min - max" (e.g., "1,000 - 5,000")
- Range with from only: Shows "≥ min" (e.g., "≥ 1,000")
- Range with to only: Shows "≤ max" (e.g., "≤ 5,000")

**Usage in table filters:**
```tsx
// In inline filter row
<th className="px-2 py-2">
  <AmountFilter
    value={params.totalFilter}
    onChange={(value) => handleFiltersChange({ totalFilter: value })}
    placeholder="All amounts"
    size="sm"
    className="text-xs"
  />
</th>
```

**URL parameter serialization:**
```typescript
// Single value mode
{ total: "1000" }

// Range mode
{ totalFrom: "1000", totalTo: "5000" }
```

**See also:** `src/components/ui/amount-filter.example.tsx` for integration examples.

#### Filter Layout Pattern

Standard filter layout for data tables:

```tsx
<div className="mb-6">
  <div className="p-4 bg-background-secondary border border-border-primary rounded-lg space-y-4">
    {/* Filter inputs row */}
    <div className="flex flex-wrap gap-4 items-end">
      <div className="w-96">
        <label className="label">Currency</label>
        <SearchableSelect ... />
      </div>
      <div className="w-80">
        <label className="label">Date</label>
        <DatePicker ... />
      </div>
      <FilterPillGroup label="Sources" ... />
      <FilterPillGroup label="Scope" ... />
    </div>

    {/* Active filter chips */}
    {hasActiveFilters && (
      <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-border-primary">
        <span className="text-xs text-text-muted">Active filters:</span>
        {/* FilterChip components */}
      </div>
    )}
  </div>
</div>
```

**Guidelines:**
- Filters always visible by default (no "Show/Hide Filters" toggle)
- No "Clear All Filters" button - users clear via individual filter chips
- Auto-apply filters on change (no "Apply" button needed)
- Use debounce (300ms) for text inputs to avoid excessive API calls

---

## Layout Guidelines

### Sidebar

- Width: `224px` (expanded), `56px` (collapsed)
- Nav items: `13px` font, `8px` vertical padding
- Logo: `28px` icon, `14px` text
- Icons: `18px`

### Page Content

- Main content: `ml-56` (224px left margin)
- Page padding: `p-4` to `p-6`
- Max content width: None (fluid)

### Cards & Sections

- Card padding: `p-3` (compact) to `p-4` (standard)
- Section gaps: `space-y-4` to `space-y-6`
- Border radius: `4px` (default), `6px` (cards, large buttons)

---

## Component Examples

### Button

```tsx
import { Button } from '@/components/ui/button';

// Standard button
<Button variant="primary" size="sm">Save</Button>

// With loading state
<Button isLoading>Saving...</Button>

// Icon button
<Button variant="ghost" size="sm" iconOnly leftIcon={<Plus />} />

// Danger action
<Button variant="danger" size="xs" leftIcon={<Trash />}>Delete</Button>
```

### FormInput

```tsx
import { FormInput } from '@/components/ui/form-input';

// Basic input
<FormInput label="Email" type="email" placeholder="you@example.com" />

// With icon and error
<FormInput
  label="Password"
  type="password"
  inputSize="md"
  leftIcon={<Lock />}
  error="Password is required"
/>
```

### Date Input

Use native HTML5 date inputs for date fields. These provide a consistent browser-native date picker experience.

```tsx
// Basic date input with label
<div>
  <label className="label">Date of Birth</label>
  <input
    type="date"
    value={dateValue}  // YYYY-MM-DD format
    onChange={(e) => setDateValue(e.target.value)}
    className="input input-sm"
  />
</div>

// With react-hook-form
<div>
  <label className="label">Incorporation Date</label>
  <input
    type="date"
    {...register('incorporationDate')}
    className="input input-sm"
  />
</div>

// With hint text
<div>
  <label className="label">Date of Cessation</label>
  <input
    type="date"
    value={cessationDate}
    onChange={(e) => setCessationDate(e.target.value)}
    className="input input-sm w-full"
  />
  <p className="text-xs text-text-muted mt-1">Leave empty if still active</p>
</div>
```

**Key Points:**
- Use `type="date"` for browser-native date picker
- Value format is always `YYYY-MM-DD` (ISO format)
- Use `input input-sm` classes for consistent styling
- Add `w-full` when in a flex/grid container for full width

### Alert

```tsx
import { Alert } from '@/components/ui/alert';

// Error alert
<Alert variant="error">Invalid credentials</Alert>

// Success with title
<Alert variant="success" title="Saved">Company updated successfully</Alert>

// Compact variant
<Alert variant="info" compact>Processing...</Alert>
```

### Modal & ConfirmDialog

```tsx
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// Basic modal
<Modal isOpen={isOpen} onClose={onClose} title="Edit Company">
  <ModalBody>Content here</ModalBody>
  <ModalFooter>
    <Button variant="secondary" onClick={onClose}>Cancel</Button>
    <Button variant="primary" onClick={onSave}>Save</Button>
  </ModalFooter>
</Modal>

// Delete confirmation with reason
<ConfirmDialog
  isOpen={isOpen}
  onClose={onClose}
  onConfirm={(reason) => handleDelete(reason)}
  title="Delete Company"
  description="This action cannot be undone."
  variant="danger"
  requireReason
  reasonMinLength={10}
/>
```

### Dropdown

```tsx
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/dropdown';

<Dropdown>
  <DropdownTrigger>Options</DropdownTrigger>
  <DropdownMenu>
    <DropdownItem icon={<Edit />} onClick={onEdit}>Edit</DropdownItem>
    <DropdownItem icon={<Trash />} destructive onClick={onDelete}>Delete</DropdownItem>
  </DropdownMenu>
</Dropdown>
```

#### Form Option Presets

The Forms list places a compact **Preset lists** secondary action beside **New Form**. Its modal owns the create, CSV preview, replace, and delete workflows so large controlled vocabularies do not inflate form-save payloads.

- Accept UTF-8 CSV with either `label` or `value,label` headers and show detected columns, accepted/rejected counts, row errors, and a short sample before saving.
- Keep Countries, Nationalities, and SSIC visibly marked as protected. Countries and Nationalities cannot be replaced; SSIC can be replaced but not deleted.
- Require confirmation before replacement because linked dropdowns receive the new values immediately.
- Disable deletion while a custom preset is linked to an active or archived form and show the usage count in context.
- When a linked dropdown switches to Custom, copy the currently resolved options into the field before removing the link.
- Respondent dropdown fields are clearable unless read-only. Required fields may still be cleared, then show their normal required validation on blur or submit. Phone and timezone selectors remain non-clearable.

#### Form URL Information Fields

- URL information fields offer the same **Plain text style** toggle as text information fields. Plain style removes the bordered background in both the public web form and generated submission PDF while preserving the clickable link.
- Broken-link warnings are backend-only operational guidance. Show a compact warning on the authenticated Forms list and beside the affected field in the builder; never expose URL health state to public respondents.
- Activate the warning only after two consecutive definite failures. Clear it after a healthy result, and leave the current warning/failure count unchanged for unverifiable 401, 403, or 429 responses.
- Warning copy should identify the affected field and last check result without blocking form publication, editing, or submission.

### Toast

```tsx
import { useToast } from '@/components/ui/toast';

function MyComponent() {
  const { success, error, warning, info } = useToast();

  const handleSave = async () => {
    try {
      await saveData();
      success('Data saved successfully');
    } catch (err) {
      error('Failed to save data');
    }
  };
}
```

### Tenant Selection (Centralized)

Tenant selection for SUPER_ADMIN is centralized in the sidebar via Zustand store with localStorage persistence.

**Store (`src/stores/tenant-store.ts`):**
```tsx
interface TenantSelectionState {
  selectedTenantId: string;
  selectedTenantName: string | null;
  setSelectedTenant: (tenantId: string, tenantName?: string) => void;
  clearSelectedTenant: () => void;
}
```

**Hooks (`src/components/ui/tenant-selector.tsx`):**
```tsx
import { useActiveTenantId, useTenantSelection } from '@/components/ui/tenant-selector';

function AdminPage() {
  const { data: session } = useSession();
  const isSuperAdmin = session?.isSuperAdmin ?? false;

  // Access centralized tenant selection
  const { selectedTenantId, selectedTenantName, setSelectedTenant, clearSelectedTenant } = useTenantSelection();

  // Get active tenant (store value for SUPER_ADMIN, session tenant for others)
  const activeTenantId = useActiveTenantId(isSuperAdmin, session?.tenantId);

  // Use activeTenantId for all tenant-scoped operations
  useEffect(() => {
    if (activeTenantId) {
      fetchDataForTenant(activeTenantId);
    }
  }, [activeTenantId]);

  // Show empty state if SUPER_ADMIN hasn't selected a tenant
  if (isSuperAdmin && !activeTenantId) {
    return (
      <div className="text-center py-12">
        <p>Please select a tenant from the sidebar</p>
      </div>
    );
  }

  return <div>...</div>;
}
```

**Sidebar Integration:**
The `SidebarTenantButton` component is automatically rendered in the sidebar for SUPER_ADMIN users, positioned above the theme toggle. When clicked, it opens `TenantSelectorModal` for tenant selection.

---

## Best Practices

### CSS Utility Classes vs React Components

The application uses both CSS utility classes (in `globals.css`) and React components. Understanding when to use each approach ensures consistency.

#### When to Use React Components

**Prefer React components for:**
- **Interactive elements**: Button, Input, Modal, Dropdown, Toast
- **State management**: Components with open/closed, selected, disabled states
- **Props/variants**: When you need size, variant, or other props
- **Composition**: Components that wrap children or other components
- **Accessibility**: Components that manage ARIA attributes, focus, keyboard navigation

**Examples:**
```tsx
// ✅ Good: Using React Button component with variants
<Button size="md" variant="primary" onClick={handleSave}>
  Save Changes
</Button>

// ✅ Good: Using FormInput with validation state
<FormInput
  label="Email"
  type="email"
  error={errors.email}
  required
/>

// ✅ Good: Modal with state management
<Modal isOpen={isOpen} onClose={onClose}>
  <ModalHeader>Edit Company</ModalHeader>
  <ModalBody>{/* Content */}</ModalBody>
</Modal>
```

#### When to Use CSS Utility Classes

**Prefer CSS utility classes for:**
- **Layout containers**: Cards, sections, grids
- **Static elements**: Dividers, headings, text blocks
- **Simple styling**: Background colors, borders, spacing
- **Performance**: Avoid component overhead for simple elements

**Examples:**
```tsx
// ✅ Good: Using card CSS class for layout
<div className="card p-4">
  <h3 className="section-title mb-3">Recent Activity</h3>
  <div className="space-y-2">{/* Content */}</div>
</div>

// ✅ Good: Using divider class
<hr className="divider" />

// ✅ Good: Using badge CSS classes
<span className="badge badge-success">Active</span>
```

#### Mixing Both Approaches

You can combine React components with CSS classes for styling:

```tsx
// ✅ Good: Button component with additional CSS classes
<Button
  size="md"
  variant="primary"
  className="w-full mt-4"  // Tailwind utilities for layout
>
  Submit
</Button>

// ✅ Good: Card container with FormInput component
<div className="card p-4">
  <FormInput label="Name" />
  <FormInput label="Email" />
</div>
```

#### Component vs CSS Class Reference

| Feature | React Component | CSS Class |
|---------|----------------|-----------|
| **Buttons** | `<Button>` | `.btn-*` (deprecated) |
| **Inputs** | `<FormInput>` | `.input` (for custom inputs only) |
| **Cards** | N/A | `.card`, `.card-compact` |
| **Alerts** | `<Alert>` component recommended | `.alert` (deprecated) |
| **Badges** | `<Badge>` | `.badge` (for simple cases) |
| **Modals** | `<Modal>` | N/A |
| **Tables** | N/A | `.table`, `.table-compact` |
| **Navigation** | N/A | `.nav-item`, `.nav-item-active` |

#### Deprecation Status

Some CSS classes in `globals.css` are **deprecated** in favor of React components:

**Deprecated (use React component instead):**
- `.btn-xs`, `.btn-sm`, `.btn-md`, `.btn-lg` → Use `<Button size="xs|sm|md|lg">`
- `.alert-*` variants → Use `<Alert variant="success|warning|error|info">`

**Reason**: React components provide better state management, accessibility, and consistency. CSS classes were used before components existed.

**Still Valid:**
- `.card`, `.card-compact` → No React component needed (simple containers)
- `.table`, `.table-compact` → Tables are semantic HTML, CSS classes appropriate
- `.nav-item`, `.nav-item-active` → Navigation is simple, CSS classes sufficient
- `.divider`, `.section-title` → Static elements, no component needed

#### Migration Path

If you encounter deprecated CSS classes in existing code:

1. **Buttons**: Replace `.btn-*` with `<Button>` component
2. **Alerts**: Replace `.alert-*` with `<Alert>` component
3. **Keep**: `.card`, `.table`, `.nav-item` classes (not deprecated)

**Example Migration:**
```tsx
// ❌ Old: Using deprecated CSS classes
<button className="btn btn-primary btn-md">
  Save
</button>

// ✅ New: Using React component
<Button size="md" variant="primary">
  Save
</Button>
```

### Number Input Fields (Controlled Components)

When using controlled number inputs with `useState`, store the value as a **string** and convert to number only on form submission. This prevents the input from reverting to its default value when the user clears the field.

```typescript
// BAD: Value reverts immediately when field is cleared
const [maxUsers, setMaxUsers] = useState(50);

<input
  type="number"
  value={maxUsers}
  onChange={(e) => setMaxUsers(parseInt(e.target.value) || 50)}
/>

// GOOD: Store as string, parse on submit
const [maxUsers, setMaxUsers] = useState('50');

<input
  type="number"
  value={maxUsers}
  onChange={(e) => setMaxUsers(e.target.value)}
/>

// On form submit:
const handleSubmit = () => {
  const data = {
    maxUsers: parseInt(maxUsers) || 50,  // Apply default here
  };
};
```

**Note**: This issue doesn't apply when using `react-hook-form` with `{ valueAsNumber: true }`, which handles the conversion correctly.

### Currency Formatting

All currency amounts must be displayed using consistent formatting across the application.

**Singapore Dollar Display:**
- Singapore Dollar (SGD) is displayed as **"S$"** (e.g., "S$1,234.56")
- This applies globally to all currency displays in the application

**Other Currency Symbols:**

| Currency | Symbol | Example |
|----------|--------|---------|
| SGD | S$ | S$1,234.56 |
| USD | US$ | US$1,234.56 |
| EUR | € | €1,234.56 |
| GBP | £ | £1,234.56 |
| JPY | ¥ | ¥1,234 |
| CNY | ¥ | ¥1,234.56 |
| HKD | HK$ | HK$1,234.56 |
| AUD | A$ | A$1,234.56 |
| MYR | RM | RM1,234.56 |
| THB | ฿ | ฿1,234.56 |
| IDR | Rp | Rp1,234 |
| PHP | ₱ | ₱1,234.56 |
| INR | ₹ | ₹1,234.56 |
| KRW | ₩ | ₩1,234 |
| TWD | NT$ | NT$1,234.56 |
| VND | ₫ | ₫1,234 |

**Implementation:**

Use the `formatCurrency` utility from `@/lib/utils`:

```tsx
import { formatCurrency } from '@/lib/utils';

// Basic usage (defaults to SGD)
formatCurrency(1234.56)           // "S$1,234.56"
formatCurrency(1234.56, 'SGD')    // "S$1,234.56"
formatCurrency(1234.56, 'USD')    // "US$1,234.56"
formatCurrency(-1234.56, 'SGD')   // "(S$1,234.56)" - negatives in parentheses
formatCurrency(null)              // "-"
```

**For inline formatCurrency functions** (in components that don't import from utils), use the `CURRENCY_SYMBOLS` constant:

```tsx
const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: 'S$',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  // ... other currencies
};

const formatCurrency = (amount: string | number | null, currency: string) => {
  if (!amount) return '-';
  const num = parseFloat(String(amount));
  if (isNaN(num)) return '-';

  const formatted = new Intl.NumberFormat('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(num));

  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return num < 0 ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
};
```

**Key Points:**
- Always use 2 decimal places for most currencies (JPY, KRW, IDR, VND may use 0)
- Negative amounts are displayed with parentheses: `(S$1,234.56)`
- Use Singapore locale (`en-SG`) for consistent thousand separators
- Null/undefined amounts display as `-`

---

## Mobile Responsiveness

The application is designed mobile-first with responsive breakpoints. All components and pages should work seamlessly from 320px to desktop widths.

### Breakpoints

| Breakpoint | Width | Usage |
|------------|-------|-------|
| Base (mobile) | < 640px | Single column, stacked layouts |
| `sm:` | 640px+ | Minor adjustments, 2-column grids |
| `md:` | 768px+ | Switch from cards to tables |
| `lg:` | 1024px+ | Full desktop layouts, 4-column grids |

### Touch Targets

All interactive elements must have a minimum touch target of **44x44px** on mobile for accessibility:

```tsx
// Mobile touch target pattern
className="p-2 sm:p-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0"
```

### Responsive Grid Patterns

Always use mobile-first grid definitions:

```tsx
// Stats cards - single column on mobile, expand on larger screens
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">

// Form fields - stack on mobile, side-by-side on desktop
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

// Three-column content
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
```

### Responsive Padding

Reduce padding on mobile to maximize content area:

```tsx
// Page padding
className="p-4 sm:p-6"

// Card padding
className="p-3 sm:p-4"

// Large padding areas
className="p-6 sm:p-12"
```

### Mobile Card View for Tables

Tables with many columns should show a **card view on mobile** and table on desktop. Use the reusable components:

```tsx
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';

// Pattern: Cards on mobile, table on desktop
return (
  <>
    {/* Mobile Card View */}
    <div className="md:hidden space-y-3">
      {items.map((item) => (
        <MobileCard
          key={item.id}
          title={<Link href={`/items/${item.id}`}>{item.name}</Link>}
          subtitle={item.code}
          badge={<span className="badge badge-success">{item.status}</span>}
          actions={<ActionsDropdown itemId={item.id} />}
          details={
            <CardDetailsGrid>
              <CardDetailItem label="Type" value={item.type} />
              <CardDetailItem label="Date" value={formatDate(item.date)} />
              <CardDetailItem label="Description" value={item.description} fullWidth />
            </CardDetailsGrid>
          }
        />
      ))}
    </div>

    {/* Desktop Table View */}
    <div className="hidden md:block table-container">
      <table className="table">...</table>
    </div>
  </>
);
```

### Modal Responsiveness

Modals automatically adjust width on mobile using `max-w-[calc(100vw-2rem)]`:

```tsx
// Modal sizes are mobile-responsive by default
<Modal size="lg">  // Full width on mobile, 512px on sm+
<Modal size="2xl"> // Full width on mobile, 672px on sm+
```

### Component-Specific Patterns

| Component | Mobile Pattern |
|-----------|----------------|
| Sidebar | Drawer overlay with hamburger menu |
| Toast | Full width, bottom positioned |
| Date picker | Responsive calendar popup |
| Dropdown | Touch-friendly item heights |
| Checkbox | 44px touch target wrapper |
| Stepper | Smaller labels, shorter connectors |
| Stats sections | Collapsible by default (MobileCollapsibleSection) |
| Data tables | Card view with MobileCard component |
| Date inputs | Browser-native date picker |

### Empty State Padding

Reduce empty state padding on mobile:

```tsx
<div className="card p-6 sm:p-12 text-center">
  <Icon className="w-12 h-12 text-text-muted mx-auto mb-4" />
  <h3>No items found</h3>
</div>
```

### Collapsible Sections for Mobile

Dashboard pages often have statistics cards that take up valuable screen real estate on mobile. Use `MobileCollapsibleSection` to collapse these by default on mobile while keeping them always visible on desktop.

```tsx
import { MobileCollapsibleSection } from '@/components/ui/collapsible-section';

// Stats are collapsed by default on mobile, always visible on desktop
<MobileCollapsibleSection title="Statistics" count={4} className="mb-6">
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
    <div className="card p-3 sm:p-4">...</div>
    <div className="card p-3 sm:p-4">...</div>
    <div className="card p-3 sm:p-4">...</div>
    <div className="card p-3 sm:p-4">...</div>
  </div>
</MobileCollapsibleSection>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | required | Section header text |
| `count` | `number` | - | Optional badge showing item count |
| `defaultCollapsed` | `boolean` | `true` | Initial collapsed state on mobile |
| `className` | `string` | - | Container class (e.g., `mb-6`) |
| `contentClassName` | `string` | - | Content wrapper class |

**Behavior:**
- **Mobile**: Shows toggle header with Show/Hide button; collapsed by default
- **Desktop**: Toggle header hidden; content always visible

For sections that need full collapse/expand control on all screen sizes, use `CollapsibleSection` instead:

```tsx
import { CollapsibleSection } from '@/components/ui/collapsible-section';

<CollapsibleSection
  title="Advanced Options"
  defaultCollapsedMobile={true}
  defaultCollapsedDesktop={false}
>
  {/* Content */}
</CollapsibleSection>
```

In side panels (such as the OakDoc field panel) use `variant="panel"`: a small uppercase title with a chevron on an Oaktree green bar, and no Show/Hide text. `info` puts help text behind an information icon beside the title (the shared `InfoTip` component, also used beside sub-headers in place of hint lines). `action` puts a control such as a New button on the bar (style it white, e.g. `text-white hover:bg-white/15`), and `collapsed` with `onCollapsedChange` lets the parent open every group while a search is active.

### Mobile Card View Components

For tables with many columns, display cards on mobile and tables on desktop. Use the reusable components from `responsive-table.tsx`:

#### MobileCard

A card component for displaying list items on mobile:

```tsx
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';

<MobileCard
  title={<Link href={`/items/${item.id}`}>{item.name}</Link>}
  subtitle={item.code}
  badge={<span className="badge badge-success">{item.status}</span>}
  actions={<ActionsDropdown itemId={item.id} />}
  selectable={true}
  isSelected={selectedIds.has(item.id)}
  onToggle={() => toggleSelection(item.id)}
  details={
    <CardDetailsGrid>
      <CardDetailItem label="Type" value={item.type} />
      <CardDetailItem label="Date" value={formatDate(item.date)} />
      <CardDetailItem label="Description" value={item.description} fullWidth />
    </CardDetailsGrid>
  }
/>
```

**MobileCard Props:**

| Prop | Type | Description |
|------|------|-------------|
| `title` | `ReactNode` | Primary content (usually a link) |
| `subtitle` | `ReactNode` | Secondary text below title |
| `badge` | `ReactNode` | Status badge (top right) |
| `actions` | `ReactNode` | Action menu (top right, after badge) |
| `details` | `ReactNode` | Additional content below header |
| `selectable` | `boolean` | Show selection checkbox |
| `isSelected` | `boolean` | Current selection state |
| `onToggle` | `() => void` | Selection toggle handler |

#### CardDetailsGrid & CardDetailItem

Grid layout for additional card details:

```tsx
<CardDetailsGrid>
  <CardDetailItem label="Email" value={contact.email} fullWidth />
  <CardDetailItem label="Phone" value={contact.phone} />
  <CardDetailItem
    label="Companies"
    value={
      <div className="flex items-center gap-1.5">
        <Building2 className="w-3.5 h-3.5" />
        <span>{count}</span>
      </div>
    }
  />
</CardDetailsGrid>
```

**CardDetailItem Props:**

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string` | Field label (muted text) |
| `value` | `ReactNode` | Field value |
| `fullWidth` | `boolean` | Span both columns |

#### Complete Table/Card Pattern

```tsx
return (
  <>
    {/* Mobile Card View */}
    <div className="md:hidden space-y-3">
      {selectable && (
        <div className="flex items-center gap-2 px-1">
          <button onClick={onToggleAll} className="p-2 ...">
            {isAllSelected ? <CheckSquare /> : <Square />}
            <span>{isAllSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
        </div>
      )}
      {items.map((item) => (
        <MobileCard
          key={item.id}
          title={...}
          subtitle={...}
          badge={...}
          actions={...}
          details={...}
          selectable={selectable}
          isSelected={selectedIds.has(item.id)}
          onToggle={() => onToggleOne(item.id)}
        />
      ))}
    </div>

    {/* Desktop Table View */}
    <div className="hidden md:block table-container">
      <table className="table">
        <thead>...</thead>
        <tbody>...</tbody>
      </table>
    </div>
  </>
);
```

### File Reference

Mobile-responsive components are located at:

```
src/components/ui/
├── collapsible-section.tsx # MobileCollapsibleSection, CollapsibleSection
├── responsive-table.tsx    # MobileCard, CardDetailsGrid, CardDetailItem
├── Sidebar.tsx             # Mobile drawer with hamburger menu
├── modal.tsx               # Mobile-responsive sizing
├── toast.tsx               # Mobile-positioned toasts
└── ...
```

---

## File Structure

```
src/components/ui/
├── alert.tsx               # Alert/notification component
├── ai-model-selector.tsx   # AI model selection with context
├── button.tsx              # Button component with variants
├── checkbox.tsx            # Checkbox with indeterminate state
├── collapsible-section.tsx # Collapsible sections (MobileCollapsibleSection, CollapsibleSection)
├── confirm-dialog.tsx      # Confirmation dialog with reason
├── dropdown.tsx            # Portal-rendered dropdown menu
├── form-input.tsx          # Form input with validation
├── modal.tsx               # Accessible modal dialog
├── pagination.tsx          # Table pagination component
├── responsive-table.tsx    # Mobile card view components (MobileCard, CardDetailsGrid)
├── Sidebar.tsx             # Responsive navigation sidebar with mobile drawer
├── stepper.tsx             # Multi-step wizard component
├── tenant-selector.tsx     # Tenant selection (SidebarTenantButton, hooks, modal)
├── theme-toggle.tsx        # Theme switcher component
└── toast.tsx               # Toast notification system

src/stores/
├── ui-store.ts            # Zustand UI state (sidebar, theme)
└── tenant-store.ts        # SUPER_ADMIN tenant selection (persisted)

src/hooks/
├── use-unsaved-navigation-guard.tsx # App dialog before leaving with unsaved changes
└── ...                    # Other application hooks
```
