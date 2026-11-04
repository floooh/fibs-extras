/**
 * LLM assisted.
 *
 * Add Android platform support:
 *
 * - command to install/uninstall the Android SDK/NDK
 * - build configs
 * - integrate the Android NDK cmake toolchain file
 * - override windowed-exe target types to DLLs
 * - add post-build jobs to create Android APKs for each exe-target
 * - a runner to run on device via adb
 * - commands to prepare native debugging (see vscode.ts)
 */
import { Configurer, Config, ConfigDesc, Project, Target, RunOptions, RunResult, log, util, host } from 'jsr:@floooh/fibs@^1';
import { green, yellow } from 'jsr:@std/fmt@^1/colors';
import { basename } from 'jsr:@std/path@1';

// FIXME: make all these configurable via import options
const urls = {
    windows: 'https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip',
    macos: 'https://dl.google.com/android/repository/commandlinetools-mac-14742923_latest.zip',
    linux: 'https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip',
};
const androidAbi = 'arm64-v8a';
const androidPlatform = 'android-30';
const androidPackageRoot = 'org.fibs'
const androidBuildToolsVersion = '34.0.0';
const androidNdkVersion = '29.0.14206865';

export function configure(c: Configurer) {
    addConfigs(c);
    addTools(c);
    injectTargetAttributes(c);
    injectPostBuildStep(c);
    c.addCommand({ name: 'android', help: cmdHelp, run: cmdRun });
    c.addRunner({ name: 'android', run: runnerRun });
}

function addConfigs(c: Configurer) {
    const baseConfig: ConfigDesc = {
        name: 'android',
        platform: 'android',
        runner: 'android',
        buildMode: 'debug',
        // NOTE: wrapper toolchain file written by 'fibs android install', this
        // keeps the NDK version out of project-specific Android configs
        toolchainFile: `${c.sdkDir()}/android/android.toolchain.cmake`,
        // FIXME: make configurable
        cmakeCacheVariables: {
            ANDROID_ABI: androidAbi,
            ANDROID_PLATFORM: androidPlatform,
        },
        validate: (project: Project) => {
            if (!util.dirExists(sdkDir(project))) {
                return {
                    valid: false,
                    hints: [`Android SDK not installed (run 'fibs android install')`],
                };
            } else if (!util.dirExists(ndkDir(project))) {
                return {
                    valid: false,
                    hints: [`Android NDK ${androidNdkVersion} not installed (run 'fibs android uninstall' and 'fibs android install')`],
                };
            } else {
                return { valid: true, hints: [] };
            }
        },
    };
    c.addConfig({ ...baseConfig, name: 'android-make-debug', generator: 'make', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'android-make-release', generator: 'make', buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'android-ninja-debug', generator: 'ninja', buildMode: 'debug' });
    c.addConfig({ ...baseConfig, name: 'android-ninja-release', generator: 'ninja' , buildMode: 'release' });
    c.addConfig({ ...baseConfig, name: 'android-vscode-debug', generator: 'ninja', buildMode: 'debug', opener: 'vscode' });
    c.addConfig({ ...baseConfig, name: 'android-vscode-release', generator: 'ninja', buildMode: 'release', opener: 'vscode' });
}

function addTools(c: Configurer) {
    c.addTool({
        name: 'java',
        platforms: ['windows', 'macos', 'linux'],
        optional: true,
        notFoundMsg: 'required for Android development (part of JDK 17)',
        exists: () => javaToolExists('java'),
    });
    c.addTool({
        name: 'javac',
        platforms: ['windows', 'macos', 'linux'],
        optional: true,
        notFoundMsg: 'required for Android development (part of JDK 17)',
        exists: () => javaToolExists('javac'),
    });
    c.addTool({
        name: 'unzip',
        platforms: ['windows', 'macos', 'linux'],
        optional: true,
        notFoundMsg: 'required for installing the Android SDK',
        exists: unzipExists,
    });
}

function injectTargetAttributes(c: Configurer) {
    c.addTargetAttributeInjector({
        name: 'android-target-attrs',
        fn: (t, project, _config) => {
            if (project.isAndroid() && t.type() === 'windowed-exe') {
                // override windowed-exe type with dll
                t.setOverrideType('dll');
                // don't build into dist dir, but into regular build dir
                t.addProperties({
                    LIBRARY_OUTPUT_DIRECTORY: project.buildDir(),
                    LIBRARY_OUTPUT_DIRECTORY_DEBUG: project.buildDir(),
                    LIBRARY_OUTPUT_DIRECTORY_RELEASE: project.buildDir(),
                });
            }
        }
    })
}

