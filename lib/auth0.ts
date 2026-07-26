import { Auth0Client } from '@auth0/nextjs-auth0/server';

const rawDomain = process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER_BASE_URL || 'dev-jtfzglakt184mmu5.us.auth0.com';
const cleanDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();

export const auth0 = new Auth0Client({
  secret: process.env.AUTH0_SECRET || 'b599fea1e717d7dc9a6a2092a8398145d71cf6cf2d9178c13998156dc1a15de3',
  domain: cleanDomain,
  clientId: process.env.AUTH0_CLIENT_ID || 'hULHx7K31pAQaaQg7ahUJZ1c5tTlVXMo',
  clientSecret: process.env.AUTH0_CLIENT_SECRET || 'wXyMkyMNaVtgkUTIGz88lzAmhZkjqKG7j8bj43hbPF7iehwkIZ0NrzOOQhKa2OKZ',
  appBaseUrl: (process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || 'https://edu-tubers.vercel.app').replace(/\/$/, '').trim(),
  authorizationParameters: {
    scope: 'openid profile email',
  },
});
