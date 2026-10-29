'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { SignaturePad } from '@/components/forms/signature-pad';

interface EsigningSignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdopt: (result: { dataUrl: string; vectorDataUrl?: string | null; applyToAll: boolean }) => void;
  mode: 'SIGNATURE' | 'INITIALS';
  recipientName: string;
  existingSignature?: string | null;
  isSubmitting?: boolean;
  titleOverride?: string;
  fullNameLabel?: string;
  confirmLabel?: string;
  legalText?: string;
  showApplyToAll?: boolean;
  applyToAllLabel?: string;
  applyToAllDefault?: boolean;
  showDownloadSvg?: boolean;
  onClear?: () => void;
}

type ActiveTab = 'draw' | 'type' | 'upload';
type SignatureFontKey = 'dancing-script' | 'pinyon-script' | 'caveat';

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

const SIGNATURE_FONT_OPTIONS: Array<{
  key: SignatureFontKey;
  label: string;
  fontFamily: string;
}> = [
  {
    key: 'dancing-script',
    label: 'Dancing Script',
    fontFamily: '"Brush Script MT", "Segoe Script", cursive',
  },
  {
    key: 'pinyon-script',
    label: 'Pinyon Script',
    fontFamily: '"Palatino Linotype", "Book Antiqua", serif',
  },
  {
    key: 'caveat',
    label: 'Caveat',
    fontFamily: '"Comic Sans MS", "Segoe Print", cursive',
  },
];

