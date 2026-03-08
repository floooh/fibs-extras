/**
 * Add Android platform support:
 *
 * - command to install/uninstall the Android SDK/NDK
 * - build configs
 * - integrate the Android NDK cmake toolchain file
 * - override windowed-exe target types to DLLs
 * - add post-build jobs to create Android APKs for each exe-target
 * - a runner to run on device via adb
 */
import { Configurer, ConfigDesc, Project, log, util, host } from 'jsr:@floooh/fibs@^1';
import { green, yellow } from 'jsr:@std/fmt@^1/colors';
import { basename } from 'jsr:@std/path@1';

// FIXME: allow url to be provided via import options
const urls = {
    windows: 'https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip',
    macos: 'https://dl.google.com/android/repository/commandlinetools-mac-14742923_latest.zip',
    linux: 'https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip',
};

export function configure(c: Configurer) {
    addConfigs(c);
    addTools(c);
    c.addCommand({ name: 'android', help: cmdHelp, run: cmdRun });
}

function addConfigs(c: Configurer) {
    const baseConfig: ConfigDesc = {
        name: 'android',
        platform: 'android',
        runner: 'android',
        buildMode: 'debug',
        toolchainFile: 'fixme',
        validate: (project: Project) => {
            if (!util.dirExists(sdkDir(project))) {
                return {
                    valid: false,
                    hints: [`Android SDK not installed (run 'fibs android install)`],
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
        notFoundMsg: 'required for Android development',
        exists: javaExists,
    });
    c.addTool({
        name: 'unzip',
        platforms: ['windows', 'macos', 'linux'],
        optional: true,
        notFoundMsg: 'required for installing the Android SDK',
        exists: unzipExists,
    });
}

async function javaExists(): Promise<boolean> {
    try {
        await util.runCmd('java', {
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

function cmdHelp() {
    log.helpCmd([
        'android install',
        'android uninstall'
    ], 'install or uninstall Android SDK');
}

async function cmdRun(project: Project, cmdLineArgs: string[]) {
    const args = parseArgs(cmdLineArgs);
    if (args.install) {
        await install(project);
    } else if (args.uninstall) {
        await uninstall(project);
    }
}

function parseArgs(cmdLineArgs: string[]): {
    install?: boolean,
    uninstall?: boolean,
} {
    const args: ReturnType<typeof parseArgs> = {};
    if (cmdLineArgs[1] === undefined) {
        throw new Error(`expected a subcommand (run 'fibs help android')`);
    }
    switch (cmdLineArgs[1]) {
        case 'install': args.install = true; break;
        case 'uninstall': args.uninstall = true; break;
        default: throw new Error(`unknown subcommand ${cmdLineArgs[1]} (run 'fibs help android')`);
    }
    return args;
}

async function install(project: Project) {
    if (!(await javaExists())) {
        throw new Error(`please install a Java JDK version 8 (run 'fibs diag tools')`);
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
    await installSdkPackage(project, 'platforms;android-30');
    await installSdkPackage(project, 'build-tools');
    await installSdkPackage(project, 'platform-tools');
    await installSdkPackage(project, 'ndk-bundle');
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