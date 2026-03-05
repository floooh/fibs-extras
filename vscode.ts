import { Config, ConfigDesc, Configurer, Project, RunOptions, RunResult, ToolDesc, util } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    c.addOpener({ name: 'vscode', generate, open });
    c.addTool(vscodeTool);
    c.addTool(vscodeCmakeTools);
    c.addTool(vscodeCppTools);
    c.addTool(vscodeWasmDwarfDebugging);
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
    writeLaunchJson(project, config, vscodeDir);
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
    const ws = {
        folders: [
            { path: project.dir() },
            ...project.imports().map((imp) => {
                return { path: imp.importDir };
            }),
        ],
        settings: {
            'cmake.statusbar.advanced': {
                ctest: { visibility: 'hidden' },
                testPreset: { visibility: 'hidden' },
                debug: { visibility: 'hidden' },
            },
            'cmake.debugConfig': { cwd: project.distDir(config.name) },
            'cmake.autoSelectActiveFolder': false,
            'cmake.ignoreCMakeListsMissing': true,
            'cmake.configureOnOpen': false,
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
