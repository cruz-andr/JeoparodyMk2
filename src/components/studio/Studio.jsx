import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppTabBar from '../common/AppTabBar';
import './studio.css';

/**
 * The pieces every mode screen is built from.
 *
 * Host mode's chrome, because there is one app and it should look like it: a
 * bar with the way back, the screen's name in the middle and the state of
 * things on the right, then a body under it. Two rules hold the rest
 * together. Anything carrying a value is a board tile, and anything carrying
 * a person is the blue panel their name was drawn on. See studio.css.
 */

export default function Studio({ title, back = '/menu', right = null, children, className = '' }) {
  const navigate = useNavigate();
  return (
    <div className={`st ${className}`}>
      <header className="st-top">
        <button type="button" className="st-back" onClick={() => navigate(back)}>
          &larr; Back
        </button>
        <h1 className="st-title">{title}</h1>
        <div className="st-you">{right}</div>
      </header>
      <div className="st-body">{children}</div>
      <AppTabBar />
    </div>
  );
}

/** Connected, connecting, or not. A word and a dot, not a coloured pill. */
export function Live({ isConnected, isConnecting = false }) {
  const state = isConnected ? 'on' : isConnecting ? 'connecting' : 'off';
  return (
    <span className="st-live" data-state={state}>
      <i aria-hidden="true" />
      {isConnected ? 'Live' : isConnecting ? 'Connecting' : 'Offline'}
    </span>
  );
}

/**
 * Somebody's name, shown the way the podium screens show one: written on the
 * blue it was drawn on, with nothing around it.
 *
 * A player who drew their name has a PNG baked onto that exact blue, so it
 * has to sit on the same colour or it reads as a patch of a different one.
 * A player who typed one, or a house player who never drew anything, gets
 * the same name set in a hand.
 */
export function Plate({ player = null, isYou = false, waiting = false, small = false, label = 'Waiting' }) {
  const classes = ['st-plate'];
  if (isYou) classes.push('is-you');
  if (small) classes.push('is-small');

  if (!player) {
    classes.push('is-open');
    if (waiting) classes.push('is-waiting');
    return (
      <span className={classes.join(' ')}>
        <span className="st-name">{label}</span>
      </span>
    );
  }

  const name = player.displayName || player.name || 'Player';
  return (
    <span className={classes.join(' ')}>
      {player.signature
        ? <img src={player.signature} alt={name} />
        : <span className="st-name">{name}</span>}
    </span>
  );
}

