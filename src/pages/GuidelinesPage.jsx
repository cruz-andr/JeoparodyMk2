import { useNavigate } from 'react-router-dom';
import '../components/boards/BoardsChrome.css';
import './GuidelinesPage.css';

/**
 * What is allowed in Community Boards.
 *
 * Written down because most platforms do not: roughly one in six surfaces its
 * rules, while most people say they want to know them. It is also the only
 * honest way to have a report button, since reporting something against a rule
 * nobody published is just reporting something you did not like.
 */
export default function GuidelinesPage() {
  const navigate = useNavigate();

  return (
    <div className="boards-page">
      <header className="boards-top">
        <button className="plain-btn boards-back" onClick={() => navigate('/boards')}>
          &lsaquo; Community Boards
        </button>
        <span className="boards-top-title">Guidelines</span>
        <span className="boards-top-spacer" />
      </header>

      <main className="boards-body guide">
        <h1>What belongs in Community Boards</h1>
        <p className="guide-deck">
          A board here is written by a player and can be opened by anyone. These
          are the rules that come with that, and they are short on purpose.
        </p>

        <section>
          <h2>Write your own clues</h2>
          <p>
            Boards are for clues you wrote. Transcribing a real episode and
            publishing it as a board is the one thing most likely to get this
            site taken down rather than warned, so it is not allowed, and it is
            a reason you can report a board for.
          </p>
          <p className="guide-aside">
            Playing the daily Board, which is drawn from a real episode, is a
            different thing: that is one board a day, credited, and not
            presented as anybody's own work.
          </p>
        </section>

        <section>
          <h2>Nothing you would not read out</h2>
          <p>
            A clue is read aloud to a room. Slurs, harassment of a real person,
            and anything sexual involving children are not welcome and the
            account goes with the board.
          </p>
        </section>

        <section>
          <h2>Boards, not adverts</h2>
          <p>
            Thirty clues about your product is not a board. Nor is a board whose
            clues are a link.
          </p>
        </section>

        <section>
          <h2>Being copied is not being robbed</h2>
          <p>
            Anyone can make their own copy of a public board, and every copy
            keeps a line saying whose it was. That is the deal for putting one
            here, and it is why the library is worth browsing. If you do not
            want that, an unlisted board is still yours to send to whoever you
            like.
          </p>
        </section>

        <section>
          <h2>What happens when something is reported</h2>
          <p>
            A person reads it. Nothing comes down automatically, because an
            automatic takedown is a button one stranger can point at another,
            and at this size a queue somebody actually reads is both achievable
            and honest.
          </p>
          <p>
            If a board breaks these rules it is removed. If it is only wrong, or
            only badly written, it stays: that is what the play count is for.
          </p>
        </section>

        <p className="guide-foot">
          Something not covered here, or a decision that looks wrong? Say so,
          and this page will get longer.
        </p>
      </main>
    </div>
  );
}
