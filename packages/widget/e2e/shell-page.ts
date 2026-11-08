import { mountWidgets, readInstallation, type Deployment } from '@agentage/shell';
import { createBridge } from '@agentage/widget';

// A shell page as C6 types it: the installation from root, one bridge per deployment.
const { installation: doc } = await readInstallation(location.origin, 'harness');
const container = document.getElementById('shell') ?? document.body;
const token = () => Promise.resolve('aga_shell');
const host = (d: Deployment) => createBridge({ baseUrl: d.url, token });
const layout = doc.routes[location.pathname] ?? doc.routes['/'];
if (layout) await mountWidgets(layout, { host, container, deployments: doc.deployments });
document.body.dataset.mounted = 'true';
