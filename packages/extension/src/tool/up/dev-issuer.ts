#!/usr/bin/env node
import { createIssuer } from './dev-issuer-app.js';

// The dev issuer of `up`: run from a part image, on the image's port so its HEALTHCHECK answers.
const port = Number(process.env['PORT'] ?? 3000);
createIssuer().listen(port, () => process.stderr.write(`dev issuer on :${port}\n`));
