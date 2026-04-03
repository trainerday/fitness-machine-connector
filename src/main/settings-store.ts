import Store from 'electron-store';
import { AppSettings, TrustedDevice } from '../shared/types/settings';

const defaults: AppSettings = {
  theme: 'light',
  liveDataMode: 'device',
  trustedDevices: [],
};

const store = new Store<AppSettings>({ defaults });

export function getSettings(): AppSettings {
  return {
    theme: store.get('theme', defaults.theme),
    liveDataMode: store.get('liveDataMode', defaults.liveDataMode),
    trustedDevices: store.get('trustedDevices', defaults.trustedDevices),
  };
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  store.set(key, value);
}

export function addTrustedDevice(id: string, name: string): void {
  const current: TrustedDevice[] = store.get('trustedDevices', []);
  if (!current.some(d => d.id === id)) {
    store.set('trustedDevices', [...current, { id, name }]);
  }
}
