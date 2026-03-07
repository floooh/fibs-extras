/**
 * Add Android platform support:
 *
 * - command to install/uninstall the Android SDK/NDK
 * - build configs
 * - integrate the Android NDK cmake toolchain file
 * - override windowed-exe target types to DLLs
 * - add post-build jobs to create Android APKs for each exe-target
 */
import { Configurer } from 'jsr:@floooh/fibs@^1';

export function configure(c: Configurer) {
    // FIXME
}