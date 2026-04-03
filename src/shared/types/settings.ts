export interface TrustedDevice {
  id: string;
  name: string;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  liveDataMode: 'device' | 'ftms';
  trustedDevices: TrustedDevice[];
}
