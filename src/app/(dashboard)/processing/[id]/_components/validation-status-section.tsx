'use client';

import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type ValidationIssue } from './helpers';

// Helper to format validation message with colored "Header" (blue) and "Line item" (green) text
function formatValidationMessage(message: string): React.ReactNode {
  // Split message by "Header" and "line item" keywords and colorize them
  const parts: React.ReactNode[] = [];
  const remaining = message;
  let key = 0;

  // Patterns to match (case-insensitive matching, preserve original case)
  const patterns = [
    { regex: /(Header\s+\w+)/gi, className: 'text-blue-600 dark:text-blue-400 font-medium' },
    { regex: /(line item\s+\w+)/gi, className: 'text-green-600 dark:text-green-400 font-medium' },
  ];

  // Process each pattern
  for (const { regex, className } of patterns) {
    const newParts: React.ReactNode[] = [];
    for (const part of parts.length === 0 ? [remaining] : parts) {
      if (typeof part !== 'string') {
        newParts.push(part);
        continue;
      }

      let lastIndex = 0;
      let match;
      regex.lastIndex = 0; // Reset regex state

      while ((match = regex.exec(part)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          newParts.push(part.slice(lastIndex, match.index));
        }
        // Add colored match
        newParts.push(
          <span key={key++} className={className}>
            {match[1]}
          </span>
        );
        lastIndex = regex.lastIndex;
      }
      // Add remaining text
      if (lastIndex < part.length) {
        newParts.push(part.slice(lastIndex));
      }
    }
    parts.length = 0;
    parts.push(...newParts);
  }

  return parts.length > 0 ? parts : message;
}

export function ValidationStatusSection({
  status,
  issues,
}: {
  status: string;
  issues?: ValidationIssue[];
}) {
  if (status === 'VALID') {
    return (
      <div className="flex items-center gap-2 text-status-success px-4 py-2 bg-status-success/10 rounded-lg">
        <CheckCircle className="w-4 h-4" />
        <span className="text-sm font-medium">Validation Passed</span>
      </div>
    );
  }

  const isError = status === 'INVALID';

  return (
    <div className={cn(
      'p-4 rounded-lg',
      isError ? 'bg-status-error/10' : 'bg-status-warning/10'
    )}>
      <div className="flex items-start gap-2">
        {isError ? (
          <XCircle className="w-4 h-4 text-status-error flex-shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-status-warning flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1">
          <h4 className={cn('text-sm font-medium mb-2', isError ? 'text-status-error' : 'text-status-warning')}>
            {isError ? 'Validation Errors' : 'Validation Warnings'}
          </h4>
          {issues && issues.length > 0 ? (
            <ul className="space-y-1.5">
              {issues.map((issue, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0',
                    issue.severity === 'ERROR' ? 'bg-status-error/20 text-status-error' : 'bg-status-warning/20 text-status-warning'
                  )}>
                    {issue.severity}
                  </span>
                  <span className="text-text-secondary">
                    {formatValidationMessage(issue.message)}
                    {issue.field && <span className="text-text-muted ml-1">({issue.field})</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">No detailed validation messages available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
