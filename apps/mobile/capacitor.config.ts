import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The shell's whole configuration. `webDir` points at the audited apps/web
 * build — the bundle ships INSIDE the binary, which is what makes the shell
 * paint with zero network requests (the plan's first speed budget).
 *
 * The appId is a NAMESPACE, not an address (the same argument the container
 * registry path carries): it grants nothing on its own, and store
 * registration may still rename it before the first release.
 */
const config: CapacitorConfig = {
  appId: 'app.disclosed.mobile',
  appName: 'Disclosed',
  webDir: '../web/dist',
};

export default config;
