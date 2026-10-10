// Measures the colour palette of every entry that does not have one yet. Local only: no AI, no network.
// The app does the same in the background while it is idle; this just does it all at once.
import { backfillPalettes } from '../src/lib/media/entry-palette';
import { dataDir } from '../src/lib/paths';
import { openLibrary } from '../src/lib/store/library';

async function main() {
  const lib = openLibrary(dataDir());
  let total = 0;
  for (let done = await backfillPalettes(lib, 50); done > 0; done = await backfillPalettes(lib, 50)) total += done;
  lib.close();
  console.log(total ? `Measured ${total} ${total === 1 ? 'entry' : 'entries'}.` : 'Every entry already has a palette.');
}

void main();
