import { useCallback, useEffect, useRef, useState } from 'react';
import { coverUrl } from '../../services/api/boardsService';
import BoardMiniature from './BoardMiniature';
import './Shelf.css';

/* The clue_count is all a list carries, so a card draws the first N cells
   filled. A summary rather than a map of which are missing, which is the right
   trade: sending thirty boards to draw thirty thumbnails would make this the
   heaviest page in the app. */
function shapeFrom(clueCount, columns = 6) {
  let left = clueCount;
  return {
    categories: Array.from({ length: columns }, () => ({
      questions: Array.from({ length: 5 }, () => {
        const written = left > 0;
        if (written) left -= 1;
        return written ? { answer: 'x', question: 'x' } : { answer: '', question: '' };
      }),
    })),
  };
}

export function Card({ board, onOpen }) {
  const categories = board.categories?.length
    ? board.categories.join(' · ')
    : null;

  return (
    <button className="plain-btn bb-card" onClick={() => onOpen(board.slug)}>
      <span className="bb-cover">
        {board.hasCover ? (
          <img className="bb-cover-art" src={coverUrl(board.slug)} alt="" loading="lazy" />
        ) : (
          /* No image, and the board is the image. The most on-brand thing on
             the page rather than a placeholder waiting to be replaced. */
          <span className="bb-cover-board">
            <BoardMiniature board={shapeFrom(board.clueCount, board.columns)} size="cover" label="" />
          </span>
        )}
        <span className="bb-band">
          {categories || board.title || 'Untitled board'}
        </span>
      </span>

      <span className="bb-card-body">
        <span className="bb-card-title">{board.title || 'Untitled board'}</span>
        <span className="bb-card-meta">
          {board.author?.signature ? (
            <img className="bb-card-sig" src={board.author.signature} alt="" />
          ) : null}
          {board.author?.username && <span>@{board.author.username}</span>}
          <span className="bb-card-plays">
            {board.plays.toLocaleString()} {board.plays === 1 ? 'play' : 'plays'}
          </span>
        </span>
      </span>
    </button>
  );
}

/**
 * A row as one line that scrolls sideways, the way a streaming shelf does.
 * Arrows page it on a pointer that hovers; a finger just swipes. Each arrow
 * shows only while there is more that way.
 */
export function Rail({ children }) {
  const track = useRef(null);
  const [more, setMore] = useState({ back: false, on: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setMore({ back: el.scrollLeft > 4, on: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, children]);

  // A page at a time, less a card's worth so the next page starts with one already seen.
  const page = (direction) => {
    const el = track.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <div className="bb-rail">
      {more.back && (
        <button className="plain-btn bb-rail-arrow is-back" onClick={() => page(-1)} aria-label="Scroll back">‹</button>
      )}
      <div className="bb-rail-track" ref={track} onScroll={measure}>
        {children}
      </div>
      {more.on && (
        <button className="plain-btn bb-rail-arrow is-on" onClick={() => page(1)} aria-label="Scroll on">›</button>
      )}
    </div>
  );
}
