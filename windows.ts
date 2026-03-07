/**
 * Add opinionated extras to the core Windows platform support:
 *
 * - Visual Studio opener and build configs
 * - for each exe target copy DLLs into the target's directory
 *   for easier debugging
 * - set the Visual Studio debugger current directory to the targets
 *   output directory
 */
import { Configurer, ConfigDesc, util } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    addConfigs(c);
    addVStudioOpener(c);
    addCmakeCodeInjectors(c);
}

function addConfigs(c: Configurer) {
    const baseConfig: ConfigDesc = {
        name: 'win-base',
        platform: 'windows',
        opener: 'vstudio',
        buildMode: 'debug',
    };
    c.addConfig({ ...baseConfig, buildMode: 'debug', name: 'win-vstudio-debug' });
    c.addConfig({ ...baseConfig, buildMode: 'release', name: 'win-vstudio-release' });
}

function addVStudioOpener(c: Configurer) {
    c.addOpener({
        name: 'vstudio',
        generate: async (): Promise<void> => {},
        open: async (project, config): Promise<void> => {
            // up to VS2022, solution files have the .sln extension, since VS2026 .slnx
            const pathBase = `${project.buildDir(config.name)}/${project.name()}`;
            let path = `${pathBase}.slnx`;
            if (!util.fileExists(path)) {
                path = `${pathBase}.sln`;
            }
            await util.runCmd('start', {
                args: [path],
                cwd: project.dir(),
                showCmd: true,
                winUseCmd: true,
            });
        }
    });
}

function addCmakeCodeInjectors(c: Configurer) {
    // set debugger cwd to target output directory
    c.addCmakeCodeInjector({
        name: 'vstudio-debug-cwd',
        fn: (project, _config) => {
            let str = '';
            if (project.isMsvc()) {
                for (const target of project.targets()) {
                    if (target.type === 'plain-exe' || target.type === 'windowed-exe') {
                        str += `set_target_properties(${target.name} PROPERTIES VS_DEBUGGER_WORKING_DIRECTORY ${project.targetDistDir(target.name)})\n`;
                    }
                }
            }
            return str;
        },
    });
    // copy DLLs into target output directory
    c.addCmakeCodeInjector({
        name: 'vstudio-copy-dlls',
        fn: (project, _config) => {
            let str = '';
            if (project.isMsvc()) {
                for (const target of project.targets()) {
                    if (target.type === 'plain-exe' || target.type === 'windowed-exe') {
                        str += `add_custom_command(TARGET ${target.name} POST_BUILD COMMAND "\${CMAKE_COMMAND}" -E copy -t "$<TARGET_FILE_DIR:${target.name}>" "$<TARGET_RUNTIME_DLLS:${target.name}>" USES_TERMINAL COMMAND_EXPAND_LISTS)\n`;
                    }
                }
            }
            return str;
        }
    });
}