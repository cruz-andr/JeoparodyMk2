import { writtenGrid } from '../../stores/boardShape';
import './BoardMiniature.css';

/**
 * The board, small.
 *
 * It is the progress meter and the thumbnail at once, which is the point: a
 * bar that says 24/30 tells you a number, and this tells you which six are
 * missing and where. It is also what a board looks like, so a shelf of these
 * reads as a shelf of boards rather than a list of filenames.
 */
export default function BoardMiniature({ board, size = 'small', label }) {
  const grid = writtenGrid(board);

  return (
    <div className={`board-mini is-${size}`} role="img" aria-label={label ?? 'Board progress'}>
      {grid.map((column, c) => (
        <div className="board-mini-col" key={c}>
          {column.map((written, r) => (
            <span key={r} className={written ? 'is-written' : ''} />
          ))}
        </div>
      ))}
    </div>
  );
}
