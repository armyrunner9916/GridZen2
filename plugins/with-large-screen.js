// Adds android:resizeableActivity="true" to the application element so the
// game is not penalized in Google Play's "large screen support" check.
// We keep the portrait orientation lock because the puzzle layout assumes a
// vertical grid; declaring resizeableActivity is the supported way to tell
// Android the activity can be hosted at varying sizes (split-screen, foldable
// inner displays) without forcing us to redesign for landscape.
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withLargeScreenSupport(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:resizeableActivity'] = 'true';
    }
    return cfg;
  });
};
