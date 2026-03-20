/**
 * Adds iOS platform support:
 *
 * - ios build configs
 * - xcode opener (shared with macos.ts)
 * - a setting 'iosteamid'
 * - Xcode and app-bundle specific cmake attributes
 */
import { Configurer, Builder, ConfigDesc, log } from 'jsr:@floooh/fibs@^1';
import { addXcodeOpener } from './xcode-opener.ts';

export function configure(c: Configurer) {
    addConfigs(c);
    addXcodeOpener(c);
    c.addSetting({
        name: 'iosteamid',
        default: 'noteamid',
        validate: () => ({ valid: true, hint: ''}),
    });
    // inject a couple of default plist and Xcode attributes
    c.addTargetAttributeInjector({
        name: 'ios-attrs',
        fn: (t, project, config) => {
            if (project.isIOS() && t.type() === 'windowed-exe') {
                const useARC = config.name.includes('ios-arc-');
                t.addProperties({
                    XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY: '"iPhone Developer"',
                    XCODE_ATTRIBUTE_CLANG_ENABLE_OBJC_ARC: useARC ? "YES" : "NO",
                    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER: '\\${PRODUCT_NAME}',
                    MACOSX_BUNDLE_GUI_IDENTIFIER: '\\${PRODUCT_NAME}',
                    MACOSX_BUNDLE_EXECUTABLE_NAME: '\\${EXECUTABLE_NAME}',
                    MACOSX_BUNDLE_PRODUCT_NAME: '\\${PRODUCT_NAME}',
                    MACOSX_BUNDLE_BUNDLE_NAME: '\\${PRODUCT_NAME}',
                });
                const iosTeamId = project.setting('iosteamid').value;
                if (iosTeamId !== project.setting('iosteamid').default) {
                    t.addProperties({
                        XCODE_ATTRIBUTE_DEVELOPMENT_TEAM: iosTeamId,
                    });
                }
            }
        }
    });
}

export function build(b: Builder) {
    if (b.isIOS()) {
        if (b.setting('iosteamid').value === b.setting('iosteamid').default) {
            log.warn(`No 'iosteamid' setting provided, only simulator builds supported`);
        }
        if (b.activeConfig().generator === 'xcode') {
            b.addCmakeVariable('CMAKE_XCODE_GENERATE_SCHEME', '1');
        } else {
            log.warn('Building for ios only supported with Xcode generator');
        }
    }
}

function addConfigs(c: Configurer) {
    const baseConfig: ConfigDesc = {
        name: 'ios',
        platform: 'ios',
        buildMode: 'debug',
        generator: 'xcode',
        opener: 'xcode',
        cmakeCacheVariables: {
            CMAKE_SYSTEM_NAME: 'iOS',
        },
    };
    c.addConfig({ ...baseConfig, name: 'ios-xcode-debug', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'ios-xcode-release', buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'ios-arc-xcode-debug', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'ios-arc-xcode-release', buildMode: 'release' });
}