import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Streamloot Probe',
    description:
      'ADR 0005 Stage 0: measures whether chrome.webRequest can observe stream manifests. Observes only — never downloads, never phones home.',
    permissions: ['webRequest', 'storage'],
    // The probe must work on whatever site is being measured, so it cannot
    // enumerate hosts ahead of time. The real extension should narrow this.
    host_permissions: ['<all_urls>'],
  },
});