function getPackageName(target: Target): string {
    return `${androidPackageRoot}.${target.name.replaceAll('-', '_')}`;
}

function injectPostBuildStep(c: Configurer) {
    c.addCmakeCodeInjector({
        name: 'android-postbuild-jobs',
        fn: (project, _config) => {
            let str = '';
            if (project.isAndroid()) {
                for (const target of project.targets()) {
                    if (target.type === 'windowed-exe') {
                        str += `add_custom_command(TARGET ${target.name} POST_BUILD `;
                        str += `COMMAND \${DENO} run --allow-all --no-config "${c.selfDir()}/android/create-apk.ts" `;
                        str += `--importdir "${c.selfDir()}" `;
                        str += `--sdkdir "${c.sdkDir()}/android" `;
                        str += `--builddir "${project.buildDir()}" `;
                        str += `--targetdistdir "${project.targetDistDir(target.name)}" `;
                        str += `--name ${target.name} `;
                        str += `--abi \${ANDROID_ABI} `;
                        str += `--platformversion \${ANDROID_PLATFORM_LEVEL} `;
                        str += `--buildtoolsversion ${androidBuildToolsVersion} `;
                        str += `--package ${getPackageName(target)})\n`;
                    }
                }
            }
            return str;
        }
    })
}

async function javaToolExists(cmd: string): Promise<boolean> {
    try {
        await util.runCmd(cmd, {
            args: ['-version'],
            stdout: 'piped',
            stderr: 'piped',
            showCmd: false,
        });
        return true;
    } catch (_err) {
        return false;
    }
}

async function unzipExists(): Promise<boolean> {
    try {
        await util.runCmd('unzip', {
            args: ['-v'],
            stdout: 'piped',
            stderr: 'piped',
            showCmd: false,
        });
        return true;
    } catch (_err) {
        return false;
    }
}

function sdkDir(project: Project): string {
    return `${project.sdkDir()}/android`;
}

function ndkDir(project: Project): string {
    return `${sdkDir(project)}/ndk/${androidNdkVersion}`;
}

function cmdHelp() {
    log.helpCmd([
        'android install',
        'android uninstall'
    ], 'install or uninstall Android SDK');
    log.helpCmd([
        'android debug [target]',
        'android debug [target] --wait',
    ], [
        'install and start app, start lldb-server and write lldb attach scripts,',
        'with --wait the app waits until a native debugger has attached',
    ]);
    log.helpCmd([
        'android stop [target]',
    ], 'stop app and lldb-server on device');
}

async function cmdRun(project: Project, cmdLineArgs: string[]) {
    const args = cmdParseArgs(cmdLineArgs);
    if (args.install) {
        await install(project);
    } else if (args.uninstall) {
        await uninstall(project);
    } else if (args.debug) {
        await debug(project, args.target!, args.wait ?? false);
    } else if (args.stop) {
        await stop(project, args.target!);
    }
}

function cmdParseArgs(cmdLineArgs: string[]): {
    install?: boolean,
    uninstall?: boolean,
    debug?: boolean,
    stop?: boolean,
    target?: string,
    wait?: boolean,
} {
    const args: ReturnType<typeof cmdParseArgs> = {};
    if (cmdLineArgs[1] === undefined) {
        throw new Error(`expected a subcommand (run 'fibs help android')`);
    }
    switch (cmdLineArgs[1]) {
        case 'install': args.install = true; break;
        case 'uninstall': args.uninstall = true; break;
        case 'debug': args.debug = true; break;
        case 'stop': args.stop = true; break;
        default: throw new Error(`unknown subcommand ${cmdLineArgs[1]} (run 'fibs help android')`);
    }
    if (args.debug || args.stop) {
        if (cmdLineArgs[2] === undefined) {
            throw new Error(`expected a target name (run 'fibs help android')`);
        }
        args.target = cmdLineArgs[2];
        args.wait = cmdLineArgs.slice(3).includes('--wait');
    }
    return args;
}

