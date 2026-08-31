import { useEffect, useRef, useState } from 'react';
import { myBoards, getBoard } from '../../services/api/boardsService';
import { parseQuestionFile, downloadSampleTemplate } from '../../services/questionImport';
import { normalizeBoard } from '@shared/boardFormat.js';
import './HostFillPanel.css';

/**
 * The three ways to fill a round that are not typing.
 *
 * One panel with three faces rather than three panels, because they answer the
 * same question and only differ in where the clues come from. Typing is not in
 * here: the board is already editable, so writing it yourself needs no panel
 * and no decision.
 */
export default function HostFillPanel({ kind, round, token, busy, onTopic, onBoard, onClose }) {
  const [topic, setTopic] = useState('');
  const [boards, setBoards] = useState(null);
  const [problem, setProblem] = useState('');
  const first = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    first.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  useEffect(() => {
    if (kind !== 'board' || !token) return;
    (async () => {
      try {
        const data = await myBoards(token);
        setBoards(data.boards.filter((b) => b.clueCount === 30));
      } catch (err) {
        setProblem(err.message);
        setBoards([]);
      }
    })();
  }, [kind, token]);

  const takeFile = async (file) => {
    if (!file) return;
    setProblem('');
    const result = await parseQuestionFile(file);
    if (!result.valid) {
      /* One reason, not a wall of them: the first thing wrong is the thing to
         fix, and thirty complaints about the same missing field is not help. */
      setProblem(result.errors[0] ?? 'That file is not a board.');
      return;
    }
    onBoard(normalizeBoard(result.data));
  };

  const takeBoard = async (slug) => {
    setProblem('');
    try {
      const data = await getBoard(slug, token);
      onBoard(data.board);
    } catch (err) {
      setProblem(err.message);
    }
  };

  const where = round === 2 ? 'Double Jeopardy' : 'round one';

  return (
    <div className="hf-scrim" onClick={() => !busy && onClose()}>
      <div className="hf-panel" role="dialog" aria-label="Fill the board" onClick={(e) => e.stopPropagation()}>
        {kind === 'ai' && (
          <>
            <h3>What is this game about?</h3>
            <p>
              Six categories and thirty clues come back for {where}, in about a
              minute. Change any of them afterwards, or re-roll a category you
              do not want.
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); if (topic.trim()) onTopic(topic.trim()); }}
            >
              <input
                ref={first}
                className="hf-field"
                value={topic}
                maxLength={120}
                disabled={Boolean(busy)}
                placeholder="The Cold War, your department, nineties handhelds"
                onChange={(e) => setTopic(e.target.value)}
              />
              <div className="hf-do">
                <button className="btn-primary" type="submit" disabled={!topic.trim() || Boolean(busy)}>
                  {busy || 'Write the board'}
                </button>
                <button type="button" className="plain-btn quiet-action" onClick={onClose} disabled={Boolean(busy)}>
                  Never mind
                </button>
              </div>
            </form>
          </>
        )}

        {kind === 'file' && (
          <>
            <h3>Open a board file</h3>
            <p>
              A board somebody exported, as a <code>.json</code>. It fills {where}.
            </p>
            <label className="hf-drop">
              <input type="file" accept="application/json,.json" onChange={(e) => takeFile(e.target.files?.[0])} />
              <span>Choose a file</span>
            </label>
            <div className="hf-do">
              <button className="plain-btn quiet-action" onClick={downloadSampleTemplate}>
                Download a template
              </button>
              <button className="plain-btn quiet-action" onClick={onClose}>Never mind</button>
            </div>
          </>
        )}

        {kind === 'board' && (
          <>
            <h3>Use one of your boards</h3>
            <p>
              Copied into {where}, so editing it here leaves the original on your
              shelf alone. Only finished boards are listed.
            </p>
            {boards === null ? (
              <p className="hf-quiet">Looking at your shelf.</p>
            ) : boards.length === 0 ? (
              <p className="hf-quiet">
                No finished boards yet. A board needs all thirty clues before it
                can be played.
              </p>
            ) : (
              <ul className="hf-list">
                {boards.map((b) => (
                  <li key={b.slug}>
                    <button className="plain-btn hf-board" onClick={() => takeBoard(b.slug)}>
                      <span className="hf-board-name">{b.title || 'Untitled board'}</span>
                      <span className="hf-board-note">{b.categories.slice(0, 3).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="hf-do">
              <button className="plain-btn quiet-action" onClick={onClose}>Never mind</button>
            </div>
          </>
        )}

        {problem && <p className="hf-problem">{problem}</p>}
      </div>
    </div>
  );
}
