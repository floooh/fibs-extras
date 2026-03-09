import { parseArgs } from 'jsr:@std/cli/parse-args';

const flags = parseArgs(Deno.args, {
    string: ['importdir', 'builddir', 'name', 'abi', 'version', 'package', 'targetdistdir']
});

console.log(`### create-apk.ts ${Deno.args.join(' ')}`);
console.log(flags);