async function install(project: Project) {
    if (!(await javaToolExists('javac'))) {
        throw new Error(`please install a Java JDK version 17 (run 'fibs diag tools')`);
    }
    if (!(await unzipExists())) {
        throw new Error(`can't find 'unzip' cmdline tool (run 'fibs diag tools')`);
    }
    if (util.dirExists(sdkDir(project))) {
        throw new Error(`Android SDK already installed, run 'fibs android uninstall' first`);
    }
    util.ensureDir(sdkDir(project));

    // download and extract the cmdline tools package
    const zipFilename = await downloadAndroidCmdlineToolsZip(project);
    log.info('downloaded to ', zipFilename);

    // unzip the archive (NOTE: we need to use the unzip cmdline tool, because
    // Deno unzip packages don't preserve the execute file attribute)
    await unzipFile(zipFilename, sdkDir(project));

    // install required SDK packages
    // FIXME: the platform version (e.g. 'android-30') should
    // be overridable via import-options
    await installSdkPackage(project, `platforms;${androidPlatform}`);
    await installSdkPackage(project, `build-tools;${androidBuildToolsVersion}`);
    await installSdkPackage(project, 'platform-tools');
    await installSdkPackage(project, `ndk;${androidNdkVersion}`);
    writeToolchainWrapper(project);
}

// write a toolchain file at a fixed path which includes the versioned NDK toolchain file
function writeToolchainWrapper(project: Project) {
    const path = `${sdkDir(project)}/android.toolchain.cmake`;
    const ndkToolchainPath = `${ndkDir(project)}/build/cmake/android.toolchain.cmake`.replaceAll('\\', '/');
    Deno.writeTextFileSync(path, `include("${ndkToolchainPath}")\n`);
    log.info(`written ${path}`);
}

async function downloadAndroidCmdlineToolsZip(project: Project) {
    const url = urls[host.platform()];
    const zipPath = `${sdkDir(project)}/${basename(url)}`;
    log.info(yellow(`=== downloading ${url}...`));
    await downloadFile(url, zipPath);
    return zipPath;
}

async function downloadFile(url: string, dstFilePath: string) {
    const response = await fetch(url);
    if (response.body) {
        const file = await Deno.open(dstFilePath, { write: true, create: true });
        const writer = file.writable.getWriter();
        const reader = response.body.getReader();
        let receivedBytes = 0;
        while (true) {
            const { done, value: bytes } = await reader.read();
            if (done) break;
            await writer.write(bytes);
            receivedBytes += bytes.length;
            const receivedMB = (receivedBytes / (1024 * 1024)).toFixed(2);
            Deno.stdout.writeSync(new TextEncoder().encode(`\r ${receivedMB} MB`));
        }
        await writer.close();
    }
}

async function unzipFile(zipfilePath: string, dstDir: string) {
    await util.runCmd('unzip', {
        args: [zipfilePath],
        cwd: dstDir,
        winUseCmd: true,
        showCmd: true,
    });
}

async function installSdkPackage(project: Project, pkg: string) {
    log.info(`installing Android SDK package ${green(pkg)}...`);
    const binPath = `${sdkDir(project)}/cmdline-tools/bin/`;
    await util.runCmd(`${binPath}/sdkmanager`, {
        args: [
            '--verbose',
            `--sdk_root=${sdkDir(project)}`,
            pkg
        ],
        cwd: binPath,
        winUseCmd: true,
    });
}

async function uninstall(project: Project) {
    const dir = sdkDir(project);
    if (util.dirExists(dir)) {
        if (log.ask(`Delete directory ${dir}?`, false)) {
            log.info(`deleting ${dir}...`);
            Deno.removeSync(dir, { recursive: true });
            log.info(green('done.'));
        } else {
            log.info('nothing to do.');
        }
    } else {
        log.warn('Android SDK not installed, nothing to do.');
    }
}

async function runnerRun(project: Project, config: Config, target: Target, _options: RunOptions) {
    const adbPath = `${sdkDir(project)}/platform-tools/adb`;
    const pkgName = getPackageName(target);
    const cwd = project.targetDistDir(target.name, config.name);
    // NOTE: kill a running lldb-server before uninstalling, otherwise it becomes an orphan
    await stopOnDevice(project, pkgName);
    await util.runCmd(adbPath, { args: [ 'uninstall', pkgName ], cwd });
    await util.runCmd(adbPath, { args: [ 'install', `${target.name}.apk`], cwd });
    await util.runCmd(adbPath, {
        args: [
            'shell', 'am',
            'start',
            '-n', `${pkgName}/android.app.NativeActivity`,
        ],
        cwd,
    });
    await util.runCmd(adbPath, { args: ['logcat'], cwd });
}

