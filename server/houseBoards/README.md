# House boards

Boards the site publishes itself, with no author shown: the collabs. Each
file here is one board, published when the server starts, at the slug its
file name gives it (`disney-jeopardy-40.json` is `/boards/disney-jeopardy-40`).

A file is `{ title, description, topic, featured, board }`, where `board` is
the stored board format in `server/shared/boardFormat.js`. It has to pass the
same checks as publishing from the editor, or it is skipped with a warning in
the server log. `featured: true` puts it in the Featured row. `cover` names an
image beside it (`disney-jeopardy-40.jpg`) to show as the board's cover; a
file without one leaves the cover alone.

Change a file and deploy, and the board on the site changes with it. Plays
are kept. A slug that already belongs to somebody's own board is never
touched.

## From an episode video

A new episode of the show is a board in a few minutes, on a Mac:

    npm run video-board -- ~/Downloads/episode-41.mp4 --youtube <its YouTube link>

That reads the video (about a minute) and writes a draft `board.json` and a
`review.md` beside it: what it could not be sure of, with the time to find
each in the video. Fix those, then

    npm run video-board -- publish ~/Downloads/episode-41-board/board.json

writes the board here, with its cover (the video's YouTube thumbnail) beside
it and every check the server makes, and it goes up on the next deploy. See `scripts/video-board/cli.mjs` for the options.
