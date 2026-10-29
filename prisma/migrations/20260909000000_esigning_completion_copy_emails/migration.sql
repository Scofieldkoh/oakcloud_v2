-- Add a distinct audience for internal completion-copy recipients.
ALTER TYPE "EsigningEmailDeliveryAudience" ADD VALUE 'COPY';

-- Allow manual-link recipients to be configured without an email address.
ALTER TABLE "esigning_envelope_recipients"
  ALTER COLUMN "email" DROP NOT NULL;

-- Additional internal recipients for the fully signed envelope email.
ALTER TABLE "esigning_envelopes"
  ADD COLUMN "completion_copy_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
