// Check if test mode is enabled via environment variable
export const isTestModeEnabled = () => {
  return import.meta.env.VITE_ENABLE_TEST_MODE === 'true';
};

// Mock board data for testing without using AI credits
export const mockBoard = {
  genre: 'Test Board',
  categories: ['SCIENCE', 'HISTORY', 'MOVIES', 'SPORTS', 'MUSIC', 'GEOGRAPHY'],
  questions: [
    // SCIENCE
    [
      { category: 'SCIENCE', points: 200, answer: 'This planet is known as the Red Planet', question: 'What is Mars?', revealed: false },
      { category: 'SCIENCE', points: 400, answer: 'This force keeps us on the ground', question: 'What is gravity?', revealed: false },
      { category: 'SCIENCE', points: 600, answer: 'H2O is the chemical formula for this', question: 'What is water?', revealed: false },
      { category: 'SCIENCE', points: 800, answer: 'This organ pumps blood through the body', question: 'What is the heart?', revealed: false },
      { category: 'SCIENCE', points: 1000, answer: 'Einstein\'s famous equation E=mc² relates energy to this', question: 'What is mass?', revealed: false },
    ],
    // HISTORY
    [
      { category: 'HISTORY', points: 200, answer: 'This year marked the American Declaration of Independence', question: 'What is 1776?', revealed: false },
      { category: 'HISTORY', points: 400, answer: 'This ancient civilization built the pyramids', question: 'Who are the Egyptians?', revealed: false },
      { category: 'HISTORY', points: 600, answer: 'This wall divided Berlin for 28 years', question: 'What is the Berlin Wall?', revealed: false },
      { category: 'HISTORY', points: 800, answer: 'This ship sank on its maiden voyage in 1912', question: 'What is the Titanic?', revealed: false },
      { category: 'HISTORY', points: 1000, answer: 'This Roman emperor reportedly fiddled while Rome burned', question: 'Who is Nero?', revealed: false },
    ],
    // MOVIES
    [
      { category: 'MOVIES', points: 200, answer: 'This 1994 film features a prison escape through a sewage tunnel', question: 'What is The Shawshank Redemption?', revealed: false },
      { category: 'MOVIES', points: 400, answer: 'This green ogre lives in a swamp', question: 'Who is Shrek?', revealed: false },
      { category: 'MOVIES', points: 600, answer: '"Here\'s looking at you, kid" is from this classic film', question: 'What is Casablanca?', revealed: false },
      { category: 'MOVIES', points: 800, answer: 'This director made Jaws, E.T., and Jurassic Park', question: 'Who is Steven Spielberg?', revealed: false },
      { category: 'MOVIES', points: 1000, answer: 'This 1941 film\'s last word is "Rosebud"', question: 'What is Citizen Kane?', revealed: false },
    ],
    // SPORTS
    [
      { category: 'SPORTS', points: 200, answer: 'This sport uses a puck and is played on ice', question: 'What is hockey?', revealed: false },
      { category: 'SPORTS', points: 400, answer: 'This tennis tournament is played on grass courts', question: 'What is Wimbledon?', revealed: false },
      { category: 'SPORTS', points: 600, answer: 'This athlete won 23 Olympic gold medals in swimming', question: 'Who is Michael Phelps?', revealed: false },
      { category: 'SPORTS', points: 800, answer: 'This country has won the most FIFA World Cups', question: 'What is Brazil?', revealed: false },
      { category: 'SPORTS', points: 1000, answer: 'This boxer was known as "The Greatest"', question: 'Who is Muhammad Ali?', revealed: false },
    ],
    // MUSIC
    [
      { category: 'MUSIC', points: 200, answer: 'This band sang "Hey Jude" and "Let It Be"', question: 'Who are The Beatles?', revealed: false },
      { category: 'MUSIC', points: 400, answer: 'This King of Pop released "Thriller"', question: 'Who is Michael Jackson?', revealed: false },
      { category: 'MUSIC', points: 600, answer: 'This composer wrote the 5th Symphony while going deaf', question: 'Who is Beethoven?', revealed: false },
      { category: 'MUSIC', points: 800, answer: 'This instrument has 88 keys', question: 'What is a piano?', revealed: false },
      { category: 'MUSIC', points: 1000, answer: 'This singer\'s real name is Stefani Joanne Angelina Germanotta', question: 'Who is Lady Gaga?', revealed: false },
    ],
    // GEOGRAPHY
    [
      { category: 'GEOGRAPHY', points: 200, answer: 'This is the largest country by area', question: 'What is Russia?', revealed: false },
      { category: 'GEOGRAPHY', points: 400, answer: 'This river is the longest in the world', question: 'What is the Nile?', revealed: false },
      { category: 'GEOGRAPHY', points: 600, answer: 'This mountain is the tallest on Earth', question: 'What is Mount Everest?', revealed: false },
      { category: 'GEOGRAPHY', points: 800, answer: 'This ocean is the largest', question: 'What is the Pacific Ocean?', revealed: false },
      { category: 'GEOGRAPHY', points: 1000, answer: 'This city is the capital of Australia', question: 'What is Canberra?', revealed: false },
    ],
  ],
};
