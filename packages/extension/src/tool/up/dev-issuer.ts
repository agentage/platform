#!/usr/bin/env node
import { portFromEnv } from '../../runtime/build-info.js';
import { createIssuer } from './dev-issuer-app.js';

// The dev issuer of `up`: run from a part image, on the image's port so its HEALTHCHECK answers.
const port = portFromEnv(process.env);
createIssuer().listen(port, () => process.stderr.write(`dev issuer on :${port}\n`));