function rasterDataUrlToSvgDataUrl(imageDataUrl: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 180" width="640" height="180">
      <rect width="100%" height="100%" fill="white" fill-opacity="0" />
      <image href="${imageDataUrl}" x="0" y="0" width="640" height="180" preserveAspectRatio="xMidYMid meet" />
    </svg>
  `.trim();

  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

function textToDataUrl(text: string, fontFamily: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111827';
  context.textBaseline = 'middle';
  context.font = `64px ${fontFamily}`;
  context.fillText(text, 28, canvas.height / 2);
  return canvas.toDataURL('image/png');
}

function textToSvgDataUrl(text: string, fontFamily: string): string {
  const imageDataUrl = textToDataUrl(text, fontFamily);
  return imageDataUrl ? rasterDataUrlToSvgDataUrl(imageDataUrl) : '';
}

async function ensureFontReady(fontFamily: string): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return;
  }

  try {
    await document.fonts.load(`64px ${fontFamily}`);
    await document.fonts.ready;
  } catch {
    // Continue with the best available font rendering if the browser cannot preload the font.
  }
}

async function renderTypedSignatureAssets(
  text: string,
  fontFamily: string
): Promise<{ pngDataUrl: string; svgDataUrl: string } | null> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return null;
  }

  await ensureFontReady(fontFamily);
  const pngDataUrl = textToDataUrl(trimmedText, fontFamily);
  if (!pngDataUrl) {
    return null;
  }

  return {
    pngDataUrl,
    svgDataUrl: textToSvgDataUrl(trimmedText, fontFamily),
  };
}

async function fileToPngDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('Unable to read uploaded image'));
      nextImage.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to prepare uploaded signature');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;

    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function EsigningSignatureModal({
  isOpen,
  onClose,
  onAdopt,
  mode,
  recipientName,
  existingSignature,
  isSubmitting = false,
  titleOverride,
  fullNameLabel = 'Full Name',
  confirmLabel = 'Adopt and Sign',
  legalText = 'By selecting "Adopt and Sign", I agree that the signature and initials will be the electronic representation of my signature for all purposes when I use them on documents.',
  showApplyToAll = true,
  applyToAllLabel,
  applyToAllDefault = true,
  showDownloadSvg = true,
  onClear,
}: EsigningSignatureModalProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('draw');
  const [drawDataUrl, setDrawDataUrl] = useState<string>(existingSignature ?? '');
  const [drawVectorDataUrl, setDrawVectorDataUrl] = useState<string | null>(null);
  const [typedText, setTypedText] = useState('');
  const [typedFont, setTypedFont] = useState<SignatureFontKey>('dancing-script');
  const [uploadedDataUrl, setUploadedDataUrl] = useState('');
  const [applyToAll, setApplyToAll] = useState(applyToAllDefault);
  const [typedAssets, setTypedAssets] = useState<{ pngDataUrl: string; svgDataUrl: string } | null>(
    null
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDrawDataUrl(existingSignature ?? '');
    setDrawVectorDataUrl(null);
    setTypedText('');
    setTypedFont('dancing-script');
    setUploadedDataUrl('');
    setApplyToAll(applyToAllDefault);
    setActiveTab('draw');
    setTypedAssets(null);
  }, [applyToAllDefault, existingSignature, isOpen]);

  const isSignature = mode === 'SIGNATURE';
  const title = titleOverride ?? (isSignature ? 'Adopt Your Signature' : 'Adopt Your Initials');
  const fieldLabel = isSignature ? 'Signature' : 'Initials';
  const resolvedApplyToAllLabel =
    applyToAllLabel ?? `Apply to all ${fieldLabel} fields in this document`;
  const selectedFont = useMemo(
    () => SIGNATURE_FONT_OPTIONS.find((font) => font.key === typedFont) ?? SIGNATURE_FONT_OPTIONS[0],
    [typedFont]
  );
  useEffect(() => {
    let cancelled = false;

    async function syncTypedAssets() {
      const nextTypedAssets = await renderTypedSignatureAssets(typedText, selectedFont.fontFamily);
      if (!cancelled) {
        setTypedAssets(nextTypedAssets);
      }
    }

    void syncTypedAssets();

    return () => {
      cancelled = true;
    };
  }, [selectedFont.fontFamily, typedText]);

  const currentDataUrl = useMemo(() => {
    if (activeTab === 'draw') {
      return drawDataUrl;
    }

    if (activeTab === 'upload') {
      return uploadedDataUrl;
    }

    return typedAssets?.pngDataUrl ?? '';
  }, [activeTab, drawDataUrl, typedAssets, uploadedDataUrl]);
  const currentVectorDataUrl =
    activeTab === 'draw' ? drawVectorDataUrl : activeTab === 'type' ? typedAssets?.svgDataUrl ?? null : null;

  const canAdopt = currentDataUrl.length > 0;

  function handleAdopt() {
    if (!canAdopt) {
      return;
    }

    onAdopt({
      dataUrl: currentDataUrl,
      vectorDataUrl: currentVectorDataUrl,
      applyToAll,
    });
  }

  async function handleUploadSignature(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    const nextDataUrl = await fileToPngDataUrl(file);
    setUploadedDataUrl(nextDataUrl);
  }

  function handleDownloadSvg() {
    if (!currentVectorDataUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = currentVectorDataUrl;
    link.download = `${fieldLabel.toLowerCase()}-${recipientName.replace(/\s+/g, '-').toLowerCase()}.svg`;
    link.click();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="2xl">
      <ModalBody className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">{fullNameLabel}</label>
          <div className="rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary">
            {recipientName}
          </div>
        </div>

        <div className="flex rounded-xl border border-border-primary bg-background-tertiary p-1">
          {(['draw', 'type', 'upload'] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={
                activeTab === tab
                  ? 'flex-1 rounded-lg bg-background-secondary px-4 py-1.5 text-sm font-medium text-text-primary shadow-sm'
                  : 'flex-1 px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary'
              }
            >
              {tab === 'draw' ? 'Draw' : tab === 'type' ? 'Type' : 'Upload'}
            </button>
          ))}
        </div>

        {activeTab === 'draw' ? (
          <div>
            <p className="mb-2 text-xs text-text-muted">
              Draw your {fieldLabel.toLowerCase()} in the box below.
            </p>
            <SignaturePad
              value={drawDataUrl || undefined}
              onChange={(url) => setDrawDataUrl(url)}
              onVectorChange={setDrawVectorDataUrl}
              ariaLabel={`${fieldLabel} draw pad`}
            />
          </div>
        ) : activeTab === 'type' ? (
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-xs text-text-muted">
                Type your {fieldLabel.toLowerCase()} below.
              </p>
              <input
                type="text"
                value={typedText}
                onChange={(event) => setTypedText(event.target.value)}
                placeholder={`Type your ${fieldLabel.toLowerCase()}...`}
                className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-oak-primary focus:ring-1 focus:ring-oak-primary/30"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-text-secondary">Style</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {SIGNATURE_FONT_OPTIONS.map((fontOption) => (
                  <button
                    key={fontOption.key}
                    type="button"
                    onClick={() => setTypedFont(fontOption.key)}
                    className={
                      typedFont === fontOption.key
                        ? 'rounded-xl border border-oak-primary bg-oak-primary/5 px-3 py-3 text-left shadow-sm'
                        : 'rounded-xl border border-border-primary bg-background-primary px-3 py-3 text-left hover:border-oak-primary/40'
                    }
                  >
                    <div className="text-xs font-medium text-text-secondary">{fontOption.label}</div>
                    <div
                      className="mt-2 truncate text-2xl text-text-primary"
                      style={{ fontFamily: fontOption.fontFamily }}
                    >
                      {typedText.trim() || 'Abc'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border-primary bg-background-tertiary px-4 py-4">
              {typedText.trim() ? (
                <span
                  style={{
                    fontFamily: selectedFont.fontFamily,
                    fontSize: '2.75rem',
                    color: '#111827',
                    lineHeight: 1,
                  }}
                >
                  {typedText}
                </span>
              ) : (
                <span className="text-sm italic text-text-muted">Preview will appear here</span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-xs text-text-muted">
                Upload a scanned signature, initials, or mark. We will fit it into the signing field.
              </p>
              <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-border-primary bg-background-primary px-4 py-6 text-sm text-text-secondary hover:border-oak-primary/40 hover:text-text-primary">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(event) => void handleUploadSignature(event)}
                />
                Choose an image
              </label>
            </div>

            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border-primary bg-background-tertiary px-4 py-4">
              {uploadedDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={uploadedDataUrl}
                  alt={`${fieldLabel} upload preview`}
                  className="max-h-24 w-auto object-contain"
                />
              ) : (
                <span className="text-sm italic text-text-muted">Uploaded preview will appear here</span>
              )}
            </div>
          </div>
        )}

        {showApplyToAll ? (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(event) => setApplyToAll(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border-primary accent-oak-primary"
            />
            <span className="text-sm text-text-secondary">{resolvedApplyToAllLabel}</span>
          </label>
        ) : null}

        <p className="text-xs leading-relaxed text-text-muted">
          {legalText}
        </p>
      </ModalBody>

      <ModalFooter>
        {onClear ? (
          <Button variant="ghost" onClick={onClear} disabled={isSubmitting}>
            Undo signature
          </Button>
        ) : null}
        {showDownloadSvg && currentVectorDataUrl ? (
          <Button variant="secondary" onClick={handleDownloadSvg} disabled={isSubmitting}>
            Download SVG
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={handleAdopt} disabled={!canAdopt || isSubmitting} isLoading={isSubmitting}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
