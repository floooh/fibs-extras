import {
    Config,
    ConfigDesc,
    Configurer,
    host,
    log,
    Project,
    RunOptions,
    Target,
    ToolDesc,
    util,
} from 'jsr:@floooh/fibs@^1';
import { green } from 'jsr:@std/fmt@^1/colors';

const SDKVERSION = 29;

function getSdkName(): string {
    return `wasi-sdk-${SDKVERSION}.0-${host.arch()}-${host.platform()}`;
}

function getUrl(): string {
    return `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${SDKVERSION}/${getSdkName()}.tar.gz`;
}

export function configure(c: Configurer) {
    c.addCommand({ name: 'wasisdk', help: cmdHelp, run: cmdRun });
    c.addRunner({ name: 'wasi', run: runnerRun });
    c.addTool(tarTool);
    c.addTool(wasmtimeTool);
    addConfigs(c);
}

function addConfigs(c: Configurer) {
    const baseConfig: ConfigDesc = {
        name: 'wasi',
        platform: 'wasi',
        runner: 'wasi',
        toolchainFile: `${c.sdkDir()}/wasisdk/share/cmake/wasi-sdk.cmake`,
        buildMode: 'debug',
        cmakeVariables: {
            WASI_SDK_PREFIX: `${c.sdkDir()}/wasisdk`,
            CMAKE_EXECUTABLE_SUFFIX: '.wasm',
        },
        validate: (project: Project) => {
            if (!util.dirExists(wasisdkDir(project))) {
                return {
                    valid: false,
                    hints: [`WASI SDK not installed (run 'fibs wasisdk install')`],
                };
            } else {
                return { valid: true, hints: [] };
            }
        },
    };
    c.addConfig({ ...baseConfig, name: 'wasi-make-debug', generator: 'make', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'wasi-make-release', generator: 'make', buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'wasi-ninja-debug', generator: 'ninja', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'wasi-ninja-release', generator: 'ninja', buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'wasi-vscode-debug', generator: 'ninja', buildMode: 'debug', opener: 'vscode' });
    c.addConfig({
        ...baseConfig,
        name: 'wasi-vscode-release',
        generator: 'ninja',
        buildMode: 'release',
        opener: 'vscode',
    });
}

// register tar as optional tool
const tarTool: ToolDesc = {
    name: 'tar',
    platforms: ['windows', 'macos', 'linux'],
    optional: true,
    notFoundMsg: 'required for unpacking downloaded sdk archives',
    exists: async (): Promise<boolean> => {
        try {
            await util.runCmd('tar', {
                args: ['--version'],
                stdout: 'piped',
                showCmd: false,
            });
            return true;
        } catch (_err) {
            return false;
        }
    },
};

// register wasmtime as tool, since the Deno WASI support seems to have regressed
const wasmtimeTool: ToolDesc = {
    name: 'wasmtime',
    platforms: ['windows', 'linux', 'macos'],
    optional: true,
    notFoundMsg: 'required for running wasi executables',
    exists: async (): Promise<boolean> => {
        try {
            await util.runCmd('wasmtime', {
                args: ['--version'],
                stdout: 'piped',
                showCmd: false,
            });
            return true;
        } catch (_err) {
            return false;
        }
    },
};

function cmdHelp() {
    log.helpCmd([
        'wasisdk install',
        'wasisdk uninstall',
    ], 'install or uninstall the WASI SDK');
}

async function cmdRun(project: Project, cmdLineArgs: string[]) {
    const args = parseArgs(cmdLineArgs);
    if (args.install) {
        await install(project);
    } else if (args.uninstall) {
        uninstall(project);
    }
}

async function runnerRun(
    project: Project,
    _config: Config,
    target: Target,
    options: RunOptions,
) {
    // can assume here that run() will only be called for executable targets
    const path = `${project.distDir()}/${target.name}.wasm`;
    options = { ...options, args: [path, ...options.args] };
    await util.runCmd('wasmtime', options);
}

function parseArgs(cmdLineArgs: string[]): { install?: boolean; uninstall?: boolean } {
    const args: ReturnType<typeof parseArgs> = {};
    if (cmdLineArgs[1] === undefined) {
        throw new Error("expected a subcommand (run 'fibs help wasisdk')");
    }
    switch (cmdLineArgs[1]) {
        case 'install':
            args.install = true;
            break;
        case 'uninstall':
            args.uninstall = true;
            break;
        default:
            throw new Error(`unknown subcommand '${cmdLineArgs[1]} (run 'fibs help wasisdk')`);
    }
    return args;
}

function wasisdkDir(project: Project): string {
    return `${project.sdkDir()}/wasisdk`;
}

async function install(project: Project) {
    await download(project);
}

function uninstall(project: Project) {
    const dir = wasisdkDir(project);
    if (util.dirExists(dir)) {
        if (log.ask(`Delete directory ${dir}?`, false)) {
            log.info(`deleting ${dir}...`);
            Deno.removeSync(dir, { recursive: true });
            log.info(green('done.'));
        } else {
            log.info('nothing to do.');
        }
    } else {
        log.warn('WASI SDK not installed, nothing to do.');
    }
}

async function download(project: Project) {
    if (util.dirExists(wasisdkDir(project))) {
        throw new Error(`WASI SDK already installed, run 'fibs wasisdk uninstall' first`);
    }
    // NOTE: can't use the Deno compress package here because it doesn't preserve file attributes!
    if (!(await project.tool('tar').exists())) {
        throw new Error("tar command not found (run 'fibs diag tools'");
    }
    const sdkDir = project.sdkDir();
    const filename = getSdkName() + '.tgz';
    log.section('downloading WASI SDK');
    const url = getUrl();
    await util.download({ url, dir: sdkDir, filename });
    log.info(green('ok       '));
    log.section('uncompressing WASI SDK');
    await util.runCmd('tar', {
        args: ['xf', filename],
        cwd: sdkDir,
    });
    Deno.rename(`${sdkDir}/${getSdkName()}`, `${sdkDir}/wasisdk`);
    Deno.removeSync(`${sdkDir}/${filename}`);
    log.info(green('ok'));
}
