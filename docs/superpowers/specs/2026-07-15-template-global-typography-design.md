# Template Global Typography Design

## Status

Approved for implementation planning on 2026-07-15.

## Objective

Add a global font-family and font-size default to document templates. The
settings appear with the existing page-layout controls and apply consistently
to newly entered, unformatted text throughout template editing, document
generation, preview, print, and PDF export. Reusable partials inherit the
containing template's typography and page layout while preserving deliberate
inline formatting.

## Scope

This change covers:

- Global font and font-size selectors in the template panel's Page layout card.
- Persistence in the existing versioned document-layout metadata.
- Backward-compatible defaults for templates and generated documents that do
  not contain typography metadata.
- Consistent typography during editor pagination, generated-document editing,
  preview, print, and PDF export.
- Typography and page-layout inheritance by partial content resolved into a
  template.
- Immediate repagination when a global typography setting changes.

This change does not add custom web-font uploads, arbitrary font names, a
database migration, or global typography controls to the partial editor.
Explicit inline font-family and font-size formatting remains authoritative.

## User Experience

The existing Page layout card gains two selectors above Line spacing and
Paragraph spacing:

- **Global font** uses the editor toolbar's existing portable font list: Arial,
  Times New Roman, Courier New, Georgia, Verdana, Trebuchet MS, and Lucida
  Console.
- **Font size** uses the toolbar's existing sizes from 8pt through 36pt.

Changing either setting updates the document immediately, marks the template
as unsaved, and repaginates the document because font metrics can change page
breaks. The controls use the existing compact select styling and accessible
labels.

## Layout Model and Persistence

Extend the existing `A4DocumentLayout` model rather than introducing a second
typography object:

```ts
interface A4DocumentLayout {
  version: 1;
  fontFamily: string;
  fontSize: string;
  lineHeight: number;
  paragraphSpacing: string;
  marginsMm: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}
```

The current metadata version remains `1`. Normalization accepts version-1
layout objects that lack the new properties and supplies the current rendered
defaults, `Arial, Helvetica, sans-serif` and `11pt`. Font family and size are
restricted to the shared toolbar allowlists so stored values cannot inject CSS
and all supported rendering environments use predictable fallbacks.

Saving continues to merge layout metadata into `DocumentTemplate.contentJson`
without discarding unrelated keys. Generated documents continue to inherit the
template's complete `contentJson` when the generation workflow does not supply
an edited override.

## Rendering and Partial Inheritance

All document rendering paths consume the normalized layout values:

1. The editor's visible page surface uses the global font and base size.
2. The hidden pagination measurer uses the same values before calculating page
   breaks.
3. Template preview and generated-document editing receive the same layout.
4. Browser print and server-side PDF CSS use the normalized font and base size.

Partials remain stored as reusable HTML fragments and are expanded into the
parent template before placeholder resolution. Unformatted partial content
therefore inherits the containing document's font family, font size, line
height, paragraph spacing, and margins from the parent page surface and print
stylesheet. A partial does not own page-layout metadata and cannot change the
containing document's margins.

Inline `font-family` or `font-size` declarations authored deliberately in a
template or partial continue to override the inherited defaults. Semantic
headings inherit the global font family while retaining their existing heading
sizes; ordinary unformatted text inherits both global settings.

## Shared Options

Move or expose the existing toolbar font and size options through one shared
document-typography module. The toolbar and template panel consume the same
values and labels so local formatting choices and global defaults cannot drift.
Normalization uses the same allowlists.

## Error Handling and Compatibility

- Missing typography metadata falls back to Arial 11pt.
- Unsupported or malformed stored typography values fall back independently;
  valid line spacing and margin values remain intact.
- Existing version-1 layout objects load without migration.
- Existing uncontrolled `A4PageEditor` callers retain their current defaults.
- Explicit inline formatting remains unchanged during save, partial expansion,
  and rendering.

## Testing Strategy

### Unit tests

- Normalize missing, valid, and unsupported font-family and font-size values.
- Merge typography with layout metadata without losing unrelated
  `contentJson` keys.
- Compare layouts including the new typography properties.
- Build print and PDF CSS with normalized font and size values.

### Component tests

- Render both selectors with the shared option lists.
- Emit layout updates when either selector changes.
- Apply global typography to the visible page and pagination measurer.
- Repaginate when font family or size changes.
- Preserve explicit inline formatting while unformatted resolved partial
  content inherits the parent defaults.
- Pass the selected layout through generated-document preview and editing.

### Regression verification

- Existing templates without typography metadata still render as Arial 11pt.
- Page margins, line spacing, paragraph spacing, partial resolution, preview,
  print, and export continue to work.
- Focused tests, TypeScript, ESLint, and the production build pass without new
  warnings or errors.

## Acceptance Criteria

- The Template panel displays Global font and Font size within Page layout.
- Both selectors reuse the editor toolbar's existing options.
- Changes survive save and reload and immediately update pagination.
- Newly keyed, unformatted template text uses the selected defaults.
- Unformatted partial content follows the parent template's typography and page
  layout.
- Explicit inline font and size formatting remains intact.
- Editor, generated-document editor, preview, print, and PDF export agree on
  the normalized global settings.
- Existing templates and generated documents require no migration and retain
  their current Arial 11pt appearance.
