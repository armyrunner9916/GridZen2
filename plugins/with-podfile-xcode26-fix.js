// Patches the generated Podfile to add a post_install hook that:
//
//   1. Forces every pod's IPHONEOS_DEPLOYMENT_TARGET to 15.1 so stale
//      podspecs (RevenueCat, PurchasesHybridCommon stuck on 11.0) stop
//      emitting "below minimum" warnings. App target is already 15.1.
//
//   2. Patches fmt/include/fmt/base.h to force FMT_USE_CONSTEVAL=0.
//      Xcode 26 ships an Apple clang that fmt's auto-detection treats as
//      consteval-capable, but enforcement is too strict for the fmt
//      version bundled with React Native 0.79.x — every basic_format_string
//      call in fmt/format-inl.h fails to compile with "Call to consteval
//      function is not a constant expression".
//
//      A `-D FMT_USE_CONSTEVAL=0` flag won't work because the detection
//      block in base.h has no #ifndef guard and unconditionally redefines
//      the macro. So we patch the header itself, post pod-install.
//
// Without this plugin, `npx expo prebuild` would regenerate ios/Podfile and
// lose both fixes.

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# >>> with-podfile-xcode26-fix <<<';

const POST_INSTALL_BLOCK = `
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      end
    end

    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      original = File.read(fmt_base)
      patch_marker = '/* xcode26-fmt-patch */'
      unless original.include?(patch_marker)
        patched = original.sub(
          /\\/\\/ Detect consteval, C\\+\\+20 constexpr extensions and std::is_constant_evaluated\\.\\n(?:#.*\\n)*?#endif\\n#if FMT_USE_CONSTEVAL\\n(?:#.*\\n)*?#endif\\n/,
          "#{patch_marker}\\n#define FMT_USE_CONSTEVAL 0\\n#define FMT_CONSTEVAL\\n#define FMT_CONSTEXPR20\\n"
        )
        if patched != original
          File.chmod(0644, fmt_base) rescue nil
          File.write(fmt_base, patched)
          puts '[xcode26-fmt-patch] Patched fmt/base.h to disable consteval.'
        else
          puts '[xcode26-fmt-patch] WARNING: detection block not found in fmt/base.h.'
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
