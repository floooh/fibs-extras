/**
 * Adds extras to the core macOS platform support:
 *
 * - xcode build configs
 * - ARC vs no-ARC
 * - Xcode specific attributes
 * - essential plist.info attributes (e.g. bundle id)
 */
import { Configurer, ConfigDesc } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    addConfigs(c);
    // inject a couple of default plist and xcode attributes
    c.addTargetAttributeInjector({
        name: 'macos-attrs',
        fn: (t, project, config) => {
            if (project.isMacOS() && t.type() === 'windowed-exe') {
                const useARC = config.name.includes('macos-arc');
                if (config.generator === 'xcode') {
                    t.addProperties({
                        XCODE_ATTRIBUTE_CLANG_ENABLE_OBJC_ARC: useARC ? "YES" : "NO",
                        XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER: '\\${PRODUCT_NAME}',
                        MACOSX_BUNDLE_GUI_IDENTIFIER: '\\${PRODUCT_NAME}',
                        MACOSX_BUNDLE_EXECUTABLE_NAME: '\\${EXECUTABLE_NAME}',
                        MACOSX_BUNDLE_PRODUCT_NAME: '\\${PRODUCT_NAME}',
                        MACOSX_BUNDLE_BUNDLE_NAME: '\\${PRODUCT_NAME}',
                    });
                } else {
                    t.addCompileOptions([ useARC ? '-fobjc-arc' : '-fno-objc-arc' ]);
                    t.addProperties({
                        MACOSX_BUNDLE_GUI_IDENTIFIER: t.name(),
                        MACOSX_BUNDLE_PRODUCT_NAME: t.name(),
                        MACOSX_BUNDLE_BUNDLE_NAME: t.name(),
                    });
                }
            }
        },
    });
}

function addConfigs(c: Configurer) {
    const baseConfig: ConfigDesc = {
        name: 'macos',
        platform: 'macos',
        buildMode: 'debug',
        generator: 'xcode',
        opener: 'xcode',
    };
    c.addConfig({ ...baseConfig, name: 'macos-xcode-debug', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'macos-xcode-release', buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'macos-arc-xcode-debug', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'macos-arc-xcode-release', buildMode: 'release' });
}