import { REASONING_LABELS, type ReasoningEffort } from '@/lib/ai/reasoning-settings';

export function ReasoningEffortSelect({ label, efforts, value, onChange }: {
  label: string;
  efforts?: ReasoningEffort[] | null;
  value?: ReasoningEffort;
  onChange: (value: ReasoningEffort | undefined) => void;
}) {
  const supported = Boolean(efforts?.length);
  return <div className="mt-2 md:mt-0">
    <label className="label md:sr-only">Reasoning effort</label>
    <select aria-label={`${label} reasoning effort`} className="input input-sm w-full"
      disabled={!supported} value={value && efforts?.includes(value) ? value : ''}
      onChange={(event) => onChange(event.target.value ? event.target.value as ReasoningEffort : undefined)}>
      <option value="">Provider default</option>
      {efforts?.map((effort) => <option key={effort} value={effort}>{REASONING_LABELS[effort]}</option>)}
    </select>
    {!supported && <p className="mt-1 text-xs text-text-secondary">{efforts == null ? 'Select a model with available reasoning options.' : 'This model does not offer reasoning effort control.'}</p>}
  </div>;
}
