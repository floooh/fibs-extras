import { parseArgs } from 'jsr:@std/cli/parse-args';

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
const BAT = Deno.build.os === 'windows' ? '.exe' : '';
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
