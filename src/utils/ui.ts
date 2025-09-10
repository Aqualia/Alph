/**
 * Simple UI logging utility for consistent, user-friendly output.
 *
 * - Uses yoctocolors-cjs for portable colors in CommonJS
 * - Gates debug output behind ALPH_VERBOSE=1 or --verbose
 * - Keeps messages plain by default to avoid breaking tests that assert on output
 */
import * as colors from 'yoctocolors-cjs';

const isVerbose = (): boolean => process.env['ALPH_VERBOSE'] === '1' || /(^|,)alph(,|$)/.test(process.env['DEBUG'] || '');

function format(msg: string): string {
  return msg;
}

export const ui = {
  info: (msg = ''): void => {
    process.stdout.write(format(msg) + '\n');
  },
  success: (msg = ''): void => {
    process.stdout.write(colors.bold(colors.green(format(msg))) + '\n');
  },
  warn: (msg = ''): void => {
    process.stdout.write(colors.yellow(format(msg)) + '\n');
  },
  error: (msg = ''): void => {
    process.stderr.write(colors.red(format(msg)) + '\n');
  },
  debug: (msg = ''): void => {
    if (isVerbose()) {
      process.stdout.write(colors.gray(format(msg)) + '\n');
    }
  },
};
