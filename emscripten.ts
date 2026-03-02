import {
    Builder,
    Config,
    ConfigDesc,
    Configurer,
    git,
    log,
    Project,
    RunOptions,
    Schema,
    Target,
    util,
} from 'jsr:@floooh/fibs@^1';
import { green } from 'jsr:@std/fmt@^1/colors';

const EMSDK_URL = 'https://github.com/emscripten-core/emsdk.git';

type ImportOptions = {
    initialMemory?: number;
    allowMemoryGrowth?: boolean;
    stackSize?: number;
    useEmmalloc?: boolean;
    useFilesystem?: boolean;
    useLTO?: boolean;
    useClosure?: boolean;
    useMinimalShellFile?: boolean;
};

const schema: Schema = {
    initialMemory: { type: 'number', optional: true, desc: 'initial wasm memory in bytes (default: 32 MB)' },
    allowMemoryGrowth: { type: 'boolean', optional: true, desc: 'enable/disable wasm memory growth (default: true)' },
    stackSize: { type: 'number', optional: true, desc: 'wasm stack size in bytes (default: 512 KB)' },
    useEmmalloc: { type: 'boolean', optional: true, desc: 'enable/disable minimal emmalloc allocator (default: true)' },
    useFilesystem: {
        type: 'boolean',
        optional: true,
        desc: 'enable/disable emscripten filesystem layer (default: false)',
    },
    useLTO: { type: 'boolean', optional: true, desc: 'enable/disable LTO in release mode (default: true)' },
    useClosure: {
        type: 'boolean',
        optional: true,
        desc: 'enable/disable closure optimization in release mode (default: true)',
    },
    useMinimalShellFile: { type: 'boolean', optional: true, desc: 'use minimal shell.html file (default: true)' },
};

export function help(importName: string) {
    log.helpImport(importName, 'emscripten platform support', [{ name: 'emscripten', schema }]);
}

export function configure(c: Configurer) {
    c.addCommand({ name: 'emsdk', help: cmdHelp, run: cmdRun });
    c.addRunner({ name: 'emscripten', run: runnerRun });
    addConfigs(c);
}

export function build(b: Builder) {
    if (b.isEmscripten()) {
        const {
            initialMemory = 32 * 1024 * 1024,
            allowMemoryGrowth = true,
            stackSize = 512 * 1024,
            useEmmalloc = true,
            useFilesystem = false,
            useLTO = true,
            useClosure = true,
            useMinimalShellFile = true,
        } = b.importOptions<ImportOptions>('emscripten', schema);
        b.addLinkOptions([`-sINITIAL_MEMORY=${initialMemory}`, `-sSTACK_SIZE=${stackSize}`]);
        if (allowMemoryGrowth) {
            b.addLinkOptions(['-sALLOW_MEMORY_GROWTH=1']);
        }
        if (useEmmalloc) {
            b.addLinkOptions([`-sMALLOC='emmalloc'`]);
        }
        if (!useFilesystem) {
            b.addLinkOptions(['-sNO_FILESYSTEM=1']);
        }
        if (useLTO) {
            b.addCompileOptions({ opts: ['-flto'], buildMode: 'release' });
            b.addLinkOptions({ opts: ['-flto'], buildMode: 'release' });
        }
        if (useClosure) {
            b.addLinkOptions({ opts: ['--closure 1'], buildMode: 'release' });
        }
        if (useMinimalShellFile) {
            b.addLinkOptions([`--shell-file=${b.selfDir()}/shell.html`]);
        }
    }
}

function addConfigs(c: Configurer) {
    const baseConfig: ConfigDesc = {
        name: 'emsc',
        platform: 'emscripten',
        runner: 'emscripten',
        buildMode: 'debug',
        toolchainFile: `${c.sdkDir()}/emsdk/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake`,
        cmakeVariables: {
            CMAKE_EXECUTABLE_SUFFIX: '.html',
        },
        validate: (project: Project) => {
            if (!util.dirExists(emsdkDir(project))) {
                return {
                    valid: false,
                    hints: [`Emscripten SDK not installed (run 'fibs emsdk install')`],
                };
            } else {
                return { valid: true, hints: [] };
            }
        },
    };
    c.addConfig({ ...baseConfig, name: 'emsc-make-debug', generator: 'make', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'emsc-make-release', generator: 'make', buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'emsc-ninja-debug', generator: 'ninja', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'emsc-ninja-release', generator: 'ninja', buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'emsc-vscode-debug', generator: 'ninja', buildMode: 'debug', opener: 'vscode' });
    c.addConfig({
        ...baseConfig,
        name: 'emsc-vscode-release',
        generator: 'ninja',
        buildMode: 'release',
        opener: 'vscode',
    });
}

