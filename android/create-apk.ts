import { parseArgs } from 'jsr:@std/cli@^1/parse-args';
import { copy } from 'jsr:@std/fs@^1';
import { util } from 'jsr:@floooh/fibs@^1'

const args = parseArgs(Deno.args, {
    string: ['importdir', 'builddir', 'sdkdir', 'name', 'abi', 'platformversion', 'buildtoolsversion', 'package', 'targetdistdir']
});

function argError(arg: string): never {
    throw new Error(`--${arg} must be provided`);
}

if (args.importdir === undefined) {
    argError('importdir');
}
if (args.builddir === undefined) {
    argError('builddir');
}
if (args.sdkdir === undefined) {
    argError('sdkdir')
}
if (args.name === undefined) {
    argError('name');
}
if (args.abi === undefined) {
    argError('abi');
}
if (args.platformversion === undefined) {
    argError('platformversion');
}
if (args.buildtoolsversion === undefined) {
    argError('buildtoolsversion');
}
if (args.package === undefined) {
    argError('package');
}
if (args.targetdistdir === undefined) {
    argError('targetdistdir');
}

// android.jar is the new rt.jar
const SDK_HOME = args.sdkdir;
const ANDROID_JAR = `${SDK_HOME}/platforms/android-${args.platformversion}/android.jar`;
const BUILD_TOOLS = `${SDK_HOME}/build-tools/${args.buildtoolsversion}`;
const EXE = Deno.build.os === 'windows' ? '.exe' : '';
const BAT = Deno.build.os === 'windows' ? '.bat' : '';
const AAPT = `${BUILD_TOOLS}/aapt${EXE}`;
const D8 = `${BUILD_TOOLS}/d8${BAT}`;
const ZIPALIGN = `${BUILD_TOOLS}/zipalign${EXE}`;
const APKSIGNER = `${BUILD_TOOLS}/apksigner${BAT}`;

console.log(`### create-apk.ts ${Deno.args.join(' ')}`);
console.log(args);
console.log(`ANDROID_JAR: ${ANDROID_JAR}`);
console.log(`BUILD_TOOLS: ${BUILD_TOOLS}`);
console.log(`AAPT: ${AAPT}`);
console.log(`D8: ${D8}`);
console.log(`ZIPALIGN: ${ZIPALIGN}`);
console.log(`APKSIGNER: ${APKSIGNER}`);

// create empty project dir
const name = args.name;
const platformVersion = args.platformversion;
const importDir = args.importdir;
const distDir = args.targetdistdir;
const buildDir = args.builddir;
const abi = args.abi;
const pkgName = args.package;
const apkDir = `${buildDir}/android/${name}`;
const libsDir = `${apkDir}/lib/${abi}`;
const srcDir = `${apkDir}/src/${pkgName.replaceAll('.', '/')}`;
const objDir = `${apkDir}/obj`;
const binDir = `${apkDir}/bin`;
const resDir = `${apkDir}/res`;
const assetsDir = `${apkDir}/assets`;
util.ensureDir(distDir);
util.ensureDir(libsDir);
util.ensureDir(srcDir);
util.ensureDir(objDir);
util.ensureDir(binDir);
util.ensureDir(resDir);
util.ensureDir(assetsDir);

// copy shared library
const soFilename = `lib${name}.so`;
const soSrcPath = `${buildDir}/${soFilename}`;
const soDstPath = `${libsDir}/${soFilename}`;
Deno.copyFileSync(soSrcPath, soDstPath);

// copy dummy resource dir
await copy(`${importDir}/android/assets/res`, resDir, { overwrite: true });

