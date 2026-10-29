'use client';

import { FormInput } from '@/components/ui/form-input';
import { Button } from '@/components/ui/button';

const DEFAULT_PICKER_COLOR = '#1F2937';

export function FormPanelAppearanceFields({
  panelOpacity,
  headingColor,
  onPanelOpacityChange,
  onHeadingColorChange,
}: {
  panelOpacity: number;
  headingColor: string | null;
  onPanelOpacityChange: (opacity: number) => void;
  onHeadingColorChange: (color: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-secondary">Field panel opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={panelOpacity}
          onChange={(event) => onPanelOpacityChange(Number(event.target.value))}
          className="w-full"
          aria-label="Field panel opacity"
        />
        <span className="mt-0.5 block text-2xs text-text-muted">
          {panelOpacity}%. Lower it to let the background show through the white panels that hold the fields.
        </span>
      </label>

      <div>
        <div className="flex items-end gap-2">
          <FormInput
            id="form-heading-color"
            label="Title and heading colour"
            type="color"
            value={headingColor ?? DEFAULT_PICKER_COLOR}
            onChange={(event) => onHeadingColorChange(event.target.value.toUpperCase())}
            containerClassName="w-40"
          />
          {headingColor ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onHeadingColorChange(null)}>
              Use default
            </Button>
          ) : (
            <span className="pb-2 text-2xs text-text-muted">Default</span>
          )}
        </div>
        <p className="mt-1 text-2xs text-text-muted">
          Used for the form title, section headings, page progress and footer, which sit directly on the background.
          Pick a light colour for a dark background.
        </p>
      </div>
    </div>
  );
}
