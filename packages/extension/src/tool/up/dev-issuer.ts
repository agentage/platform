#!/usr/bin/env node
import { portFromEnv } from '../../runtime/build-info.js';
import { createIssuer, DEV_AUDIENCE, DEV_ISSUER } from './dev-issuer-app.js';

// The dev issuer of `up`: run from a part image, on the image's port so its HEALTHCHECK answers.
const port = portFromEnv(process.env);
const settings = {
  issuer: process.env['AGENTAGE_ISSUER'] ?? DEV_ISSUER,
  audience: process.env['AGENTAGE_AUDIENCE'] ?? DEV_AUDIENCE,
};
createIssuer(settings).listen(port, () => process.stderr.write(`dev issuer on :${port}\n`));