// generate manifest file
let manifest = '';
manifest += `<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n`
manifest += `  package="${pkgName}"\n`;
manifest += `  android:versionCode="1"\n`;
manifest += `  android:versionName="1.0">\n`;
manifest += `  <uses-sdk android:minSdkVersion="11" android:targetSdkVersion="${platformVersion}"/>\n`;
manifest += `  <uses-permission android:name="android.permission.INTERNET"></uses-permission>\n`;
manifest += `  <uses-feature android:glEsVersion="0x00030000"></uses-feature>\n`;
manifest += `  <application android:label="${name}" android:debuggable="true" android:hasCode="false">\n`;
manifest += `    <activity android:name="android.app.NativeActivity"\n`;
manifest += `      android:label="${name}"\n`;
manifest += `      android:launchMode="singleTask"\n`;
manifest += `      android:exported="true"\n`;
manifest += `      android:screenOrientation="fullUser"\n`;
manifest += `      android:configChanges="orientation|screenSize|keyboard|keyboardHidden">\n`;
manifest += `      <meta-data android:name="android.app.lib_name" android:value="${name}"/>\n`;
manifest += `      <intent-filter>\n`;
manifest += `        <action android:name="android.intent.action.MAIN"/>\n`;
manifest += `        <category android:name="android.intent.category.LAUNCHER"/>\n`;
manifest += `      </intent-filter>\n`;
manifest += `    </activity>\n`;
manifest += `  </application>\n`;
manifest += `</manifest>\n`;
Deno.writeTextFileSync(`${apkDir}/AndroidManifest.xml`, manifest);

// generate R.java file from resource files
await util.runCmd(AAPT, {
    args: [
        'package',
        '-v', '-f', '-m',
        '-S', 'res',
        '-A', 'assets',
        '-J', 'src',
        '-M', 'AndroidManifest.xml',
        '-I', ANDROID_JAR,
    ],
    cwd: apkDir,
});

// compile java sources
await util.runCmd('javac', {
    args: [
        '-d', './obj',
        '--release', '17',
        '-sourcepath', 'src',
        `${srcDir}/R.java`,
    ],
    cwd: apkDir,
});

// convert Java bytecode to DEX
const objClassDir = `${objDir}/${pkgName.replaceAll('.', '/')}`;
const classFiles: string[] = [];
for (const entry of Deno.readDirSync(objClassDir)) {
    if (entry.name.endsWith('.class')) {
        classFiles.push(`${objClassDir}/${entry.name}`);
    }
}
await util.runCmd(D8, {
    args: [
        '--output', './bin',
        '--lib', ANDROID_JAR,
        ...classFiles,
    ],
    cwd: apkDir,
});

// package the apk
await util.runCmd(AAPT, {
    args: [
        'package',
        '-v', '-f',
        '-S', 'res',
        '-A', 'assets',
        '-M', 'AndroidManifest.xml',
        '-I', ANDROID_JAR,
        '-F', `${buildDir}/${name}-unaligned.apk`,
        'bin'
    ],
    cwd: apkDir,
});
await util.runCmd(AAPT, {
    args: [
        'add', '-v',
        `${buildDir}/${name}-unaligned.apk`,
        `lib/${abi}/${soFilename}`,
    ],
    cwd: apkDir,
});

// run zipalign on the unaligned apk
await util.runCmd(ZIPALIGN, {
    args: [
        '-f', '4',
        `${buildDir}/${name}-unaligned.apk`,
        `${buildDir}/${name}.apk`
    ],
    cwd: apkDir,
});

// create debug signing key
const keyStorePath = `${buildDir}/debug.keystore`;
if (!util.fileExists(keyStorePath)) {
    await util.runCmd('keytool', {
        args: [
            '-genkeypair',
            '-keystore', keyStorePath,
            '-storepass', 'android',
            '-alias', 'androiddebugkey',
            '-keypass', 'android',
            '-keyalg', 'RSA',
            '-validity', '10000',
            '-dname', 'CN=,OU=,O=,L=,S=,C='
        ],
        cwd: apkDir,
    });
}

// sign the apk
await util.runCmd(APKSIGNER, {
    args: [
        'sign',
        '-v',
        '--ks', keyStorePath,
        '--ks-pass', 'pass:android',
        '--key-pass', 'pass:android',
        '--ks-key-alias', 'androiddebugkey',
        `${buildDir}/${name}.apk`,
    ],
    cwd: apkDir,
});

// verify the apk
await util.runCmd(APKSIGNER, {
    args: [
        'verify',
        '-v',
        `${buildDir}/${name}.apk`,
    ],
    cwd: apkDir,
});

// copy apk to targetdistdir
Deno.copyFileSync(`${buildDir}/${name}.apk`, `${distDir}/${name}.apk`);