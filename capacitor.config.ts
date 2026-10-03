import type { CapacitorConfig } from '@capacitor/cli';

// Public operator configuration, never a credential. Native requests cannot change it.
const accountOrigin = process.env.PACKING_ACCOUNT_ORIGIN ?? '';
if (accountOrigin) {
  const url = new URL(accountOrigin);
  if (url.protocol !== 'https:' || url.origin !== accountOrigin || url.username || url.password) {
    throw new Error('PACKING_ACCOUNT_ORIGIN must be an exact HTTPS origin without a path.');
  }
}

const config: CapacitorConfig = {
  appId: 'com.packingscanning.app',
  appName: 'Packing Scanning',
  webDir: 'dist',
  // Bridge diagnostics can include account responses. Keep private records out of native logs.
  loggingBehavior: 'none',
  plugins: { PackingAccount: { serviceOrigin: accountOrigin } },
};

export default config;
