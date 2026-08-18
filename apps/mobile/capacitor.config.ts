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
  // The theme's --bg (tokens.css), so the frame the OS paints before the
  // WebView's first frame is the app's own color — a white flash at launch
  // is the loudest wrapper tell there is.
  backgroundColor: '#0d1117',
  plugins: {
    // Google only — the door's one button. The ID token it returns is
    // exchanged at the server's existing POST /api/auth/firebase for the
    // same session cookie the website gets; skipNativeAuth stays false so
    // the plugin completes the native Firebase sign-in it started.
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
    // The bundle ships inside the binary and paints in well under a second,
    // so a splash that LINGERS is pure delay dressed as branding: show it
    // only for as long as the WebView actually needs (auto-hide, no fixed
    // duration). Measured cold-start numbers land in plan task A4.
    SplashScreen: {
      backgroundColor: '#0d1117',
      launchAutoHide: true,
      launchShowDuration: 0,
    },
  },
};

export default config;
