/**
 * The board quickplay deals when it cannot get a real one.
 *
 * Quickplay normally seats a table on an episode pulled from J-Archive, the
 * way the daily board is. That is a network call to somebody else's site, and
 * a table of three should not sit in a lobby waiting on it, so when the fetch
 * fails, or the server is told not to make it, this is dealt instead.
 *
 * Board convention throughout: `answer` is the clue shown on the board and
 * `question` is the correct response. Questions are grids, category-major:
 * questions[categoryIndex][rowIndex].
 */

const grid = (categories, rows, values) => categories.map((category, c) =>
  rows[c].map(([answer, question], r) => ({
    category, points: values[r], answer, question, revealed: false,
  })));

const ROUND_ONE = [200, 400, 600, 800, 1000];
const ROUND_TWO = [400, 800, 1200, 1600, 2000];

const firstCategories = ['WORLD CAPITALS', 'THE HUMAN BODY', 'SHAKESPEARE', 'MEASURE FOR MEASURE', 'THE MOVIES', 'RIVERS'];
const firstRows = [
  [
    ['This city on the Seine is the capital of France', 'What is Paris?'],
    ['Ottawa, not Toronto, is the capital of this country', 'What is Canada?'],
    ['Its capital, Canberra, was purpose-built as a compromise between Sydney and Melbourne', 'What is Australia?'],
    ['This South American capital sits about 2,850 metres up in the Andes', 'What is Quito?'],
    ['Since 1991 this city on the Volga has not been a capital; Astana, later Nur-Sultan, took the role in its country', 'What is Almaty?'],
  ],
  [
    ['This organ pumps roughly 7,000 litres of blood a day', 'What is the heart?'],
    ['The femur, the longest bone in the body, is found in this limb', 'What is the leg?'],
    ['Insulin is made in this organ tucked behind the stomach', 'What is the pancreas?'],
    ['The smallest bone in the body, the stapes, sits inside this organ', 'What is the ear?'],
    ['This is the medical name for the voice box', 'What is the larynx?'],
  ],
  [
    ['"To be, or not to be" is asked by this melancholy Dane', 'Who is Hamlet?'],
    ['Star-crossed lovers from the houses of Montague and Capulet', 'Who are Romeo and Juliet?'],
    ['Three witches greet this Scottish general on a heath', 'Who is Macbeth?'],
    ['Prospero rules a magical island in this late play', 'What is The Tempest?'],
    ['In "The Merchant of Venice" this moneylender demands a pound of flesh', 'Who is Shylock?'],
  ],
  [
    ['The number of centimetres in a metre', 'What is 100?'],
    ['A dozen dozen, this many items make a gross', 'What is 144?'],
    ['Water boils at this temperature on the Celsius scale', 'What is 100 degrees?'],
    ['A light-year measures this, not time', 'What is distance?'],
    ['On the Richter-style scales each whole number step means about this many times more ground shaking', 'What is ten?'],
  ],
  [
    ['This 1997 James Cameron film ends with a ship at the bottom of the Atlantic', 'What is Titanic?'],
    ['A boy named Kevin defends his house alone in this 1990 holiday comedy', 'What is Home Alone?'],
    ['"I\'ll be back" is first said by the title character of this 1984 film', 'What is The Terminator?'],
    ['This 1994 film follows a slow-witted man through Vietnam, ping-pong and a shrimp business', 'What is Forrest Gump?'],
    ['This 2019 South Korean film was the first non-English-language winner of Best Picture', 'What is Parasite?'],
  ],
  [
    ['Egypt\'s river, the longest in Africa', 'What is the Nile?'],
    ['This river runs through London', 'What is the Thames?'],
    ['The largest river by volume, it drains most of northern South America', 'What is the Amazon?'],
    ['Vienna, Budapest and Belgrade all sit on this river', 'What is the Danube?'],
    ['Called the Yellow River in English, this is China\'s second longest', 'What is the Huang He?'],
  ],
];

const secondCategories = ['SCIENCE', 'U.S. PRESIDENTS', 'MYTHOLOGY', 'MUSIC', 'ANIMALS', 'INVENTIONS'];
const secondRows = [
  [
    ['The chemical symbol Au stands for this metal', 'What is gold?'],
    ['This gas makes up about 78 percent of the air we breathe', 'What is nitrogen?'],
    ['The speed of light is about 300,000 of these units per second', 'What are kilometres?'],
    ['DNA\'s double helix structure was described in 1953 by Watson and this man', 'Who is Francis Crick?'],
    ['This particle, confirmed at CERN in 2012, gives other particles mass', 'What is the Higgs boson?'],
  ],
  [
    ['The first president of the United States', 'Who is George Washington?'],
    ['He delivered the Gettysburg Address in 1863', 'Who is Abraham Lincoln?'],
    ['The only president elected to four terms', 'Who is Franklin D. Roosevelt?'],
    ['This president resigned in 1974', 'Who is Richard Nixon?'],
    ['He was president for just 31 days in 1841, the shortest term', 'Who is William Henry Harrison?'],
  ],
  [
    ['The Greek god of the sea, brother of Zeus', 'Who is Poseidon?'],
    ['This hero\'s only weak spot was his heel', 'Who is Achilles?'],
    ['In Norse myth this god wields the hammer Mjolnir', 'Who is Thor?'],
    ['She opened a box, or in the original a jar, and let out the world\'s evils', 'Who is Pandora?'],
    ['This Egyptian god with a jackal\'s head oversaw mummification', 'Who is Anubis?'],
  ],
  [
    ['This Liverpool band released "Abbey Road" in 1969', 'Who are the Beatles?'],
    ['A standard piano has this many keys', 'What is 88?'],
    ['This composer was almost totally deaf when he finished his Ninth Symphony', 'Who is Beethoven?'],
    ['"Thriller", the best-selling album of all time, is by this artist', 'Who is Michael Jackson?'],
    ['This Italian word on a score tells the player to go slowly and broadly', 'What is largo?'],
  ],
  [
    ['The largest land animal alive today', 'What is the African elephant?'],
    ['This flightless bird of Australia is the second tallest in the world', 'What is the emu?'],
    ['A group of these big cats is called a pride', 'What are lions?'],
    ['The only mammal capable of true, sustained flight', 'What is the bat?'],
    ['This Australian animal has a duck-like bill and lays eggs', 'What is the platypus?'],
  ],
  [
    ['Alexander Graham Bell is credited with this device, first demonstrated in 1876', 'What is the telephone?'],
    ['Johannes Gutenberg\'s 15th-century press printed with this movable material', 'What is type?'],
    ['Tim Berners-Lee proposed this in 1989 while at CERN', 'What is the World Wide Web?'],
    ['This Scottish engineer\'s improvements to the steam engine powered the Industrial Revolution', 'Who is James Watt?'],
    ['In 1928 Alexander Fleming noticed this mould killing bacteria in a dish', 'What is penicillin?'],
  ],
];

export const FALLBACK_GAME = {
  source: 'house',
  round1: { categories: firstCategories, questions: grid(firstCategories, firstRows, ROUND_ONE) },
  round2: { categories: secondCategories, questions: grid(secondCategories, secondRows, ROUND_TWO) },
  final: {
    category: 'THE SOLAR SYSTEM',
    answer: 'Discovered in 1846 from its pull on Uranus, it is the only planet found by mathematical prediction before it was seen',
    question: 'What is Neptune?',
  },
};
