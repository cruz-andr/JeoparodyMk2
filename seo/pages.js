/**
 * What each public address says about itself, to a search engine or an AI
 * assistant that reads the HTML without running the app.
 *
 * The app is drawn in the browser, so without this every address served the
 * same empty <div id="root"> under one title. seo/build.js writes a real page
 * for each entry: its own title, description and canonical link, structured
 * data, and a short readable version of the page inside #root, which React
 * replaces the moment it starts. Players never see the difference; crawlers
 * finally see a site.
 */
export const SITE_URL = 'https://jeoparody.andrescruz.xyz';
export const SITE_NAME = 'Jeoparody';

const NAV = [
  ['/', 'Home'],
  ['/daily', 'The Sixer'],
  ['/daily/board', 'The Board'],
  ['/archive', 'Archive'],
  ['/quickplay', 'Quickplay'],
  ['/multiplayer', 'Play with friends'],
  ['/boards', 'Community Boards'],
];

export const PAGES = [
  {
    path: '/',
    title: 'Jeoparody: free daily trivia in the style of Jeopardy, solo or with friends',
    description: 'Free Jeopardy-style trivia in your browser. A new daily board and six daily clues from real episodes, quickplay against other players, private rooms for friends, and community boards. No download.',
    heading: 'Jeoparody',
    body: [
      'Free trivia in the style of Jeopardy, played in your browser with nothing to install.',
      'Every day there is a new board of thirty clues and a run of six clues from easy to hard, taken from real episodes. Type your answer, and a judge accepts the way people really answer: a last name, an abbreviation, a typo.',
      'Play alone, against other players in quickplay, or open a private room and play with friends on their own phones, with a buzzer, Daily Doubles and Final Jeopardy.',
    ],
    home: true,
  },
  {
    path: '/daily',
    title: 'The Sixer: six daily trivia clues, easy to hard · Jeoparody',
    description: 'Six trivia clues a day from real Jeopardy episodes, climbing from easy to hard. Play for dollars, keep a streak, and see how you did against everyone else today.',
    heading: 'The Sixer',
    body: [
      'Six clues a day from a real episode, from the easiest row to the hardest. Each one pays more than the last, and a miss brings up a hint for one more try at half the money.',
      'Keep a streak, share your result, and see where you landed among everyone who played today.',
    ],
  },
  {
    path: '/daily/board',
    title: 'The Board: a free daily Jeopardy-style trivia board · Jeoparody',
    description: 'A fresh board every day: six categories and thirty clues from a real Jeopardy episode, the same for every player. Type your answers and beat the clock.',
    heading: 'The Board',
    body: [
      'A full round every day: six categories and thirty clues from a real episode, the same board for every player in the world.',
      'Pick any clue, type your response, and see how much of the board you can clear.',
    ],
  },
  {
    path: '/archive',
    title: 'Daily trivia archive: the last 90 days of boards · Jeoparody',
    description: 'Missed a day? Play any of the last ninety days of the Sixer and the Board. Four are free every week; an account opens the rest.',
    heading: 'The archive',
    body: ['Every Sixer and every Board from the last ninety days, to play whenever you like. Four are free each week, and a free account opens the whole archive.'],
  },
  {
    path: '/quickplay',
    title: 'Quickplay: Jeopardy-style trivia against other players · Jeoparody',
    description: 'Get matched with other players and play a full Jeopardy-style game from a real episode: buzz in, type your answer, wager on Daily Doubles and Final Jeopardy.',
    heading: 'Quickplay',
    body: ['Join the queue and play a full game from a real episode against other players: ring in first, type your answer, and wager it all in Final Jeopardy.'],
  },
  {
    path: '/multiplayer',
    title: 'Play Jeopardy-style trivia with friends online · Jeoparody',
    description: 'Open a private room, share the code, and play trivia with friends on their own phones: a real episode from any day, or a community board. Buzzer, Daily Doubles and Final Jeopardy.',
    heading: 'Play with friends',
    body: ['Open a room, read out the code, and everyone plays on their own phone or laptop. Pick a real episode from any day in the archive, roll a random one, or play a board the community made.'],
  },
  {
    path: '/boards',
    title: 'Community trivia boards: play and make your own · Jeoparody',
    description: 'Trivia boards made by players, from Disney to science, ready to play alone or with friends. Make your own Jeopardy-style board and share it.',
    heading: 'Community Boards',
    body: ['Boards written by players on every topic, ready to play solo or with friends. Make your own board and share the link.'],
  },
  {
    path: '/guidelines',
    title: 'Board guidelines · Jeoparody',
    description: 'What is allowed on a community board on Jeoparody.',
    heading: 'Board guidelines',
    body: ['What can and cannot go on a community board.'],
  },
  {
    path: '/privacy',
    title: 'Privacy policy · Jeoparody',
    description: 'What Jeoparody keeps, why, and how to delete it.',
    heading: 'Privacy',
    body: ['What the site keeps about you, why, and how to delete it.'],
  },
];

/* Addresses that are private, personal or one game's: never in search. */
export const PRIVATE_PATHS = ['/game/', '/join/', '/account', '/profile', '/auth/', '/settings', '/signin', '/signup', '/boards/mine'];

export { NAV };
