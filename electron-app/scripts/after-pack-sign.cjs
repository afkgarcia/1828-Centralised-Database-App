/**
 * electron-builder afterPack hook (macOS only).
 *
 * Without a Developer ID identity, electron-builder 24 skips signing entirely,
 * which leaves the bundle's original linker-signed seal invalid (the packager
 * renamed the binary and added app.asar). Apple-silicon macOS SIGKILLs any
 * bundle in that state at exec time. A deep ad-hoc signature makes the local
 * build launchable; when a real identity is configured later, electron-builder
 * signs after this hook and simply replaces the ad-hoc signature.
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // On an iCloud-synced checkout, Finder/FileProvider xattrs land on the packed
  // bundle and codesign refuses ("resource fork … detritus not allowed").
  execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