// NOTE: the VSCode tasks written by vscode.ts look for these markers on stdout
const debugStartMarker = 'fibs android debug: starting';
const debugReadyMarker = 'fibs android debug: ready';

async function debug(project: Project, targetName: string, wait: boolean) {
    console.log(debugStartMarker);
    if (!project.isAndroid()) {
        throw new Error(`active config '${project.activeConfig().name}' is not an Android config`);
    }
    const config = project.activeConfig();
    const target = project.target(targetName);
    if (target.type !== 'windowed-exe') {
        throw new Error(`target '${targetName}' is not an Android app`);
    }
    const pkg = getPackageName(target);
    const apkPath = `${project.targetDistDir(target.name, config.name)}/${target.name}.apk`;
    if (!util.fileExists(apkPath)) {
        throw new Error(`${apkPath} not found (run 'fibs build ${target.name}')`);
    }
    // NOTE: a unique socket name per run, because an orphaned lldb-server from a previously
    // uninstalled app (which can't be killed without root) may still block the old name
    const socket = `/${pkg}/debug-${Date.now()}.sock`;
    // remove stale lldb scripts, so that the debugger fails early if this command fails
    removeLldbScripts(project, config);
    // NOTE: stop before (re-)installing, since after an uninstall the app gets a new user id,
    // and the old lldb-server can't be killed via 'run-as' anymore
    await stopOnDevice(project, pkg);
    // NOTE: updating fails if the installed app was signed with a different debug key
    // (the debug keystore is created per build dir), in that case uninstall first
    if ((await adb(project, ['install', '-r', apkPath], { check: false })).exitCode !== 0) {
        await adb(project, ['uninstall', pkg], { check: false });
        await adb(project, ['install', apkPath]);
    }

    // lldb-server must run as app user from the app data dir to be able to attach,
    // without --server it exits after the debug session, so it can't become an orphan
    await adb(project, ['push', lldbServerPath(project), '/data/local/tmp/lldb-server']);
    await adb(project, ['shell', `cat /data/local/tmp/lldb-server | run-as ${pkg} sh -c 'cat > ./lldb-server && chmod 700 ./lldb-server'`]);
    await adb(project, ['shell', `run-as ${pkg} sh -c './lldb-server platform --listen unix-abstract://${socket} </dev/null >/dev/null 2>&1 &'`]);

    // with 'am start -D' the app waits for a JDWP debugger before loading the native lib
    await adb(project, ['shell', 'am', 'start', ...(wait ? ['-D'] : []), '-n', `${pkg}/android.app.NativeActivity`]);
    const pid = await waitForPid(project, pkg);
    writeLldbScripts(project, config, socket, pid);
    console.log(debugReadyMarker);
    if (wait) {
        await releaseWaitingApp(project, pkg, pid);
    }
}

async function stop(project: Project, targetName: string) {
    await stopOnDevice(project, getPackageName(project.target(targetName)));
}

async function stopOnDevice(project: Project, pkg: string) {
    await adb(project, ['shell', 'am', 'force-stop', pkg]);
    // NOTE: force-stop doesn't kill lldb-server, and pkill fails if nothing is found
    await adb(project, ['shell', 'run-as', pkg, 'pkill', '-f', 'lldb-server'], { check: false });
}

async function adb(project: Project, args: string[], options: { check?: boolean, piped?: boolean } = {}): Promise<RunResult> {
    const { check = true, piped = false } = options;
    const res = await util.runCmd(`${sdkDir(project)}/platform-tools/adb`, {
        args,
        stdout: piped ? 'piped' : 'inherit',
        stderr: piped ? 'piped' : 'inherit',
        showCmd: !piped,
    });
    if (check && res.exitCode !== 0) {
        throw new Error(`adb ${args.join(' ')} failed with exit code ${res.exitCode}`);
    }
    return res;
}

function lldbServerPath(project: Project): string {
    const hostTag = { windows: 'windows-x86_64', macos: 'darwin-x86_64', linux: 'linux-x86_64' }[host.platform()];
    const arch = { 'arm64-v8a': 'aarch64', 'armeabi-v7a': 'arm', 'x86_64': 'x86_64', 'x86': 'i386' }[androidAbi];
    const clangDir = `${ndkDir(project)}/toolchains/llvm/prebuilt/${hostTag}/lib/clang`;
    for (const entry of Deno.readDirSync(clangDir)) {
        const path = `${clangDir}/${entry.name}/lib/linux/${arch}/lldb-server`;
        if (entry.isDirectory && util.fileExists(path)) {
            return path;
        }
    }
    throw new Error(`lldb-server not found in ${clangDir}`);
}

