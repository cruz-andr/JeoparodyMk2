import './BoardChrome.css';

/**
 * What sits around a board in play, drawn the way The Board draws it, for
 * every mode that plays one: The Board itself, solo play and a room. It was
 * three pages' own headers and scores, and they did not agree on a colour,
 * a size or even how to write a negative number.
 */

/** Money as The Board writes it: -$200, not $-200, and red only below zero. */
export function Money({ value }) {
  const n = Number(value) || 0;
  return (
    <span className={n < 0 ? 'negative' : undefined}>
      {n < 0 ? '-' : ''}${Math.abs(n).toLocaleString()}
    </span>
  );
}

/**
 * The desktop header: the way back on the left, the title and what it is on
 * the line under it in the middle, the money on the right.
 */
export function BoardHeader({ title, sub = null, onBack = null, backLabel = 'Back to menu', children }) {
  return (
    <header className="board-header">
      {onBack
        ? (
          <button type="button" onClick={onBack} className="board-back back-chevron" aria-label={backLabel} title={backLabel}>
            &lsaquo;
          </button>
        )
        : <span className="board-back-spacer" aria-hidden="true" />}
      <div className="board-header-title">
        <h1>{title}</h1>
        {sub && <p className="board-header-sub">{sub}</p>}
      </div>
      <div className="board-header-score">{children}</div>
    </header>
  );
}

/** A small tag beside the score: a streak, a number to beat. */
export function BoardTag({ children, quiet = false }) {
  return <span className={`board-tag${quiet ? ' is-quiet' : ''}`}>{children}</span>;
}

/** The phone's line above the wheel: where the game is, and the way out. */
export function WheelHeader({ state, onClose = null, closeLabel = 'Back to menu' }) {
  return (
    <div className="wheel-header">
      <span className="wheel-state">{state}</span>
      {onClose && (
        <button type="button" className="wheel-close" onClick={onClose} aria-label={closeLabel}>
          &times;
        </button>
      )}
    </div>
  );
}

/**
 * The phone's scores, at the bottom where the thumb is and where contestants
 * stand on the show. One gold podium for one player; a room gets one each,
 * side by side, with whoever has the pick lit.
 */
export function WheelPodium({ meta = null, children }) {
  return (
    <div className="wheel-podium">
      {meta && <div className="wheel-podium-meta">{meta}</div>}
      <div className="wheel-podium-row">{children}</div>
    </div>
  );
}

export function PodiumScore({ value, name = null, active = false, dim = false }) {
  return (
    <div className={`wheel-podium-score${name ? ' has-name' : ''}${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}`}>
      {name && <span className="wheel-podium-name">{name}</span>}
      <Money value={value} />
    </div>
  );
}
