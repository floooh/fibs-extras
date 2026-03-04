/**
 * Injects cmake code snippets to handle linking with pthreads on Linux.
 */
import { Configurer } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    c.addCmakeCodeInjector({
        name: 'linux-threads',
        location: 'before-targets',
        fn: (project, config) => {
            let str = '';
            if (project.isLinux()) {
                str += `set(THREADS_PREFER_PTHREAD_FLAG ON)\n`;
                str += `find_package(Threads REQUIRED)\n`;
            }
            return str;
        }
    });
    c.addTargetAttributeInjector({
        name: 'linux-threads',
        fn: (t, project, config) => {
            if (project.isLinux() && (t.type() === 'plain-exe' || t.type() === 'windowed-exe')) {
                t.addLibraries(['Threads::Threads'])
            }
        }
    })
}