/*
    copyfiles: copy files from source to destination dir
      srcDir?: string - base dir to copy from (default: target.dir)
      dstDir?: string - base dir to copy to (default: project.targetAssetsDir())
      files: string[] - list of files to copy

    First import the job like this:

    c.addImport({
      name: 'extras',
      url: 'https://github.com/floooh/fibs-extras',
      files: ['copyfiles.ts'],
    });

    Now you can run 'fibs list jobs' to get a description of the imported
    copyfiles job.

    Then add a build job to any targets which need to copy files:

    targetBuilder.addJob({
      job: 'copyfiles',
      args: {
          srcDir: `assets', // relative to target.dir
          files: [ 'bla.png', 'blub.png' ],
      },
    });
*/
import { Config, Configurer, log, Project, Schema, Target, util } from 'jsr:@floooh/fibs@^1';

type Args = {
    srcDir?: string;
    dstDir?: string;
    files: string[];
};

const schema: Schema = {
    srcDir: { type: 'string', optional: true, desc: 'base dir to copy from (default: target source directory)' },
    dstDir: { type: 'string', optional: true, desc: 'base dir to copy to (default: target asset directory' },
    files: { type: 'string[]', optional: false, desc: 'list of files to copy relative to srcDir' },
};

export function configure(c: Configurer) {
    c.addJob({ name: 'copyfiles', help, validate, build: buildJob });
}

function help() {
    log.helpJob('copyfiles', 'copy files from src to dst dir', schema);
}

function validate(args: unknown) {
    return util.validate(args, schema);
}

function buildJob(p: Project, c: Config, t: Target, args: unknown) {
    const {
        srcDir = t.dir,
        dstDir = p.targetAssetsDir(t.name, c.name),
        files,
    } = util.safeCast<Args>(args, schema);
    const inputs = files.map((file) => `${srcDir}/${file}`);
    const outputs = files.map((file) => `${dstDir}/${file}`);
    return {
        name: 'copyfiles',
        inputs,
        outputs,
        addOutputsToTargetSources: false,
        commands: inputs.map((input, i) => ['cmake', '-E', 'copy_if_different', input, outputs[i]]),
    };
}
