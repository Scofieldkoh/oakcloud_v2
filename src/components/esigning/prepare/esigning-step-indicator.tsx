'use client';

import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EsigningStepIndicatorProps {
  currentStep: 1 | 2 | 3;
  canProceedToStep2: boolean;
  canProceedToStep3: boolean;
  onStepClick: (step: 1 | 2 | 3) => void;
}

const STEPS: Array<{ step: 1 | 2 | 3; label: string; shortLabel: string }> = [
  { step: 1, label: 'Upload & Recipients', shortLabel: 'Upload' },
  { step: 2, label: 'Place Fields', shortLabel: 'Fields' },
  { step: 3, label: 'Review & Send', shortLabel: 'Review' },
];

export function EsigningStepIndicator({
  currentStep,
  canProceedToStep2,
  canProceedToStep3,
  onStepClick,
}: EsigningStepIndicatorProps) {
  function isAccessible(step: 1 | 2 | 3): boolean {
    if (step === 1) return true;
    if (step === 2) return canProceedToStep2;
    if (step === 3) return canProceedToStep3;
    return false;
  }

  function isCompleted(step: 1 | 2 | 3): boolean {
    return step < currentStep;
  }

  return (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map(({ step, label, shortLabel }, index) => {
        const accessible = isAccessible(step);
        const completed = isCompleted(step);
        const active = step === currentStep;

        return (
          <div key={step} className="flex items-center">
            {/* Step */}
            <button
              type="button"
              onClick={() => accessible && onStepClick(step)}
              disabled={!accessible}
              className={cn(
                'flex flex-col items-center gap-1 px-1.5 sm:gap-1.5 sm:px-3',
                accessible ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              )}
            >
              <div
                className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors sm:h-8 sm:w-8 sm:text-sm',
                  completed && 'bg-emerald-500 text-white border-2 border-emerald-500',
                  active && !completed && 'bg-oak-primary text-white border-2 border-oak-primary',
                  !active && !completed && 'bg-background-secondary text-text-muted border-2 border-border-primary'
                )}
              >
                {completed ? (
                  <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                ) : (
                  <span>{step}</span>
                )}
              </div>
              <span
                className={cn(
                  'text-[11px] whitespace-nowrap sm:text-xs',
                  active ? 'text-text-primary font-medium' : 'text-text-muted'
                )}
              >
                <span className="sm:hidden">{shortLabel}</span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </button>

            {/* Connector line between steps */}
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-px w-6 mb-4 flex-shrink-0 sm:w-16 sm:mb-5',
                  isCompleted(STEPS[index + 1].step) || currentStep > step
                    ? 'bg-emerald-500'
                    : 'bg-border-primary'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
