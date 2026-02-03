import { createPacResolver } from 'pac-resolver';

const pacUrl = process.env.PROXY_PAC_URL?.trim();
if (!pacUrl) {
  console.error('PROXY_PAC_URL não definido.');
  process.exit(1);
}

const targetUrl = 'https://api.openai.com/v1/models';
const targetHost = 'api.openai.com';

const response = await fetch(pacUrl);
if (!response.ok) {
  throw new Error(`Falha ao baixar PAC (${response.status}).`);
}

const pacScript = await response.text();
const resolver = createPacResolver(pacScript);
const decision = await resolver(targetUrl, targetHost);

console.log(decision);
