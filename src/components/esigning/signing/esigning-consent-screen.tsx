'use client';
import { esigningDisplayName } from '@/lib/esigning-branding';

import { useState } from 'react';
import { FileSignature, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EsigningConsentScreenProps {
  envelopeTitle: string;
  senderName: string;
  tenantName: string;
  documents: Array<{ id: string; fileName: string }>;
  onConsent: () => void;
  onDecline: () => void;
  isSubmitting: boolean;
}

export function EsigningConsentScreen({
  envelopeTitle,
  senderName,
  tenantName,
  documents,
  onConsent,
  onDecline,
  isSubmitting,
}: EsigningConsentScreenProps) {
  const [isAgreed, setIsAgreed] = useState(false);

  return (
    <div className="min-h-screen bg-background-primary px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-3xl border border-border-primary bg-background-secondary p-5 shadow-sm sm:p-8">
          {/* Badge */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-border-primary bg-background-tertiary px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-text-muted">
              <span className="font-semibold tracking-[0.12em] text-oak-primary">Oaktree</span>
              <FileSignature className="h-3.5 w-3.5" />
              Secure E-Sign
            </div>
          </div>

          {/* Heading */}
          <h1 className="mt-6 text-center text-xl font-semibold text-text-primary sm:text-2xl">
            Electronic Signature Disclosure
          </h1>
          <p className="mt-2 text-center text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{senderName}</span> from{' '}
            <span className="font-medium text-text-primary">{esigningDisplayName(tenantName)}</span> has sent you the
            following documents for electronic signature:
          </p>

          {/* Document list */}
          <div className="mt-5 rounded-2xl border border-border-primary bg-background-primary p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              Documents
            </p>
            <ul className="space-y-1.5">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-start gap-2 text-sm text-text-primary">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-oak-primary" />
                  <span className="min-w-0 break-words">{doc.fileName}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Consent notice */}
          <div className="mt-5 rounded-2xl border border-border-primary bg-background-primary p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">
              Before you continue
            </p>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />
                By signing, you agree to use electronic records and signatures for this transaction
                in place of paper documents.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />
                Your IP address and browser information may be collected as part of the audit trail
                for compliance purposes.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />
                Once all parties have signed, a completed copy of the signed documents will be sent
                to you by email.
              </li>
            </ul>
            <p className="mt-3 text-xs text-text-muted">
              You may decline to sign at any time.
            </p>
          </div>

          {/* Checkbox */}
          <label className="mt-5 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={isAgreed}
              onChange={(e) => setIsAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border-primary accent-oak-primary"
            />
            <span className="text-sm text-text-primary">
              I agree to use electronic records and signatures for this transaction.
            </span>
          </label>

          {/* Footer buttons */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:w-auto"
              onClick={onDecline}
              disabled={isSubmitting}
            >
              Decline to Sign
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={onConsent}
              disabled={!isAgreed || isSubmitting}
              isLoading={isSubmitting}
            >
              Continue to Document →
            </Button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-text-muted">
          Envelope: <span className="font-medium">{envelopeTitle}</span>
        </p>
      </div>
    </div>
  );
}
