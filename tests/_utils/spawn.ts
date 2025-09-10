import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';

/**
 * Options for spawning test processes
 */
export interface TestSpawnOptions extends SpawnOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to capture stdout (default: true) */
  captureStdout?: boolean;
  /** Whether to capture stderr (default: true) */
  captureStderr?: boolean;
  /** Input to send to stdin */
  input?: string;
  /** Expected exit code (default: 0) */
  expectedExitCode?: number;
  /** Environment variables for the child process */
  env?: NodeJS.ProcessEnv;
}

/**
 * Result of a spawned process
 */
export interface SpawnResult {
  /** Exit code of the process */
  exitCode: number | null;
  /** Signal that terminated the process */
  signal: string | null;
  /** Captured stdout */
  stdout: string;
  /** Captured stderr */
  stderr: string;
  /** Whether the process completed successfully */
  success: boolean;
  /** Error if process failed to start */
  error?: Error;
}

/**
 * Spawn a process with timeout and output capture
 * @param command - Command to execute
 * @param args - Command arguments
 * @param options - Spawn options
 * @returns Promise resolving to spawn result
 */
export async function spawnWithCapture(
  command: string,
  args: string[] = [],
  options: TestSpawnOptions = {}
): Promise<SpawnResult> {
  const {
    timeout = 30000,
    captureStdout = true,
    captureStderr = true,
    input,
    expectedExitCode = 0,
    ...spawnOptions
  } = options;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout | null = null;
    let resolved = false;

    const resolveOnce = (result: SpawnResult) => {
      if (resolved) return;
      resolved = true;
      
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      resolve(result);
    };

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...spawnOptions
    });

    // Handle spawn errors
    child.on('error', (error) => {
      resolveOnce({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        success: false,
        error
      });
    });

    // Capture stdout
    if (captureStdout && child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    // Capture stderr
    if (captureStderr && child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    // Handle process completion
    child.on('close', (exitCode, signal) => {
      const success = exitCode === expectedExitCode;
      
      resolveOnce({
        exitCode,
        signal,
        stdout,
        stderr,
        success
      });
    });

    // Set timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        
        // Force kill after additional delay
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);

        resolveOnce({
          exitCode: null,
          signal: 'SIGTERM',
          stdout,
          stderr: stderr + '\n[Process terminated due to timeout]',
          success: false,
          error: new Error(`Process timed out after ${timeout}ms`)
        });
      }, timeout);
    }

    // Send input if provided
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/**
 * Spawn the Alph CLI with given arguments
 * @param args - CLI arguments
 * @param options - Spawn options
 * @returns Promise resolving to spawn result
 */
export async function spawnAlphCli(
  args: string[] = [],
  options: TestSpawnOptions = {}
): Promise<SpawnResult> {
  // Use built CLI or ts-node for development
  const useBuilt = process.env.TEST_USE_BUILT_CLI === 'true';
  
  if (useBuilt) {
    // Use built version
    const cliPath = path.resolve(__dirname, '../../dist/index.js');
    return spawnWithCapture('node', [cliPath, ...args], options);
  } else {
    // Use ts-node for development
    const srcPath = path.resolve(__dirname, '../../src/index.ts');
    return spawnWithCapture('node', ['-r', 'ts-node/register', srcPath, ...args], {
      ...options,
      cwd: options.cwd || path.resolve(__dirname, '../..')
    });
  }
}

/**
 * Helper to run CLI commands and assert success
 * @param args - CLI arguments
 * @param options - Spawn options
 * @returns Promise resolving to successful spawn result
 */
export async function runAlphCliSuccess(
  args: string[] = [],
  options: TestSpawnOptions = {}
): Promise<SpawnResult> {
  const result = await spawnAlphCli(args, options);
  
  if (!result.success) {
    throw new Error(
      `CLI command failed with exit code ${result.exitCode}:\n` +
      `Command: alph ${args.join(' ')}\n` +
      `Stdout: ${result.stdout}\n` +
      `Stderr: ${result.stderr}\n` +
      `Error: ${result.error?.message || 'Unknown error'}`
    );
  }
  
  return result;
}

/**
 * Helper to run CLI commands and expect failure
 * @param args - CLI arguments
 * @param expectedExitCode - Expected non-zero exit code
 * @param options - Spawn options
 * @returns Promise resolving to failed spawn result
 */
export async function runAlphCliFailure(
  args: string[] = [],
  expectedExitCode: number = 1,
  options: TestSpawnOptions = {}
): Promise<SpawnResult> {
  const result = await spawnAlphCli(args, {
    ...options,
    expectedExitCode
  });
  
  if (result.success || result.exitCode === 0) {
    throw new Error(
      `CLI command unexpectedly succeeded:\n` +
      `Command: alph ${args.join(' ')}\n` +
      `Stdout: ${result.stdout}\n` +
      `Stderr: ${result.stderr}`
    );
  }
  
  return result;
}

/**
 * Create a mock process environment for testing
 * @param envVars - Environment variables to set
 * @returns Spawn options with custom environment
 */
export function createTestEnv(envVars: Record<string, string>): TestSpawnOptions {
  return {
    env: {
      ...process.env,
      ...envVars
    }
  };
}

/**
 * Helper to test CLI output contains expected patterns
 * @param result - Spawn result to check
 * @param patterns - Patterns that should be present in stdout
 * @param errorPatterns - Patterns that should be present in stderr
 */
export function assertCliOutput(
  result: SpawnResult,
  patterns: string[] = [],
  errorPatterns: string[] = []
): void {
  // Check stdout patterns
  for (const pattern of patterns) {
    if (!result.stdout.includes(pattern)) {
      throw new Error(
        `Expected pattern "${pattern}" not found in stdout:\n${result.stdout}`
      );
    }
  }

  // Check stderr patterns
  for (const pattern of errorPatterns) {
    if (!result.stderr.includes(pattern)) {
      throw new Error(
        `Expected error pattern "${pattern}" not found in stderr:\n${result.stderr}`
      );
    }
  }
}
