/**
 * Injects cmake code snippets to handle linking with pthreads on Linux.
 */
import { Configurer } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    c.addCmakeCodeInjector({
        name: 'linux-threads',
        fn: (project, config) => {
            let str = '';
            if (project.isLinux()) {
                str += `set(THREADS_PREFER_PTHREAD_FLAG TRUE)\n`;
                str += `find_package(Threads)\n`;
            }
            return str;
        }
    });
    c.addTargetAttributeInjector({
        name: 'linux-threads',
        fn: (t, project, config) => {
            if (project.isLinux()) {
                t.addLibraries(['Threads::Threads'])
            }
        }
    })
}