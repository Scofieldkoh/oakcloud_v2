import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormBackgroundUploader } from '@/components/forms/form-background-uploader';

describe('FormBackgroundUploader', () => {
  const onUrlChange = vi.fn();
  const onOpacityChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ backgroundImageUrl: '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a selected file and reports the returned URL', async () => {
    render(
      <FormBackgroundUploader
        formId="form-1"
        value={null}
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    const input = screen.getByLabelText('Upload background image') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'bg.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUrlChange).toHaveBeenCalledWith(
      '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png'
    ));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/forms/form-1/background',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('removes the background', () => {
    render(
      <FormBackgroundUploader
        formId="form-1"
        value="/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png"
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onUrlChange).toHaveBeenCalledWith(null);
  });

  it('renders a selected image as a decorative bounded preview', () => {
    const imageUrl = '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png';
    const { container } = render(
      <FormBackgroundUploader
        formId="form-1"
        value={imageUrl}
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    const preview = container.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(preview).not.toBeNull();
    expect(preview?.style.backgroundImage).toBe(`url("${imageUrl}")`);
    expect(preview).toHaveClass('bg-cover', 'bg-center');
  });

  it('reports opacity slider changes', () => {
    render(
      <FormBackgroundUploader
        formId="form-1"
        value="/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png"
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Background opacity'), { target: { value: '65' } });
    expect(onOpacityChange).toHaveBeenCalledWith(65);
  });

  it('shows an error when the upload fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Background image must be 5MB or smaller' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <FormBackgroundUploader
        formId="form-1"
        value={null}
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    const input = screen.getByLabelText('Upload background image') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'bg.png', { type: 'image/png' })] } });

    expect(await screen.findByText('Background image must be 5MB or smaller')).toBeVisible();
    expect(onUrlChange).not.toHaveBeenCalled();
  });
});
