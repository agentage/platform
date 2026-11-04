// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { flush } from '../test-support/react.js';
import { Button, Card } from './index.js';

const render = async (node: React.ReactNode) => {
  const container = document.createElement('div');
  await flush(() => createRoot(container).render(node));
  return container;
};

describe('ds', () => {
  it('renders a design-system Card with a title header and content', async () => {
    const container = await render(
      <Card title="probe" className="w-80">
        <Button>ping</Button>
      </Card>
    );
    const card = container.querySelector('[data-slot="card"]');
    expect(card?.className).toContain('w-80');
    expect(card?.querySelector('[data-slot="card-title"]')?.textContent).toBe('probe');
    expect(card?.querySelector('[data-slot="card-content"] button')?.textContent).toBe('ping');
  });

  it('drops the header without a title', async () => {
    const container = await render(<Card>body</Card>);
    expect(container.querySelector('[data-slot="card-header"]')).toBeNull();
    expect(container.querySelector('[data-slot="card-content"]')?.textContent).toBe('body');
  });
});
