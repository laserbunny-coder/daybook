// The kingdom beyond the home vale. Once the castle stands you march on a region: a 28-day campaign against
// its dragon, which plays by one twist. Win it and the region is yours, with a relic that helps from then on.
// Just data here; the rules live in quest.js and the map in kingdom.js.
export const CAMPAIGN_DAYS = 28;
export const MARCH_AT = 6500; // gold in the vault: the castle has to stand first
export const REGIONS = [
  { id: 'wood', name: 'Whispering Wood', dragon: 'Moss Drake', seed: [28, 30], col: ['#20402a', '#2c5636'], ink: '#6aa86a',
    twist: 'Morning quests (before 10am) are worth double, and the drake hunts them hard: only 15 minutes of grace.',
    short: 'Morning quests are worth double, with 15 minutes of grace', win: 'Win 18 of 28 days.', need: 18,
    relic: 'Dawn Lantern', relicTxt: '+5 gold every day you keep your first timed quest.', why: 'A good first campaign if you want to fix your mornings.' },
  { id: 'marsh', name: 'Saltmarsh', dragon: 'Swamp Hydra', seed: [40, 92], col: ['#3c4a34', '#4d5c40'], ink: '#9ab86a',
    twist: 'Moving a quest off its day costs all of its gold. The hydra has a head for each habit; keep that habit five days running to cut it off.',
    short: 'Moving a quest costs all of its gold', win: 'Cut off every head before day 28.', need: 18,
    relic: 'Hydra Scale', relicTxt: 'One free move every week.', why: 'Best for building every habit at once.' },
  { id: 'frost', name: 'Frostpeak', dragon: 'Frost Wyrm', seed: [112, 22], col: ['#7d8ea0', '#c9d6e2'], ink: '#bcd4ea',
    twist: 'Any-time quests are due at 6pm instead of midnight.', short: 'Any-time quests are due at 6pm', win: 'Win 20 of 28 days.', need: 20,
    relic: 'Frost Crown', relicTxt: 'Once a week, a lost day doesn\'t end your streak.', why: 'For when everything gets left to the evening.' },
  { id: 'storm', name: 'Stormcoast', dragon: 'Storm Drake', seed: [164, 58], col: ['#2b4660', '#3a5c7a'], ink: '#7ab0e0',
    twist: 'Event bonuses are doubled. Each day lightning strikes one timed quest: it is worth triple and gets no grace at all.',
    short: 'Event bonuses double; lightning strikes one quest a day', win: 'Win 18 of 28 days.', need: 18,
    relic: 'Storm Banner', relicTxt: '+2 gold on every event bonus.', why: 'Fits busy weeks full of calendar events.' },
  { id: 'ember', name: 'Ember Wastes', dragon: 'Ash Wyrm', seed: [132, 92], col: ['#5a2c1e', '#7a3a22'], ink: '#f2a33a',
    twist: 'No rest days: a day with fewer than three quests counts as lost.', short: 'A day with fewer than three quests is lost',
    win: 'Hold one 10-day win streak.', need: 10,
    relic: 'Ember Heart', relicTxt: 'Your streak boost to the village counts a quarter more.', why: 'The hard one. Save it for when you are on a roll.' },
  { id: 'spires', name: 'Sky Spires', dragon: 'Elder Dragon', seed: [100, 58], col: ['#4a4256', '#5e5470'], ink: '#c8b0f0',
    twist: 'Every twist, a different one each day.', short: 'A different twist every day', win: 'Win 21 of 28 days.', need: 21, locked: 4,
    relic: 'The Crown', relicTxt: 'You are crowned. Kept gold builds a tenth more.', why: 'The last region. It opens once you hold four.' },
];
export const HOME = { id: 'vale', name: 'Home Vale', dragon: 'Hatchling', seed: [60, 62], col: ['#3f5a2e', '#567a3a'] };
export const regionOf = id => REGIONS.find(r => r.id === id);
// Your title grows with every region you hold
export const TITLES = ['Lord of the Vale', 'Baron', 'Count', 'Duke', 'Prince', 'Grand Prince', 'King of the Spires'];
export const titleFor = (won, crowned) => crowned ? TITLES[6] : TITLES[Math.min(won, 5)];
