const PROVIDER_ANNOUNCE_EVENT = 'eip6963:announceProvider';
const PROVIDER_REQUEST_EVENT = 'eip6963:requestProvider';

const providers = new Map();
let listenersInitialized = false;

export function discoverProviders() {
  if (typeof window === 'undefined') return [];

  if (!listenersInitialized) {
    window.addEventListener(PROVIDER_ANNOUNCE_EVENT, (event) => {
      const { detail } = event;
      if (detail?.info?.uuid) {
        providers.set(detail.info.uuid, {
          uuid: detail.info.uuid,
          name: detail.info.name || 'Unknown Wallet',
          icon: detail.info.icon || '',
          rdns: detail.info.rdns || '',
          provider: detail.provider,
        });
      }
    });

    window.dispatchEvent(new Event(PROVIDER_REQUEST_EVENT));
    listenersInitialized = true;
  }

  return Array.from(providers.values());
}

export function getAvailableProviders() {
  return Array.from(providers.values());
}

export function getProviderByUUID(uuid) {
  return providers.get(uuid) || null;
}

export function onProviderDiscovered(callback) {
  if (typeof window === 'undefined') return () => {};

  const handler = (event) => {
    const { detail } = event;
    if (detail?.info?.uuid) {
      callback({
        uuid: detail.info.uuid,
        name: detail.info.name || 'Unknown Wallet',
        icon: detail.info.icon || '',
        rdns: detail.info.rdns || '',
        provider: detail.provider,
      });
    }
  };

  window.addEventListener(PROVIDER_ANNOUNCE_EVENT, handler);

  window.dispatchEvent(new Event(PROVIDER_REQUEST_EVENT));

  return () => window.removeEventListener(PROVIDER_ANNOUNCE_EVENT, handler);
}

export function announceProvider(info, provider) {
  if (typeof window === 'undefined') return;

  const event = new CustomEvent(PROVIDER_ANNOUNCE_EVENT, {
    detail: { info, provider },
  });

  window.dispatchEvent(event);
}
