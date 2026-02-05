import '../server/src/env';
import { resolveDispatcherForUrl } from '../server/src/network/pacUndici';
import { getActivePacUrl, resolvePacUrlForRequest } from '../server/src/network/pacWindows';

const targetUrl = process.argv[2] || process.env.TARGET_URL || 'https://api.openai.com/v1/responses';

const run = async () => {
  const selectedPacUrl = await resolvePacUrlForRequest('cli:pac-check');
  const dispatcher = await resolveDispatcherForUrl(targetUrl);

  console.log(JSON.stringify({
    targetUrl,
    selectedPacUrl,
    activePacUrl: getActivePacUrl(),
    dispatcherType: dispatcher?.constructor?.name ?? 'unknown',
  }, null, 2));
};

void run();
