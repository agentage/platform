// src/ui/echo.tsx: just a React component
import { useState } from 'react';
import { useHost } from '@agentage/widget';
import { Button, Card } from '@agentage/widget/ds';

export function Echo() {
  const { tool } = useHost();
  const [answer, setAnswer] = useState('');
  return (
    <Card title="probe">
      <Button onClick={async () => setAnswer((await tool('probe__echo', { msg: 'hi' })).msg)}>
        ping
      </Button>
      <p>{answer}</p>
    </Card>
  );
}
