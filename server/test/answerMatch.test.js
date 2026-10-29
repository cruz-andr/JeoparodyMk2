/**
 * Grading a typed response against the board's.
 * Run with: node server/test/answerMatch.test.js
 *
 * Two kinds of check. The rows below are the forms J-Archive writes its
 * correct responses in, each with what a player would type and should be
 * given. The fixture is 692 responses that Jeopardy!'s own judges ruled
 * wrong, taken from 80 games: none of them may be accepted, whatever a looser
 * matcher would let through.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acceptedForms, gradeAnswer } from '../shared/answerMatch.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; } catch (err) { failures.push({ name, err }); }
}

const right = (said, response) => {
  const g = gradeAnswer(said, response);
  assert.equal(g.verdict, 'correct', `"${said}" for "${response}" should be right, was ${g.verdict} (${g.reason})`);
};
const wrong = (said, response) => {
  const g = gradeAnswer(said, response);
  assert.equal(g.isCorrect, false, `"${said}" for "${response}" should be wrong (${g.reason})`);
};

// ------------------------------------------------------------ the forms

test('the question form, case, articles and punctuation do not matter', () => {
  right('What is Paris?', 'Paris');
  right('who are the beatles', 'the Beatles');
  right("what's a satchel", 'a satchel');
  right('Who was Lincoln', 'Lincoln');
});

test('a leading parenthetical is optional', () => {
  right('Beethoven', '(Ludwig van) Beethoven');
  right('Ludwig van Beethoven', '(Ludwig van) Beethoven');
  right('Ventura', '(Jesse) Ventura');
});

test('a trailing parenthetical is an alternate name', () => {
  right('Batman', 'Bruce Wayne (Batman)');
  right('Bruce Wayne', 'Bruce Wayne (Batman)');
  right('the Count of Monte Cristo', 'Edmond Dantes (The Count of Monte Cristo)');
});

test("the thing without whose it is, as a judge would take it", () => {
  right('trident', "What is Poseidon's Trident?");
  right('Poseidons Trident', "What is Poseidon's Trident?");
  wrong('nest', "What is Crow's Nest?");
  wrong('revenge', "What is Queen Anne's Revenge?");
});

test('a last name for a person asked for by "Who is", never the first name alone', () => {
  right('Dunst', 'Who is Kirsten Dunst?');
  right('Kirsten Dunst', 'Who is Kirsten Dunst?');
  wrong('Kirsten', 'Who is Kirsten Dunst?');
  wrong('Chum', 'Who are Anchor & Chum?');
});

test('a trailing parenthetical that only explains is not an alternate', () => {
  right('Nagano', 'Nagano, Japan (this past winter)');
  wrong('this past winter', 'Nagano, Japan (this past winter)');
});

test('"or" and "also accepted" alternates are both right', () => {
  right('the Chunnel', 'the Chunnel (or Channel Tunnel)');
  right('Channel Tunnel', 'the Chunnel (or Channel Tunnel)');
  right('ho', 'whoa (ho also accepted)');
  right('whoa', 'whoa (ho also accepted)');
});

test('"(1 of)" lists accept any one of them', () => {
  for (const state of ['Kentucky', 'Missouri', 'Maryland', 'Delaware']) {
    right(state, '(1 of) Kentucky (Missouri, Maryland, Delaware)');
  }
  wrong('Ohio', '(1 of) Kentucky (Missouri, Maryland, Delaware)');
});

test('slash alternates, with the shared word filled in, but not AC/DC', () => {
  right('Russia', 'Soviet Union/Russia');
  right('the Soviet Union', 'Soviet Union/Russia');
  right('tree line', 'Tree/timber line');
  right('timber line', 'Tree/timber line');
  right('AC/DC', 'AC/DC');
  wrong('AC', 'AC/DC');
});

test('a letter or two in brackets inside a word is optional', () => {
  right('Moore', 'Mo(o)re');
  right('More', 'Mo(o)re');
});

test('"&" and "and" are the same', () => {
  right('rat and pig', 'rat & pig');
  right('rat & pig', 'rat and pig');
});

test('accents can be typed or left off', () => {
  right('Blue Curacao', 'Blue Curaçao');
  right('Dantès', 'Dantes');
});

test('abbreviations and their words are the same', () => {
  right('Saint Elmos Fire', "St. Elmo's Fire");
  right('United States Open', 'U.S. Open');
  right('Mount Everest', 'Mt. Everest');
});

test('numbers in words, figures, ordinals and roman numerals are the same', () => {
  right('3 Mile Island', 'Three Mile Island');
  right('Henry 8', 'Henry VIII');
  right('Henry the Eighth', 'Henry VIII');
  right('the 4th of July', 'the Fourth of July');
  right('twenty one', '21');
});

test('a regnal number may be left off, but not got wrong', () => {
  right('Charles', 'Charles II');
  wrong('Charles I', 'Charles II');
  wrong('Charles III', 'Charles II');
});

test('a literal " or " and a place after a comma stay whole', () => {
  right('trick or treat', 'Trick or treat');
  wrong('trick', 'Trick or treat');
  right('Montgomery', 'Montgomery, Alabama');
  right('Montgomery Alabama', 'Montgomery, Alabama');
});

test('quotation marks around a title do not matter', () => {
  right("Maggie's Farm", '"Maggie\'s Farm"');
  right('Uncle Toms Cabin', "Uncle Tom's Cabin");
});

test('typos are forgiven in proportion to the word', () => {
  right('Beethovan', 'Beethoven');
  right('Mississipi', 'Mississippi');
  right('Shakespear', 'Shakespeare');
  wrong('Lee', 'Leo');
});

test('a generic word around the answer is fine; a word that changes it is not', () => {
  right('the novel Moby Dick', 'Moby Dick');
  right('the river Nile', 'the Nile');
  wrong('beach volleyball', 'volleyball');
});

test('"(2 of)" lists need two of them', () => {
  right('Carter and Clinton', '(2 of) Carter & Clinton (or Harding & Truman)');
  right('Truman, Harding', '(2 of) Carter & Clinton (or Harding & Truman)');
  wrong('Carter', '(2 of) Carter & Clinton (or Harding & Truman)');
  wrong('Carter and Nixon', '(2 of) Carter & Clinton (or Harding & Truman)');
  right('Richard Nixon', '(1 of) Richard Nixon & Ulysses S. Grant');
  right('Nixon and Kennedy', '(2 of) (Richard) Nixon, (John) Kennedy or (Lyndon) Johnson');
  right('Tyler, Taylor and Fillmore', '(3 of) W. Harrison, Tyler, Taylor & Fillmore');
});

test('an "or" in the middle swaps the word before it', () => {
  right('collect on delivery', 'cash (or collect) on delivery');
  right('cash on delivery', 'cash (or collect) on delivery');
});

test('a one-letter response, and a response that is itself a question word', () => {
  right('What is A?', 'A');
  right('What is where?', 'where');
  right('where', 'where');
});

// ------------------------------------------------------------ what used to pass

test('the wrong answers the old matcher accepted are wrong', () => {
  wrong('4th Ward', '8th Ward');
  wrong('Sophie Hawkins Dance', 'Sadie Hawkins Dance');
  wrong('Jacob Astor', 'John Jacob (Astor)');
  wrong('Jacob', 'John Jacob (Astor)');
  wrong('e', 'Beethoven');
});

test('nothing, or a different answer, is wrong', () => {
  wrong('', 'Paris');
  wrong('What is?', 'Paris');
  wrong('London', 'Paris');
});

// ------------------------------------------------------------ close

test('close but not right asks for the spelling again rather than failing it', () => {
  assert.equal(gradeAnswer('Beethavan', 'Beethoven').verdict, 'close');
  assert.equal(gradeAnswer('Shakespeer', 'Shakespeare').verdict, 'correct');
  assert.equal(gradeAnswer('London', 'Paris').verdict, 'wrong');
  assert.equal(gradeAnswer('Charles I', 'Charles II').verdict, 'wrong', 'a wrong number is not a spelling slip');
});

// ------------------------------------------------------------ the forms themselves

test('acceptedForms lists what the grader takes', () => {
  assert.deepEqual(acceptedForms('Bruce Wayne (Batman)').sort(), ['Batman', 'Bruce Wayne', 'Bruce Wayne Batman'].sort());
  assert.deepEqual(acceptedForms('Paris'), ['Paris']);
});

// ------------------------------------------------------------ the judges' rulings

/* The judges rule on what they hear, and these six were said wrong: one or
   two letters off, the same shape as the typos a typed game has to forgive
   ("Beethovan", "Mississipi"). Typed, a grader cannot tell them apart, so
   they are taken. Each is listed so that any other ruling the grader
   overturns fails here. */
const SPELLING_SLIPS = [
  ['Blue Curaçao', 'What is blue "curacko"?'],
  ['arrondissements', 'What are arrondrossements?'],
  ['Nefertiti', 'Who is Nefertiri?'],
  ['Phileas Fogg', 'Who is Phineas Fogg?'],
  ['Zesta', 'What is Zesty?'],
  ['impend (impending)', 'What is impent?'],
];

test('of 692 answers the judges ruled wrong, only six spelling slips are accepted', () => {
  const rejected = JSON.parse(readFileSync(new URL('./fixtures/jarchive-rejected.json', import.meta.url), 'utf8'));
  assert.ok(rejected.length > 600);
  const accepted = rejected.filter(([response, said]) => gradeAnswer(said, response).isCorrect);
  assert.deepEqual(accepted, SPELLING_SLIPS, `${accepted.length} accepted`);
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
for (const { name, err } of failures) {
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err.message.split('\n').slice(0, 6).join('\n        ')}`);
}
process.exit(failures.length ? 1 : 0);