function cmdHelp() {
    log.helpCmd([
        'emsdk install [version=latest]',
        'emsdk list',
        'emsdk uninstall',
    ], 'install and maintain the Emscripten SDK');
}

async function cmdRun(project: Project, cmdLineArgs: string[]) {
    const args = parseArgs(cmdLineArgs);
    if (args.install && args.version) {
        await install(project, args.version);
    } else if (args.list) {
        await list(project);
    } else if (args.uninstall) {
        uninstall(project);
    }
}

async function runnerRun(
    project: Project,
    config: Config,
    target: Target,
    _options: RunOptions,
) {
    await emrun(project, { cwd: project.distDir(config.name), file: `${target.name}.html` });
}

export async function emrun(project: Project, options: { cwd: string; file: string }) {
    const { cwd, file } = options;
    const emrunFilename = project.isHostWindows() ? 'emrun.bat' : 'emrun';
    const emrunPath = `${project.sdkDir()}/emsdk/upstream/emscripten/${emrunFilename}`;
    // on macOS, explicitly use Chrome instead of Safari, emrun picks Safari even
    // when Chrome is set as the system default browser
    // FIXME: this should be configurable via cmdline args
    let forceChromeArgs: string[] = [];
    if (project.isHostMacOS()) {
        forceChromeArgs = ['--browser', 'chrome'];
    }
    await util.runCmd(emrunPath, {
        cwd,
        args: [...forceChromeArgs, file],
    });
}

function parseArgs(cmdLineArgs: string[]): {
    install?: boolean;
    list?: boolean;
    uninstall?: boolean;
    version?: string;
} {
    const args: ReturnType<typeof parseArgs> = {};
    if (cmdLineArgs[1] === undefined) {
        throw new Error("expected a subcommand (run 'fibs help emsdk')");
    }
    switch (cmdLineArgs[1]) {
        case 'install':
            args.install = true;
            args.version = cmdLineArgs[2];
            if (args.version === undefined) {
                args.version = 'latest';
            }
            break;
        case 'list':
            args.list = true;
            break;
        case 'uninstall':
            args.uninstall = true;
            break;
        default:
            throw new Error(`unknown subcommand '${cmdLineArgs[1]} (run 'fibs help emsdk')`);
    }
    return args;
}

function emsdkDir(project: Project): string {
    return `${project.sdkDir()}/emsdk`;
}

async function emsdk(project: Project, args: string[]): Promise<number> {
    const cmd = `${emsdkDir(project)}/emsdk`;
    if (!util.fileExists(cmd)) {
        throw new Error(`emsdk tool not found at ${cmd}, run 'fibs emsdk install`);
    }
    const res = await util.runCmd(cmd, {
        args,
        cwd: emsdkDir(project),
        winUseCmd: true,
    });
    return res.exitCode;
}

async function install(project: Project, version: string) {
    if (util.dirExists(emsdkDir(project))) {
        throw new Error(`Emscripten SDK already installed, run 'fibs emsdk uninstall' first`);
    }
    await cloneOrUpdateEmsdk(project);
    await emsdk(project, [
        'install',
        '--shallow',
        '--disable-assertions',
        version,
    ]);
    await activate(project, version);
}

async function activate(project: Project, version: string) {
    log.section(`activing emsdk version '${version}'`);
    await emsdk(project, ['activate', '--embedded', version]);
}

async function cloneOrUpdateEmsdk(project: Project) {
    const sdkRoot = util.ensureDir(project.sdkDir());
    const dir = emsdkDir(project);
    if (util.dirExists(dir)) {
        log.section(`updating emsdk in ${dir}`);
        await git.update({ dir, url: EMSDK_URL, force: true });
    } else {
        log.section(`cloning emsdk to ${dir} `);
        await git.clone({ url: EMSDK_URL, dir: sdkRoot });
    }
}

async function list(project: Project) {
    await emsdk(project, ['list']);
}

function uninstall(project: Project) {
    const dir = emsdkDir(project);
    if (util.dirExists(dir)) {
        if (log.ask(`Delete directory ${dir}?`, false)) {
            log.info(`deleting ${dir}...`);
            Deno.removeSync(dir, { recursive: true });
            log.info(green('done.'));
        } else {
            log.info('nothing to do.');
        }
    } else {
        log.warn('Emscripten SDK not installed, nothing to do.');
    }
}
