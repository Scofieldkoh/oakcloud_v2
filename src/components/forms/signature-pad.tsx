'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import SignaturePadEngine from '../../lib/vendor/signature-pad-engine.js';
import { RotateCcw, Undo2 } from 'lucide-react';

type SignaturePadEngineInstance = InstanceType<typeof SignaturePadEngine>;
type SignaturePadStrokeData = ReturnType<SignaturePadEngineInstance['toData']>;

interface SignaturePadProps {
  value?: string;
  onChange: (dataUrl: string) => void;
  onVectorChange?: (dataUrl: string | null) => void;
  ariaLabel?: string;
}

async function drawImageOnCanvas(
  canvas: HTMLCanvasElement,
  dataUrl: string
): Promise<void> {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error('Unable to load signature image'));
    nextImage.src = dataUrl;
  });

  const displayWidth = canvas.getBoundingClientRect().width;
  const displayHeight = canvas.getBoundingClientRect().height;
  context.drawImage(image, 0, 0, displayWidth, displayHeight);
}

export function SignaturePad({
  value,
  onChange,
  onVectorChange,
  ariaLabel = 'Signature field',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadRef = useRef<SignaturePadEngineInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const onVectorChangeRef = useRef(onVectorChange);
  const loadedImageValueRef = useRef<string | null>(null);
  const lastEmittedValueRef = useRef<string>('');
  const strokeDataRef = useRef<SignaturePadStrokeData>([]);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onVectorChangeRef.current = onVectorChange;
  }, [onVectorChange]);

  const configureCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));

    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    return { canvas, rect };
  }, []);

  const restorePadState = useCallback(
    async (signaturePad: SignaturePadEngineInstance, canvas: HTMLCanvasElement) => {
      signaturePad.clear();

      if (loadedImageValueRef.current) {
        await drawImageOnCanvas(canvas, loadedImageValueRef.current);
      }

      if (strokeDataRef.current.length > 0) {
        signaturePad.fromData(strokeDataRef.current, { clear: false });
      }

      setHasSignature(Boolean(loadedImageValueRef.current || strokeDataRef.current.length > 0));
    },
    []
  );

  const emitChanges = useCallback(() => {
    const signaturePad = signaturePadRef.current;
    if (!signaturePad) {
      return;
    }

    const strokeData = signaturePad.toData();
    const hasStrokeData = strokeData.length > 0;
    strokeDataRef.current = strokeData;
    const effectiveValue = hasStrokeData
      ? signaturePad.toDataURL('image/png')
      : loadedImageValueRef.current ?? '';

    lastEmittedValueRef.current = effectiveValue;
    onChangeRef.current(effectiveValue);
    onVectorChangeRef.current?.(
      hasStrokeData && !loadedImageValueRef.current
        ? signaturePad.toDataURL('image/svg+xml')
        : null
    );
    setHasSignature(effectiveValue.length > 0);
  }, []);

  const clearPad = useCallback(() => {
    const signaturePad = signaturePadRef.current;
    if (!signaturePad) {
      return;
    }

    signaturePad.clear();
    loadedImageValueRef.current = null;
    lastEmittedValueRef.current = '';
    strokeDataRef.current = [];
    setHasSignature(false);
    onChangeRef.current('');
    onVectorChangeRef.current?.(null);
  }, []);

  const syncDisplayedValue = useCallback(async () => {
    const signaturePad = signaturePadRef.current;
    const canvas = canvasRef.current;
    if (!signaturePad || !canvas) {
      return;
    }

    if (
      value &&
      value === lastEmittedValueRef.current &&
      (strokeDataRef.current.length > 0 || loadedImageValueRef.current)
    ) {
      await restorePadState(signaturePad, canvas);
      return;
    }

    signaturePad.clear();
    strokeDataRef.current = [];
    loadedImageValueRef.current = null;

    if (!value) {
      lastEmittedValueRef.current = '';
      setHasSignature(false);
      onVectorChangeRef.current?.(null);
      return;
    }

    try {
      await drawImageOnCanvas(canvas, value);
      loadedImageValueRef.current = value;
      lastEmittedValueRef.current = value;
      setHasSignature(true);
    } catch {
      setHasSignature(false);
    }
  }, [restorePadState, value]);

  const redrawCurrentSignature = useCallback(async () => {
    const configured = configureCanvas();
    const signaturePad = signaturePadRef.current;
    if (!configured || !signaturePad) {
      return;
    }

    await restorePadState(signaturePad, configured.canvas);
  }, [configureCanvas, restorePadState]);

  useEffect(() => {
    const configured = configureCanvas();
    if (!configured) {
      return;
    }

    const signaturePad = new SignaturePadEngine(configured.canvas, {
      minWidth: 0.8,
      maxWidth: 2.2,
      throttle: 0,
      minDistance: 0.35,
      velocityFilterWeight: 0.35,
      penColor: '#111111',
      backgroundColor: 'rgba(0,0,0,0)',
      canvasContextOptions: {
        desynchronized: true,
      },
    });

    signaturePadRef.current = signaturePad;

    const handleStrokeEnd = () => {
      emitChanges();
    };

    signaturePad.addEventListener('endStroke', handleStrokeEnd);

    return () => {
      signaturePad.removeEventListener('endStroke', handleStrokeEnd);
      signaturePad.off();
      signaturePadRef.current = null;
    };
  }, [configureCanvas, emitChanges]);

  useEffect(() => {
    void syncDisplayedValue();
  }, [syncDisplayedValue]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const observer = new ResizeObserver(() => {
      void redrawCurrentSignature();
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redrawCurrentSignature]);

  async function undoLastStroke() {
    const signaturePad = signaturePadRef.current;
    const canvas = canvasRef.current;
    if (!signaturePad || !canvas) {
      return;
    }

    const strokeData = signaturePad.toData();
    if (strokeData.length === 0) {
      clearPad();
      return;
    }

    const nextStrokeData = strokeData.slice(0, -1);
    strokeDataRef.current = nextStrokeData;
    await restorePadState(signaturePad, canvas);
    emitChanges();
  }

  return (
    <div className="space-y-2">
      <div className="h-[264px] w-full rounded-lg border border-dashed border-border-primary bg-background-primary p-2">
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none cursor-crosshair"
          aria-label={ariaLabel}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void undoLastStroke()}
          disabled={!hasSignature}
          className="inline-flex items-center gap-1 rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Undo2 className="h-3 w-3" />
          Undo stroke
        </button>
        <button
          type="button"
          onClick={clearPad}
          className="inline-flex items-center gap-1 rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:bg-background-tertiary"
        >
          <RotateCcw className="h-3 w-3" />
          {hasSignature ? 'Clear signature' : 'Reset'}
        </button>
      </div>
    </div>
  );
}
