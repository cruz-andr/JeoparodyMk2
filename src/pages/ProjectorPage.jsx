import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CHANNEL } from '../components/host/projectorFeed';
import { usePageTitle } from '../hooks/usePageTitle';
import './ProjectorPage.css';

const VALUES = { 1: [200, 400, 600, 800, 1000], 2: [400, 800, 1200, 1600, 2000] };
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

/**
 * The screen behind the host.
 *
 * A second window the host drags onto the projector, the way presenter view
 * has always worked. It is driven entirely by messages from the host's window
 * over a same-origin channel, so it holds no game state of its own and can
 * never show something the host did not send.
 *
 * It is read only. There is nothing to click, because nobody is at it.
 */
export default function ProjectorPage() {
  const { roomCode } = useParams();
  const [feed, setFeed] = useState(null);
  // Reads "Board · CODE · Jeoparody" in the window the host opens.
  usePageTitle(`Board · ${roomCode}`);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(CHANNEL(roomCode));

    channel.onmessage = (event) => setFeed(event.data);
    /* The host posts on every change, but this window may open mid game, so it
       asks once rather than waiting for the next thing to happen. */
    channel.postMessage({ ask: true });

    return () => channel.close();
  }, [roomCode]);

  if (!feed) {
    return (
      <div className="pj pj-empty">
        <p>Waiting for the host&rsquo;s screen.</p>
        <p className="pj-small">Room {roomCode}</p>
      </div>
    );
  }

  const values = VALUES[feed.currentRound] ?? VALUES[1];
  const gone = new Set(feed.revealed ?? []);

  return (
    <div className="pj">
      {feed.clue ? (
        <div className="pj-clue">
          <p className="pj-clue-where">
            {feed.clue.category} <span className="pj-dot">·</span> ${feed.clue.points}
          </p>
          {feed.clue.mediaType === 'image' && feed.clue.mediaData && (
            <img className="pj-media" src={feed.clue.mediaData} alt={feed.clue.altText || ''} />
          )}
          <p className="pj-clue-text">{feed.clue.text}</p>

          {feed.clue.options && (
            <ol className="pj-options">
              {feed.clue.options.map((option, i) => (
                <li key={i}>{option}</li>
              ))}
            </ol>
          )}

          {feed.response && <p className="pj-response">{feed.response}</p>}

          {feed.buzzedName ? (
            <p className="pj-buzz">{feed.buzzedName}</p>
          ) : feed.buzzerOpen ? (
            <p className="pj-buzz is-open">Buzz in</p>
          ) : null}
        </div>
      ) : (
        <div className="pj-board" style={{ '--cols': feed.categories.length || 6 }}>
          {feed.categories.map((name, c) => (
            <div key={`h${c}`} className="pj-head">{name}</div>
          ))}
          {values.map((points, r) => feed.categories.map((_, c) => (
            <div key={`${c}-${r}`} className={`pj-cell ${gone.has(`${c}-${r}`) ? 'is-gone' : ''}`}>
              {gone.has(`${c}-${r}`) ? '' : `$${feed.grid?.[c]?.[r]?.points ?? points}`}
            </div>
          )))}
        </div>
      )}

      <footer className="pj-scores">
        {(feed.scores ?? []).map((player) => (
          <div key={player.id} className="pj-score">
            <span className="pj-name">{player.name}</span>
            <span className={`pj-money ${player.score < 0 ? 'is-negative' : ''}`}>
              {money(player.score)}
            </span>
          </div>
        ))}
      </footer>
    </div>
  );
}
