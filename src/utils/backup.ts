import { promises as fs } from 'fs';
import { resolve, dirname, basename, extname, join } from 'path';
import { FileOperations } from './fileOps';
import { ui } from './ui';

/**
 * Information about a backup file
 */
export interface BackupInfo {
  originalPath: string;
  backupPath: string;
  timestamp: Date;
}

/**
 * Manages backup creation, restoration, and cleanup for configuration files
 * Provides timestamped backups with atomic operations
 */
export class BackupManager {
  /**
   * Creates a timestamped backup of the specified file
   * @param filePath - Path to the file to backup
   * @returns BackupInfo containing backup details
   * @throws Error if backup creation fails
   */
  static async createBackup(filePath: string): Promise<BackupInfo> {
    const resolvedPath = resolve(filePath);

    // Check if original file exists
    if (!(await FileOperations.fileExists(resolvedPath))) {
      throw new Error(`Cannot backup non-existent file: ${filePath}`);
    }

    // Check if original file is readable
    if (!(await FileOperations.isReadable(resolvedPath))) {
      throw new Error(`Cannot read file for backup: ${filePath}`);
    }

    const timestamp = new Date();
    const backupPath = this.generateBackupPath(resolvedPath, timestamp);

    try {
      // Ensure backup directory exists
      await FileOperations.ensureDirectory(dirname(backupPath));

      // Copy file to backup location
      await fs.copyFile(resolvedPath, backupPath);

      // Verify backup was created successfully
      if (!(await FileOperations.fileExists(backupPath))) {
        throw new Error('Backup file was not created successfully');
      }

      return {
        originalPath: resolvedPath,
        backupPath,
        timestamp
      };
    } catch (error) {
      throw new Error(`Failed to create backup of ${filePath}: ${error}`);
    }
  }

  /**
   * Restores a file from its backup
   * @param backupInfo - Backup information from createBackup
   * @throws Error if restoration fails
   */
  static async restoreBackup(backupInfo: BackupInfo): Promise<void> {
    const { originalPath, backupPath } = backupInfo;

    // Verify backup file exists
    if (!(await FileOperations.fileExists(backupPath))) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    // Verify backup file is readable
    if (!(await FileOperations.isReadable(backupPath))) {
      throw new Error(`Cannot read backup file: ${backupPath}`);
    }

    try {
      // Ensure original directory exists
      await FileOperations.ensureDirectory(dirname(originalPath));

      // Copy backup back to original location
      await fs.copyFile(backupPath, originalPath);

      // Verify restoration was successful
      if (!(await FileOperations.fileExists(originalPath))) {
        throw new Error('File restoration was not successful');
      }
    } catch (error) {
      throw new Error(`Failed to restore backup from ${backupPath} to ${originalPath}: ${error}`);
    }
  }

  /**
   * Cleans up old backup files for a given original file
   * @param filePath - Original file path to clean backups for
   * @param maxAge - Maximum age in milliseconds (default: 30 days)
   * @param maxCount - Maximum number of backups to keep (default: 10)
   * @returns Number of backups cleaned up
   */
  static async cleanupOldBackups(
    filePath: string, 
    maxAge: number = 30 * 24 * 60 * 60 * 1000, // 30 days
    maxCount: number = 10
  ): Promise<number> {
    const resolvedPath = resolve(filePath);
    const backupDir = dirname(resolvedPath);
    const baseFileName = basename(resolvedPath, extname(resolvedPath));
    const fileExt = extname(resolvedPath);

    try {
      // Get all files in the backup directory
      const files = await fs.readdir(backupDir);

      // Filter for backup files of this specific file
      const backupPattern = new RegExp(
        `^${this.escapeRegExp(baseFileName)}\\.bak\\.(\\d{8}T\\d{6}Z)${this.escapeRegExp(fileExt)}$`
      );

      const backupFiles: Array<{ name: string; path: string; timestamp: Date }> = [];

      for (const file of files) {
        const match = file.match(backupPattern);
        if (match) {
          const timestampStr = match[1];
          if (!timestampStr) continue;
          try {
            // Parse timestamp from filename
            const timestamp = new Date(
              timestampStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, 
                '$1-$2-$3T$4:$5:$6Z')
            );
            // Skip invalid dates (new Date does not throw on invalid input)
            if (isNaN(timestamp.getTime())) continue;

            backupFiles.push({
              name: file,
              path: join(backupDir, file),
              timestamp
            });
          } catch {
            // Skip files with invalid timestamps
            continue;
          }
        }
      }

      // Sort by timestamp (newest first)
      backupFiles.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      const now = new Date();
      let cleanedCount = 0;

      // Remove backups that are too old or exceed max count
      for (let i = 0; i < backupFiles.length; i++) {
        const backup = backupFiles[i];
        if (!backup) continue;
        const age = now.getTime() - backup.timestamp.getTime();

        if (age > maxAge || i >= maxCount) {
          try {
            await fs.unlink(backup.path);
            cleanedCount++;
          } catch (error) {
            // Log but don't fail on cleanup errors
            ui.warn(`Failed to cleanup backup ${backup.path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      return cleanedCount;
    } catch (error) {
      throw new Error(`Failed to cleanup backups for ${filePath}: ${error}`);
    }
  }

  /**
   * Generates a backup file path with timestamp
   * @param originalPath - Original file path
   * @param timestamp - Timestamp for the backup (defaults to current time)
   * @returns Generated backup file path
   */
  static generateBackupPath(originalPath: string, timestamp: Date = new Date()): string {
    const resolvedPath = resolve(originalPath);
    const dir = dirname(resolvedPath);
    const baseName = basename(resolvedPath, extname(resolvedPath));
    const ext = extname(resolvedPath);

    // Format timestamp as YYYYMMDDTHHMMSSZ
    const timestampStr = timestamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    return join(dir, `${baseName}.bak.${timestampStr}${ext}`);
  }

  /**
   * Lists all backup files for a given original file
   * @param filePath - Original file path
   * @returns Array of backup file information
   */
  static async listBackups(filePath: string): Promise<BackupInfo[]> {
    const resolvedPath = resolve(filePath);
    const backupDir = dirname(resolvedPath);
    const baseFileName = basename(resolvedPath, extname(resolvedPath));
    const fileExt = extname(resolvedPath);
    
    try {
      const files = await fs.readdir(backupDir);
      const backupPattern = new RegExp(
        `^${this.escapeRegExp(baseFileName)}\\.bak\\.(\\d{8}T\\d{6}Z)${this.escapeRegExp(fileExt)}$`
      );
      
      const backups: BackupInfo[] = [];
      
      for (const file of files) {
        const match = file.match(backupPattern);
        if (match) {
          const timestampStr = match[1];
          if (!timestampStr) continue;
          try {
            const timestamp = new Date(
              timestampStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, 
                '$1-$2-$3T$4:$5:$6Z')
            );
            // Exclude entries with invalid timestamps
            if (isNaN(timestamp.getTime())) continue;
            
            backups.push({
              originalPath: resolvedPath,
              backupPath: join(backupDir, file),
              timestamp
            });
          } catch {
            // Skip files with invalid timestamps
            continue;
          }
        }
      }
      
      // Sort by timestamp (newest first)
      return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      throw new Error(`Failed to list backups for ${resolvedPath}: ${error}`);
    }
  }

  /**
   * Escapes special regex characters in a string
   * @param str - String to escape
   * @returns Escaped string safe for regex
   */
  private static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}