async function waitForPid(project: Project, pkg: string): Promise<number> {
    for (let i = 0; i < 20; i++) {
        const res = await adb(project, ['shell', 'pidof', pkg], { check: false, piped: true });
        const pid = parseInt(res.stdout.trim());
        if (!isNaN(pid)) {
            return pid;
        }
        await sleep(250);
    }
    throw new Error(`app ${pkg} did not start`);
}

function lldbScriptPaths(project: Project, config: Config) {
    const dir = project.buildDir(config.name);
    return { target: `${dir}/android-target.lldb`, process: `${dir}/android-process.lldb` };
}

function removeLldbScripts(project: Project, config: Config) {
    for (const path of Object.values(lldbScriptPaths(project, config))) {
        if (util.fileExists(path)) {
            Deno.removeSync(path);
        }
    }
}

function writeLldbScripts(project: Project, config: Config, socket: string, pid: number) {
    const paths = lldbScriptPaths(project, config);
    const targetScript = [
        // otherwise lldb stops in __jit_debug_register_code
        'settings set plugin.jit-loader.gdb.enable off',
        'platform select remote-android',
        `platform connect unix-abstract-connect://${socket}`,
        'target create /system/bin/app_process64',
    ];
    const processScript = [
        `process attach --pid ${pid}`,
        // ART uses SIGSEGV and SIGBUS internally, real crashes end up in art_sigsegv_fault
        'process handle SIGSEGV --notify false --pass true --stop false',
        'process handle SIGBUS --notify false --pass true --stop false',
        'breakpoint set --name art_sigsegv_fault',
        // CodeLLDB doesn't resume after custom process create commands
        'process continue',
    ];
    Deno.writeTextFileSync(paths.target, targetScript.join('\n') + '\n');
    Deno.writeTextFileSync(paths.process, processScript.join('\n') + '\n');
    log.info(`written ${paths.target} and ${paths.process}`);
}

// wait for lldb to attach, then release the app from 'am start -D' via JDWP
async function releaseWaitingApp(project: Project, pkg: string, pid: number) {
    log.info('waiting for native debugger to attach...');
    let attached = false;
    for (let i = 0; i < 300; i++) {
        const res = await adb(project, ['shell', 'run-as', pkg, 'cat', `/proc/${pid}/status`], { check: false, piped: true });
        if (res.exitCode !== 0) {
            throw new Error(`app ${pkg} is no longer running`);
        }
        const tracerPid = parseInt(res.stdout.match(/TracerPid:\s*(\d+)/)?.[1] ?? '0');
        if (tracerPid !== 0) {
            attached = true;
            break;
        }
        await sleep(200);
    }
    if (!attached) {
        throw new Error('timeout while waiting for native debugger');
    }
    const res = await adb(project, ['forward', 'tcp:0', `jdwp:${pid}`], { piped: true });
    const port = parseInt(res.stdout.trim());
    try {
        // NOTE: the JDWP handshake may fail while lldb still has the process stopped
        for (let i = 0; i < 30; i++) {
            try {
                await jdwpRelease(port);
                log.info('app released');
                return;
            } catch (_err) {
                await sleep(1000);
            }
        }
        throw new Error('failed to release app via JDWP');
    } finally {
        await adb(project, ['forward', '--remove', `tcp:${port}`], { check: false, piped: true });
    }
}

async function jdwpRelease(port: number) {
    const conn = await Deno.connect({ hostname: '127.0.0.1', port });
    try {
        const handshake = new TextEncoder().encode('JDWP-Handshake');
        await conn.write(handshake);
        await readBytes(conn, handshake.length);
        // a bare handshake is not enough, the app only continues after a JDWP command,
        // send VirtualMachine.Version (length=11, id=1, flags=0, cmdset=1, cmd=1)
        await conn.write(new Uint8Array([0, 0, 0, 11, 0, 0, 0, 1, 0, 1, 1]));
        await readBytes(conn, 11);
        // keep the connection open so that Debug.waitForDebugger() sees the debugger
        await sleep(3000);
    } finally {
        conn.close();
    }
}

async function readBytes(conn: Deno.Conn, num: number) {
    const buf = new Uint8Array(num);
    let pos = 0;
    while (pos < num) {
        const n = await conn.read(buf.subarray(pos));
        if (n === null) {
            throw new Error('JDWP connection closed');
        }
        pos += n;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
