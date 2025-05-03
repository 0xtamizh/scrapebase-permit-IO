import { exec } from 'child_process';
import { promisify } from 'util';

/**
 * Promisified version of exec from child_process
 * Returns a promise that resolves with { stdout, stderr }
 */
export const execAsync = promisify(exec); 