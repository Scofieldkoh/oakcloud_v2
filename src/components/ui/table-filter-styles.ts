/**
 * Canonical visual contract for inline table filter controls.
 *
 * Feature components may keep their own behaviour/popovers, but the visible
 * control should use these tokens whenever variant="table-filter" is active.
 */
export const TABLE_FILTER_CONTROL_HEIGHT_CLASS = 'h-9 min-h-9';

export const TABLE_FILTER_CONTROL_SURFACE_CLASS =
  'rounded-lg border border-border-primary bg-background-secondary/30 transition-colors hover:border-oak-primary/50';

export const TABLE_FILTER_CONTROL_FOCUS_CLASS =
  'focus-within:border-oak-primary focus-within:ring-2 focus-within:ring-oak-primary/30';

export const TABLE_FILTER_TRIGGER_FOCUS_CLASS =
  'focus:outline-none focus-visible:border-oak-primary focus-visible:ring-2 focus-visible:ring-oak-primary/30';

export const TABLE_FILTER_TEXT_CLASS =
  'text-xs font-normal text-text-primary';

export const TABLE_FILTER_PLACEHOLDER_CLASS =
  'placeholder:text-text-muted placeholder:font-normal';

export const TABLE_FILTER_PLACEHOLDER_TEXT_CLASS =
  'text-xs font-normal text-text-muted';

export const TABLE_FILTER_INPUT_CLASS =
  `${TABLE_FILTER_CONTROL_HEIGHT_CLASS} w-full min-w-0 px-3 ${TABLE_FILTER_TEXT_CLASS} ${TABLE_FILTER_PLACEHOLDER_CLASS}`;

export const TABLE_FILTER_CONTAINER_CLASS =
  `${TABLE_FILTER_CONTROL_HEIGHT_CLASS} w-full min-w-0 ${TABLE_FILTER_CONTROL_SURFACE_CLASS} ${TABLE_FILTER_CONTROL_FOCUS_CLASS}`;

export const TABLE_FILTER_TRIGGER_CLASS =
  `${TABLE_FILTER_CONTROL_HEIGHT_CLASS} w-full min-w-0 px-3 ${TABLE_FILTER_CONTROL_SURFACE_CLASS} ${TABLE_FILTER_TRIGGER_FOCUS_CLASS} ${TABLE_FILTER_TEXT_CLASS}`;


export const TABLE_FILTER_NATIVE_INPUT_CLASS =
  `${TABLE_FILTER_CONTROL_HEIGHT_CLASS} w-full min-w-0 rounded-lg border border-border-primary bg-background-secondary/30 px-3 ${TABLE_FILTER_TEXT_CLASS} ${TABLE_FILTER_PLACEHOLDER_CLASS} transition-colors hover:border-oak-primary/50 focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30`;
