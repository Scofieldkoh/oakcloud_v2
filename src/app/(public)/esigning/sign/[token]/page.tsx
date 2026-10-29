import { EsigningSignPage } from '@/components/esigning/esigning-sign-page';
import { PublicSigningProviders } from './public-signing-providers';

export const metadata = {
  title: 'Oaktree E-Signing',
  description: 'Securely review and sign your Oaktree documents.',
};

export default function Page() {
  return (
    <PublicSigningProviders>
      <EsigningSignPage />
    </PublicSigningProviders>
  );
}
