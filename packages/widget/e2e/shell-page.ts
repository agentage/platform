import { mountWidgets, readInstallation } from '@agentage/shell';
import { createBridge } from '@agentage/widget';

// A shell page as C6 types it: the installation from root, one bridge per deployment url.
const doc = await readInstallation(location.origin, 'harness');
const [deployment] = doc.deployments;
const container = document.getElementById('shell') ?? document.body;
if (deployment) {
  const host = createBridge({ baseUrl: deployment.url, token: () => Promise.resolve('aga_shell') });
  await mountWidgets(doc.layout, { host, container, deployments: doc.deployments });
}
document.body.dataset.mounted = 'true';