/** Who is playing: a count, then the names, then what each of them is doing. */
export function Roster({ rows, count = null, heading = 'Who is playing' }) {
  return (
    <div className="st-stack">
      {count && (
        <div className="st-count"><span>{heading}</span><b>{count}</b></div>
      )}
      <div className="st-roster">
        {rows.map((row, i) => (
          <div className="st-row" key={row.key ?? i}>
            <Plate player={row.player} isYou={row.isYou} waiting={row.waiting} label={row.label} />
            <span className="st-status">{row.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The wait clock. It counts up.
 *
 * Not down to a mark: a ring closing on a promised moment tells the player
 * the game was always going to start there, whoever turned up. Counting up
 * answers the only question a waiting person actually has.
 */
export function Clock({ seconds, label }) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return (
    <div className="st-clock">
      <span className="st-clock-time">{`${mins}:${String(secs).padStart(2, '0')}`}</span>
      {/* The label carries host mode's pulsing dot, so a wait reads as
          something happening rather than a caption that happens to be there. */}
      {label && <span className="st-clock-label">{label}</span>}
    </div>
  );
}

export function Btn({ children, onClick, disabled = false, type = 'button', wide = false, className = '' }) {
  return (
    <button
      type={type}
      className={`st-btn ${wide ? 'is-wide' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Ghost({ children, onClick, type = 'button', className = '' }) {
  return (
    <button type={type} className={`st-ghost ${className}`} onClick={onClick}>{children}</button>
  );
}

/**
 * Which half of the screen you are on, as host mode's round tabs: a word
 * with a rule under it. Not the same thing as a Seg, which picks a setting.
 */
export function Tabs({ options, value, onChange, ariaLabel }) {
  return (
    <div className="st-tabs" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`st-tab ${o.value === value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <span className="st-tab-name">{o.label}</span>
          {o.note && <span className="st-tab-note">{o.note}</span>}
        </button>
      ))}
    </div>
  );
}

/** One of these, not the other. */
export function Seg({ options, value, onChange, ariaLabel }) {
  return (
    <div className="st-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`st-seg-item ${o.value === value ? 'is-on' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      className={`st-toggle ${on ? 'is-on' : ''}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={ariaLabel}
    >
      <span className="st-track" />
      <span className="st-toggle-word">{on ? 'On' : 'Off'}</span>
    </button>
  );
}

/** A rule: what it is, what it does in the game, and the control. */
export function Rule({ name, what, children }) {
  return (
    <div className="st-rule">
      <span className="st-rule-text"><b>{name}</b>{what && <span>{what}</span>}</span>
      {children}
    </div>
  );
}

/**
 * The board, small.
 *
 * `categories` may hold empty slots while it is being written; a slot with no
 * name is hatched. `rows` is how many value rows to draw. When `onRename` is
 * given, a header is a button that turns into a field.
 */
export function MiniBoard({
  categories = [],
  values = [200, 400, 600, 800, 1000],
  filledColumns = null,
  dim = false,
  onRename = null,
  disabled = false,
}) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const slots = Array.from({ length: 6 }, (_, i) => categories[i] ?? '');

  useEffect(() => { if (editing !== null) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    if (editing === null) return;
    const name = draft.trim();
    if (name) onRename(editing, name.toUpperCase());
    setEditing(null);
  };

  return (
    <div className={`st-board ${dim ? 'is-dim' : ''}`}>
      {slots.map((name, i) => {
        if (editing === i) {
          return (
            <span className="st-cell is-head" key={`h${i}`}>
              <input
                ref={inputRef}
                className="st-head-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setEditing(null);
                }}
                aria-label={`Rename category ${i + 1}`}
              />
            </span>
          );
        }
        const canEdit = Boolean(onRename) && Boolean(name) && !disabled;
        const Tag = canEdit ? 'button' : 'span';
        return (
          <Tag
            className={`st-cell is-head ${name ? '' : 'is-blank is-writing'}`}
            key={`h${i}`}
            {...(canEdit
              ? { type: 'button', onClick: () => { setEditing(i); setDraft(name); }, title: 'Rename this category' }
              : {})}
          >
            <span className="st-head-text">{name || 'Writing'}</span>
          </Tag>
        );
      })}
      {values.map((value, row) => (
        slots.map((name, col) => {
          const lit = filledColumns === null ? Boolean(name) : col < filledColumns;
          return (
            <span className={`st-cell ${lit ? '' : 'is-blank'}`} key={`${col}-${row}`}>
              <span className="st-money">${value}</span>
            </span>
          );
        })
      ))}
    </div>
  );
}

/** The room code, in the board's own cells. */
export function CodeCells({ code, length = 6, editable = false, onChange = null, inputRef = null, autoFocus = false }) {
  const own = useRef(null);
  const ref = inputRef ?? own;
  const cells = Array.from({ length }, (_, i) => (
    <span
      className={`st-cell ${code[i] ? '' : 'is-blank'} ${editable && i === code.length ? 'is-next' : ''}`}
      key={i}
    >
      <span className="st-money">{code[i] ?? ''}</span>
    </span>
  ));

  if (!editable) return <div className="st-code">{cells}</div>;

  return (
    <div className="st-code-wrap" onClick={() => ref.current?.focus()} role="presentation">
      <input
        ref={ref}
        className="st-code-input"
        value={code}
        onChange={onChange}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck="false"
        inputMode="text"
        maxLength={length}
        aria-label="Room code"
        autoFocus={autoFocus}
      />
      <div className="st-code" aria-hidden="true">{cells}</div>
    </div>
  );
}
