import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EsigningSigningHeader } from '@/components/esigning/signing/esigning-signing-header';

describe('EsigningSigningHeader session information', () => {
  it('wraps a long recipient email inside the options panel', async () => {
    const user = userEvent.setup();
    const recipientEmail = 'zhiyong_koh@oaktreeresolutions.com.sg';

    render(
      <EsigningSigningHeader
        envelopeTitle="NDA"
        senderName="Sender"
        tenantName="Oakcloud"
        completedCount={0}
        requiredCount={1}
        canFinish={false}
        onPrimaryAction={vi.fn()}
        onDecline={vi.fn()}
        onFinishLater={vi.fn()}
        onDownloadOriginal={vi.fn()}
        recipientName="Koh Zhi Yong"
        recipientEmail={recipientEmail}
        envelopeId="envelope-123"
        isFinishing={false}
      />
    );

    expect(screen.queryByText(/Sent by/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Oakcloud/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Other Options/i }));
    await user.click(screen.getByRole('button', { name: /Session Information/i }));

    expect(screen.getByText(recipientEmail)).toHaveClass('break-all');
  });
});
