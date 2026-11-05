import { afterAll } from 'vitest';
import { removeTempPackages } from './packages.js';

// Every test file's temp packages go with it: a run leaves nothing in the temp dir.
afterAll(removeTempPackages);
