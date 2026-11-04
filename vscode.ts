// LLM assisted.
import { Config, ConfigDesc, Configurer, Project, RunOptions, RunResult, ToolDesc, util, imports } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    c.addOpener({ name: 'vscode', generate, open });
    c.addTool(vscodeTool);
    c.addTool(vscodeCmakeTools);
    c.addTool(vscodeCppTools);
    c.addTool(vscodeWasmDwarfDebugging);
    c.addTool(vscodeCodeLLDB);
    addConfigs(c);
}

function addConfigs(c: Configurer) {
    const win = { platform: 'windows' };
    const mac = { platform: 'macos' };
    const linux = { platform: 'linux' };
    const vscode = { generator: 'ninja', opener: 'vscode' };
    const release = { buildMode: 'release' };
    const debug = { buildMode: 'debug' };
    const configs = [
        { ...win, ...vscode, ...release, name: 'win-vscode-release' },
        { ...win, ...vscode, ...debug, name: 'win-vscode-debug' },
        { ...mac, ...vscode, ...release, name: 'macos-vscode-release' },
        { ...mac, ...vscode, ...debug, name: 'macos-vscode-debug' },
        { ...linux, ...vscode, ...release, name: 'linux-vscode-release' },
        { ...linux, ...vscode, ...debug, name: 'linux-vscode-debug' },
    ] as ConfigDesc[];
    configs.forEach((config) => c.addConfig(config));
}

async function generate(project: Project, config: Config) {
    const vscodeDir = `${project.dir()}/.vscode`;
    util.ensureDir(vscodeDir);
    writeWorkspaceFile(project, config, vscodeDir);
    if (project.isAndroid()) {
        writeAndroidLaunchJson(project, config, vscodeDir);
        writeAndroidTasksJson(project, vscodeDir);
    } else {
        writeLaunchJson(project, config, vscodeDir);
    }
    if (project.isEmscripten()) {
        writeHttpServer(project, config);
    }
}

async function open(project: Project) {
    await run({
        args: [`${project.dir()}/.vscode/${project.name()}.code-workspace`],
        winUseCmd: true,
    });
}

function writeWorkspaceFile(project: Project, config: Config, vscodeDir: string) {
    const importDirs = project.imports().filter((imp) => imports.isLinked(project, imp.name)).map((imp) => imp.importDir);
    const ws = {
        folders: [
            { path: project.dir() },
            ...importDirs.map((d) => ({ path: d })),
        ],
        settings: {
            'cmake.debugConfig': { cwd: project.distDir(config.name) },
            'cmake.autoSelectActiveFolder': false,
            'cmake.ignoreCMakeListsMissing': true,
            'cmake.configureOnOpen': false,
            'cmake.enableAutomaticKitScan': false,
            'cmake.useCMakePresets': 'always',
            'cmake.exclude': importDirs,
            // the Android debug task is still running when debugging starts, VSCode
            // would then show an error popup for any error in the Problems panel
            ...(project.isAndroid() ? { 'debug.onTaskErrors': 'debugAnyway' } : {}),
        },
    };
    const path = `${vscodeDir}/${project.name()}.code-workspace`;
    try {
        Deno.writeTextFileSync(path, JSON.stringify(ws, null, '  '));
    } catch (err) {
        throw new Error(`Failed writing ${path}`, { cause: err });
    }
}

function writeLaunchJson(project: Project, config: Config, vscodeDir: string) {
    let launch;
    if (project.isEmscripten()) {
        launch = {
            version: '0.2.0',
            configurations: [{
                type: 'chrome',
                request: 'launch',
                name: 'Debug in Chrome',
                url: 'http://localhost:8080/${command:cmake.launchTargetFilename}',
                server: {
                    program: `${project.buildDir(config.name)}/httpserver.js`,
                },
            }],
        };
    } else {
        const getType = () => {
            switch (project.hostPlatform()) {
                case 'windows':
                    return 'cppvsdbg';
                case 'linux':
                    return 'cppdbg';
                default:
                    // on macOS use the CodeLLDB debug extension, since the MS C/C++ debugger
                    // integration is all kinds of broken
                    return 'lldb';
            }
        };
        const getMIMode = () => project.hostPlatform() === 'linux' ? 'gdb' : undefined;
        launch = {
            version: '0.2.0',
            configurations: [{
                name: 'Debug Current Target',
                request: 'launch',
                program: '${command:cmake.launchTargetPath}',
                cwd: project.distDir(config.name),
                args: [],
                type: getType(),
                MIMode: getMIMode(),
                // tweak lldb for faster startup on macOS
                initCommands: getType() !== 'lldb' ? undefined : [
                    "settings set symbols.load-on-demand true",
                    "settings set symbols.enable-external-lookup false",
                    // NOTE: enable-lldb-index-cache is crashy with CodeLLDB
                    // "settings set symbols.enable-lldb-index-cache true"
                ],
                env: { 'MTL_DEBUG_LAYER': '1' },
            }],
        };
    }
    const path = `${vscodeDir}/launch.json`;
    try {
        Deno.writeTextFileSync(path, JSON.stringify(launch, null, '  '));
    } catch (err) {
        throw new Error(`Failed writing ${path}`, { cause: err });
    }
}

