import type { AirtableRep } from './upcoming.contracts.js';

// Airtable record IDs keep each filter tied to the same rep if their name changes.
const roster = [
  { id: 'recJv7OlrMKjBWZnA', name: 'Vinnie' },
  { id: 'rec2hIQlfPlBP0hKP', name: 'Ryan' },
  { id: 'recYmC80ZHDDzFpuB', name: 'Tom' },
  { id: 'recaoic05mc8xa55B', name: 'Brendan' },
  { id: 'recRX4aL50FG3eHX3', name: 'Daniel' },
  { id: 'recNPjdnFhkvZTLoD', name: 'Andrew' },
  { id: 'recKImF52qL5sOnyo', name: 'Don' },
  { id: 'recnR6uqUk2ptf7bu', name: 'Jake' },
  { id: 'recvNPqKnjSKeDcaI', name: 'Heidi' },
  { id: 'recXaDIHj1barJOUj', name: 'Milly' },
  { id: 'recUtiyyBYSLybnhT', name: 'Ryan - Ali' },
];

export function upcomingRepFilterOptions(
  permittedReps: Pick<AirtableRep, 'id'>[],
) {
  const ids = new Set(permittedReps.map((rep) => rep.id));

  return roster.filter((rep) => ids.has(rep.id));
}
