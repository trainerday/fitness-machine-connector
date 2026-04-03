import Store from 'electron-store';
import { AppSettings } from '../shared/types/settings';

const defaults: AppSettings = {
  theme: 'light',
  liveDataMode: 'device',
};

const store = new Store<AppSettings>({ defaults });

export function getSettings(): AppSettings {
  return store.store as AppSettings;
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  store.set(key, value);
}
