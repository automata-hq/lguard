#!/usr/bin/env node

import { main } from './main.js';

// process.exitCode (not process.exit) so buffered stdout — e.g. large --json
// output piped to another process — always flushes before exit.
process.exitCode = await main(process.argv.slice(2));
