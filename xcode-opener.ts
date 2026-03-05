/**
 * Adds an opener 'xcode', can be used on its own, but is also automatically
 * included via macos.ts and ios.ts.
 */
import { Configurer, Project, Config, util } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    addXcodeOpener(c);
}

export function addXcodeOpener(c: Configurer) {
    c.addOpener({
        name: 'xcode',
        generate: async (): Promise<void> => {},
        open: async (project: Project, config: Config): Promise<void> => {
            const path = `${project.buildDir(config.name)}/${project.name()}.xcodeproj`;
            await util.runCmd('xed', { args: [path], showCmd: true });
        }
    });
}
