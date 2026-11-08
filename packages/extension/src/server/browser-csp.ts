import { isIP } from 'node:net';

export interface BrowserCspOptions {
  origin?: string;
  issuer?: string;
  devIssuer?: string;
}

// fixture.next.agentage.io -> https://*.next.agentage.io; none for one label, a bare domain or an IP.
export const siblingSource = (origin: string | undefined): string[] => {
  const host = origin ? new URL(origin).hostname : '';
  const parent = host.split('.').slice(1);
  return isIP(host) || parent.length < 2 ? [] : [`https://*.${parent.join('.')}`];
};

// Pages and widgets load sibling deployments' modules and call auth and the deployments.
export const browserCsp = ({ origin, issuer, devIssuer }: BrowserCspOptions) => {
  const siblings = siblingSource(origin);
  const issuers = [issuer && new URL(issuer).origin, devIssuer].filter((v): v is string => !!v);
  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...siblings],
      connectSrc: ["'self'", ...issuers, ...siblings],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    },
  };
};
