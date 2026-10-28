# House boards

Boards the site publishes itself, with no author shown: the collabs. Each
file here is one board, published when the server starts, at the slug its
file name gives it (`disney-jeopardy-40.json` is `/boards/disney-jeopardy-40`).

A file is `{ title, description, topic, featured, board }`, where `board` is
the stored board format in `server/shared/boardFormat.js`. It has to pass the
same checks as publishing from the editor, or it is skipped with a warning in
the server log. `featured: true` puts it in the Featured row.

Change a file and deploy, and the board on the site changes with it. Plays
are kept. A slug that already belongs to somebody's own board is never
touched.
