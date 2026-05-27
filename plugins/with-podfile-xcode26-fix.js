// Patches the generated Podfile to:
//   1. Disable FMT_USE_CONSTEVAL for the fmt pod. Xcode 26+ enforces consteval
//      strictly; the fmt version pinned by React Native 0.79.x trips that
//      check and fails to compile. Switching to constexpr clears it.
//   2. Force every pod's IPHONEOS_DEPLOYMENT_TARGET to 15.1 so stale podspecs
//      (RevenueCat, PurchasesHybridCommon) stop emitting "11.0 is below
//      minimum" warnings. The app target is already 15.1.
//
// Without this plugin, `npx expo prebuild` would regenerate ios/Podfile from
// the React Native template and lose our post_install additions.

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# >>> with-podfile-xcode26-fix <<<';

const POST_INSTALL_BLOCK = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        if target.name == 'fmt'
          existing = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
          existing = [existing] unless existing.is_a?(Array)
          unless existing.include?('FMT_USE_CONSTEVAL=0')
            config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = existing + ['FMT_USE_CONSTEVAL=0']
          end
        end
      end
    end
    # <<< with-podfile-xcode26-fix
`;

module.exports = function withPodfileXcode26Fix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes(MARKER)) return cfg;

      // Inject our block right after react_native_post_install(...) call so we
      // run inside the existing post_install do |installer| block.
      const anchor = 'react_native_post_install(';
      const anchorEnd = contents.indexOf(')', contents.indexOf(anchor));
      if (anchor && anchorEnd !== -1) {
        const insertAt = anchorEnd + 1;
        contents = contents.slice(0, insertAt) + '\n' + POST_INSTALL_BLOCK + contents.slice(insertAt);
        fs.writeFileSync(podfilePath, contents, 'utf8');
      } else {
        console.warn(
          '[with-podfile-xcode26-fix] could not find react_native_post_install anchor in Podfile; skipping patch.'
        );
      }
      return cfg;
    },
  ]);
};
