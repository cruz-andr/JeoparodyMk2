import { useRef, useEffect, useState, useCallback } from 'react';
import './SignatureCanvas.css';

/** Baked into the exported PNG, so every surface showing one must match it.
    Mirrored in CSS as --signature-ground. */
export const SIGNATURE_GROUND = '#1a1a6e';

export default function SignatureCanvas({
  onSignatureChange,
  initialSignature = null,
  width = 300,
  height = 80
}) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [mode, setMode] = useState('draw'); // 'draw' | 'type'
  const [typedName, setTypedName] = useState('');
  /* Strokes are kept as points rather than as canvas snapshots so that undo can
     replay them. A snapshot per stroke would be about 380KB at this size, which
     is a lot of memory to hold for a signature; a stroke is a few hundred
     numbers. Held in a ref because a point arrives every pointer move and none
     of them should cost a render. */
  const strokesRef = useRef([]);
  // Shown in the tooltip so the shortcut is discoverable on the right platform.
  const modifierLabel =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
      ? '\u2318'
      : 'Ctrl+';
  const [strokeCount, setStrokeCount] = useState(0);

  // Initialize canvas with blue background
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Set up canvas for high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Fill with Jeopardy blue background
    ctx.fillStyle = SIGNATURE_GROUND;
    ctx.fillRect(0, 0, width, height);

    // Set drawing style
    ctx.strokeStyle = '#e0f0ff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [width, height]);

  // Initialize canvas on mount
  useEffect(() => {
    initCanvas();

    // Load initial signature if provided
    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        setHasContent(true);
      };
      img.src = initialSignature;
    }
  }, [width, height, initialSignature, initCanvas]);

  // Render typed name on canvas
  const renderTypedName = useCallback((name) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Clear and fill with blue background
    ctx.fillStyle = SIGNATURE_GROUND;
    ctx.fillRect(0, 0, width, height);

    if (name.trim()) {
      // Draw text centered with Jeopardy-style font
      ctx.fillStyle = '#e0f0ff';
      ctx.font = `bold ${32}px "Palatino Linotype", "Book Antiqua", Palatino, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, width / 2, height / 2);

      setHasContent(true);

      // Export signature
      if (onSignatureChange) {
        onSignatureChange(canvas.toDataURL('image/png'));
      }
    } else {
      setHasContent(false);
      if (onSignatureChange) {
        onSignatureChange(null);
      }
    }
  }, [width, height, onSignatureChange]);

  // Handle mode change
  const handleModeChange = (newMode) => {
    if (newMode === mode) return;

    // Clear canvas when switching modes. The history goes with it, or undo
    // would bring back strokes from a mode you have since left.
    strokesRef.current = [];
    setStrokeCount(0);
    initCanvas();
    setHasContent(false);
    setTypedName('');

    if (onSignatureChange) {
      onSignatureChange(null);
    }

    setMode(newMode);
  };

  // Handle typed name change
  const handleTypedNameChange = (e) => {
    const name = e.target.value;
    setTypedName(name);
    renderTypedName(name);
  };

  /** Repaint the pad from the strokes that survive. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    initCanvas();
    const ctx = canvas.getContext('2d');
    /* Replayed the way it was drawn, not the way it reads.
       Live drawing strokes the path again on every pointer move, so the
       anti-aliased edges darken with each pass. Replaying the whole path in a
       single stroke produces a visibly lighter line, and an undo that changes
       what it did not remove is not an undo. */
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 1) {
        // A tap is a dot, and lineTo on its own paints nothing.
        ctx.lineTo(stroke[0].x + 0.1, stroke[0].y);
        ctx.stroke();
      } else {
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(stroke[i].x, stroke[i].y);
          ctx.stroke();
        }
      }
      ctx.closePath();
    }
  }, [initCanvas]);

  const publish = useCallback(() => {
    if (!onSignatureChange) return;
    const canvas = canvasRef.current;
    const empty = strokesRef.current.length === 0;
    onSignatureChange(empty ? null : canvas.toDataURL('image/png'));
  }, [onSignatureChange]);

  const undo = useCallback(() => {
    if (mode !== 'draw' || strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    setHasContent(strokesRef.current.length > 0);
    redraw();
    publish();
  }, [mode, redraw, publish]);

  /* Command Z on a Mac, Control Z everywhere else. Bound to the window rather
     than the canvas because a canvas is not focusable, so there would be
     nowhere for the key to land. */
  useEffect(() => {
    const onKeyDown = (e) => {
      const key = e.key?.toLowerCase();
      if (key !== 'z' || e.shiftKey || e.altKey) return;
      if (!(e.metaKey || e.ctrlKey)) return;

      // Never steal undo from something the player is typing into. Their own
      // text has its own history and the browser handles it better than we do.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

      if (mode !== 'draw' || strokesRef.current.length === 0) return;
      e.preventDefault();
      undo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, undo]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    if (e.touches) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }

    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    if (mode !== 'draw') return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoordinates(e);

    ctx.beginPath();
    ctx.moveTo(x, y);
    strokesRef.current.push([{ x, y }]);
    setIsDrawing(true);
    setHasContent(true);
  };

  const draw = (e) => {
    if (!isDrawing || mode !== 'draw') return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoordinates(e);

    ctx.lineTo(x, y);
    ctx.stroke();
    strokesRef.current[strokesRef.current.length - 1]?.push({ x, y });
  };

  const stopDrawing = () => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.closePath();
    setIsDrawing(false);
    setStrokeCount(strokesRef.current.length);

    publish();
  };

  const clearCanvas = () => {
    strokesRef.current = [];
    setStrokeCount(0);
    initCanvas();
    setHasContent(false);
    setTypedName('');

    if (onSignatureChange) {
      onSignatureChange(null);
    }
  };

  return (
    <div className="signature-canvas-container">
      <label className="signature-label">Your Name</label>

      {/* Mode Toggle */}
      <div className="signature-mode-toggle">
        <button
          type="button"
          className={`mode-btn ${mode === 'draw' ? 'active' : ''}`}
          onClick={() => handleModeChange('draw')}
        >
          Draw
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'type' ? 'active' : ''}`}
          onClick={() => handleModeChange('type')}
        >
          Type
        </button>
      </div>

      {/* Canvas - Always visible */}
      <canvas
        ref={canvasRef}
        className={`signature-canvas ${mode === 'type' ? 'type-mode' : ''}`}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />

      {/* Text input for type mode */}
      {mode === 'type' && (
        <input
          type="text"
          value={typedName}
          onChange={handleTypedNameChange}
          placeholder="Enter your name"
          className="signature-text-input"
          maxLength={20}
        />
      )}

      <div className="signature-actions">
        <button
          type="button"
          className="signature-action clear-signature-btn"
          onClick={clearCanvas}
          disabled={!hasContent}
        >
          Clear
        </button>
        {mode === 'draw' && (
          <button
            type="button"
            className="signature-action undo-signature-btn"
            onClick={undo}
            disabled={strokeCount === 0}
            title={`Undo the last stroke (${modifierLabel}Z)`}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
}
