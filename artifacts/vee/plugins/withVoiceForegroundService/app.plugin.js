/**
 * withVoiceForegroundService — Expo config plugin (2026-10-15, Sumon).
 *
 * Adds a foreground service of type "microphone" so voice keeps working when
 * the app is backgrounded (talking + hearing, in voice rooms and 1-to-1
 * calls — like IMO). Without this, Android suspends the app and the mic dies.
 *
 * What it does at prebuild (EAS build):
 *  1. Copies the Java sources into android/app/src/main/java/com/vee/app/voice/
 *  2. Declares the <service> in AndroidManifest (foregroundServiceType="microphone")
 *  3. Registers VoiceServicePackage in MainApplication.getPackages()
 *
 * No new npm dependency — our own minimal code (~200 lines Java total).
 */
const { withAndroidManifest, withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SERVICE_NAME = '.voice.VoiceForegroundService';
const PACKAGE_IMPORT = 'com.vee.app.voice.VoiceServicePackage';

function withVoiceServiceFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const srcDir = path.join(__dirname, 'java', 'com', 'vee', 'app', 'voice');
      const dstDir = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'java', 'com', 'vee', 'app', 'voice'
      );
      fs.mkdirSync(dstDir, { recursive: true });
      for (const f of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
      }
      return config;
    },
  ]);
}

function withVoiceServiceManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app['service'] = app['service'] || [];
    const exists = app['service'].some((s) => s.$ && s.$['android:name'] === SERVICE_NAME);
    if (!exists) {
      app['service'].push({
        $: {
          'android:name': SERVICE_NAME,
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone',
        },
      });
    }
    return config;
  });
}

function withVoiceServicePackage(config) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents;
    const isKotlin = config.modResults.path && config.modResults.path.endsWith('.kt');
    const importLine = isKotlin ? 'import ' + PACKAGE_IMPORT + '\n' : 'import ' + PACKAGE_IMPORT + ';\n';
    // 1. import — anchored on the package declaration (robust across templates)
    if (!src.includes(PACKAGE_IMPORT)) {
      const pkgRe = isKotlin ? /(^package [^\n]+\n)/m : /(^package [^;]+;\n)/m;
      const withImport = src.replace(pkgRe, '$1' + importLine);
      src = withImport !== src ? withImport : src.replace(/(import [^;\n]+;?\n)/, '$1' + importLine);
    }
    // 2. register in getPackages()
    if (!src.includes('VoiceServicePackage()')) {
      if (isKotlin) {
        // Kotlin template: "// add(MyReactNativePackage())" inside .apply { }
        if (src.includes('// add(MyReactNativePackage())')) {
          src = src.replace(
            '// add(MyReactNativePackage())',
            '// add(MyReactNativePackage())\n              add(VoiceServicePackage())'
          );
        }
      } else if (src.includes('// packages.add(new MyReactNativePackage());')) {
        src = src.replace(
          '// packages.add(new MyReactNativePackage());',
          '// packages.add(new MyReactNativePackage());\n      packages.add(new VoiceServicePackage());'
        );
      } else if (src.includes('getPackages()')) {
        // fallback: insert before "return packages;"
        src = src.replace(
          /(\n(\s*)return packages;\n)/,
          '\n$2packages.add(new VoiceServicePackage());$1'
        );
      }
    }
    config.modResults.contents = src;
    return config;
  });
}

module.exports = function withVoiceForegroundService(config) {
  config = withVoiceServiceFiles(config);
  config = withVoiceServiceManifest(config);
  config = withVoiceServicePackage(config);
  return config;
};