// Android debugging via CodeLLDB, the lldb scripts are written by 'fibs android debug' (see android.ts)
function writeAndroidLaunchJson(project: Project, config: Config, vscodeDir: string) {
    const buildDir = project.buildDir(config.name);
    const androidConfig = (name: string, preLaunchTask: string) => ({
        name,
        type: 'lldb',
        request: 'launch',
        preLaunchTask,
        postDebugTask: 'fibs: android stop',
        targetCreateCommands: [`command source ${buildDir}/android-target.lldb`],
        processCreateCommands: [`command source ${buildDir}/android-process.lldb`],
    });
    const launch = {
        version: '0.2.0',
        configurations: [
            androidConfig('Android: Debug', 'fibs: android debug --wait'),
            androidConfig('Android: Debug (no wait)', 'fibs: android debug'),
        ],
    };
    const path = `${vscodeDir}/launch.json`;
    try {
        Deno.writeTextFileSync(path, JSON.stringify(launch, null, '  '));
    } catch (err) {
        throw new Error(`Failed writing ${path}`, { cause: err });
    }
}

function writeAndroidTasksJson(project: Project, vscodeDir: string) {
    // NOTE: Android targets are shared libraries, so CMake Tools has no launch target, use the build target instead
    const target = '${command:cmake.buildTargetName}';
    const fibsTask = (label: string, args: string[]) => ({
        label,
        type: 'shell',
        command: './fibs',
        windows: { command: '.\\fibs.cmd' },
        args,
        options: { cwd: project.dir() },
        problemMatcher: [],
    });
    // the debug task keeps running in --wait mode, VSCode starts debugging once
    // the ready marker printed by 'fibs android debug' shows up
    const debugTask = (label: string, args: string[]) => ({
        ...fibsTask(label, args),
        dependsOn: 'fibs: android build',
        isBackground: true,
        problemMatcher: {
            owner: 'fibs',
            pattern: { regexp: '^__fibs_no_match__$' },
            background: {
                activeBegin: true,
                beginsPattern: '^fibs android debug: starting',
                endsPattern: '^fibs android debug: ready',
            },
        },
    });
    const tasks = {
        version: '2.0.0',
        tasks: [
            fibsTask('fibs: android build', ['build', target]),
            debugTask('fibs: android debug', ['android', 'debug', target]),
            debugTask('fibs: android debug --wait', ['android', 'debug', target, '--wait']),
            fibsTask('fibs: android stop', ['android', 'stop', target]),
        ],
    };
    const path = `${vscodeDir}/tasks.json`;
    try {
        Deno.writeTextFileSync(path, JSON.stringify(tasks, null, '  '));
    } catch (err) {
        throw new Error(`Failed writing ${path}`, { cause: err });
    }
}

// FIXME: would be nice to not require separate http-server tool here:
function writeHttpServer(project: Project, config: Config) {
    const path = `${project.buildDir(config.name)}`;
    util.ensureDir(path);
    let src = "const { execSync } = require('child_process');\n";
    src += "execSync('http-server -c-1 -g .', {\n";
    src += `  cwd: '${project.distDir(config.name)}',\n`;
    src += "  stdio: 'inherit',\n";
    src += "  stderr: 'inherit',\n";
    src += '});\n';
    Deno.writeTextFileSync(`${path}/httpserver.js`, src);
}

const vscodeTool: ToolDesc = {
    name: 'vscode',
    platforms: ['windows', 'macos', 'linux'],
    optional: true,
    notFoundMsg: 'required for opening projects in VSCode',
    exists,
};

const vscodeCmakeTools: ToolDesc = {
    name: 'vscode-cmaketools',
    platforms: ['windows', 'macos', 'linux'],
    optional: true,
    notFoundMsg:
        'required for C/C++ development in VSCode (see: https://marketplace.visualstudio.com/items?itemName=ms-vscode.cmake-tools)',
    exists: () => hasExtension('ms-vscode.cmake-tools'),
};

const vscodeCppTools: ToolDesc = {
    name: 'vscode-cpptools',
    platforms: ['windows', 'macos', 'linux'],
    optional: true,
    notFoundMsg: 'required for C/C++ development in VSCode (see: https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)',
    exists: () => hasExtension('ms-vscode.cpptools'),
};

const vscodeWasmDwarfDebugging: ToolDesc = {
    name: 'vscode-wasmdwarf',
    platforms: ['windows', 'macos', 'linux'],
    optional: true,
    notFoundMsg:
        'required for WASM debugging in VSCode (see: https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-dwarf-debugging)',
    exists: () => hasExtension('ms-vscode.wasm-dwarf-debugging'),
};

const vscodeCodeLLDB: ToolDesc = {
    name: 'vscode-codelldb',
    platforms: ['windows', 'macos', 'linux'],
    optional: true,
    notFoundMsg:
        'required for Android debugging in VSCode (see: https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)',
    exists: () => hasExtension('vadimcn.vscode-lldb'),
};

export const httpServerTool: ToolDesc = {
    name: 'http-server',
    platforms: ['windows', 'macos', 'linux'],
    optional: true,
    notFoundMsg: 'required for Emscripten debugging in VSCode (npm i -g http-server)',
    exists: httpServerExists,
};

export async function httpServerExists(): Promise<boolean> {
    try {
        await util.runCmd('http-server', { args: ['-h'], stdout: 'null', showCmd: false });
        return true;
    } catch (_err) {
        return false;
    }
}

async function run(options: RunOptions): Promise<RunResult> {
    try {
        return await util.runCmd('code', options);
    } catch (err) {
        throw new Error(`Failed to run 'code'`, { cause: err });
    }
}

async function exists(): Promise<boolean> {
    try {
        const res = await run({
            args: ['--version'],
            stdout: 'null',
            stderr: 'null',
            showCmd: false,
            winUseCmd: true,
        });
        return res.exitCode === 0;
    } catch (_err) {
        return false;
    }
}

async function hasExtension(ext: string): Promise<boolean> {
    try {
        const res = await run({
            args: ['--list-extensions'],
            stdout: 'piped',
            stderr: 'piped',
            showCmd: false,
            winUseCmd: true,
        });
        return (res.exitCode === 0) && (res.stdout.includes(ext));
    } catch (_err) {
        return false;
    }
}
