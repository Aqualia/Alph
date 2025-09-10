/**
 * Error handling types and utilities for the alph-cli package.
 * 
 * This module provides structured error handling with categorization,
 * context preservation, and user-friendly error messaging.
 */

import { BackupInfo } from '../types/config';
import { ui } from './ui';

/**
 * Categories of errors that can occur during CLI operations.
 * Used for error classification and appropriate handling strategies.
 */
export enum ErrorCategory {
  /** Agent detection failures (agent not found, config missing) */
  DETECTION = 'DETECTION',
  
  /** File system permission issues */
  PERMISSION = 'PERMISSION',
  
  /** JSON parsing or configuration format errors */
  PARSING = 'PARSING',
  
  /** Network-related validation errors (invalid URLs, etc.) */
  NETWORK = 'NETWORK',
  
  /** Backup creation or restoration failures */
  BACKUP = 'BACKUP',
  
  /** Configuration validation failures */
  VALIDATION = 'VALIDATION',
  
  /** File system I/O errors */
  FILE_SYSTEM = 'FILE_SYSTEM',
  
  /** Command line argument or input errors */
  INPUT = 'INPUT',
  
  /** Internal system or unexpected errors */
  SYSTEM = 'SYSTEM'
}

/**
 * Severity levels for error classification.
 * Determines how errors should be handled and presented to users.
 */
export enum ErrorSeverity {
  /** Low severity - warnings that don't prevent operation */
  LOW = 'LOW',
  
  /** Medium severity - errors that affect specific operations */
  MEDIUM = 'MEDIUM',
  
  /** High severity - critical errors that prevent CLI execution */
  HIGH = 'HIGH',
  
  /** Fatal severity - system-level errors requiring immediate attention */
  FATAL = 'FATAL'
}

/**
 * Context information preserved with errors for debugging and recovery.
 */
export interface ErrorContext {
  /** The operation that was being performed when the error occurred */
  operation: string;
  
  /** File path involved in the operation, if applicable */
  filePath?: string;
  
  /** Agent provider name, if applicable */
  providerName?: string;
  
  /** Backup information, if a backup was involved */
  backup?: BackupInfo;
  
  /** Additional context data */
  metadata?: Record<string, unknown>;
  
  /** Timestamp when the error occurred */
  timestamp: Date;
  
  /** Stack trace from the original error */
  stackTrace?: string | undefined;
}

/**
 * Base class for all alph-cli specific errors.
 * Provides structured error information with context and recovery suggestions.
 */
export class AlphError extends Error {
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly context: ErrorContext;
  public readonly userMessage: string;
  public readonly suggestions: string[];

  constructor(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    context: Partial<ErrorContext> = {},
    userMessage?: string,
    suggestions: string[] = []
  ) {
    super(message);
    this.name = 'AlphError';
    this.category = category;
    this.severity = severity;
    this.userMessage = userMessage || this.generateUserMessage();
    this.suggestions = suggestions.length > 0 ? suggestions : this.generateSuggestions();
    
    this.context = {
      operation: context.operation || 'unknown',
      timestamp: new Date(),
      stackTrace: this.stack,
      ...context
    };
  }

  /**
   * Generates a user-friendly error message based on the error category and context.
   */
  private generateUserMessage(): string {
    switch (this.category) {
      case ErrorCategory.DETECTION:
        return `Unable to detect ${this.context.providerName || 'agent'}. The configuration file may not exist or be accessible.`;
      
      case ErrorCategory.PERMISSION:
        return `Permission denied accessing ${this.context.filePath || 'file'}. Please check file permissions.`;
      
      case ErrorCategory.PARSING:
        return `Invalid configuration format in ${this.context.filePath || 'file'}. The file may be corrupted or contain invalid JSON.`;
      
      case ErrorCategory.BACKUP:
        return `Failed to create or restore backup for ${this.context.filePath || 'file'}. Configuration changes may not be safe.`;
      
      case ErrorCategory.VALIDATION:
        return `Configuration validation failed. The MCP server settings may be invalid or incomplete.`;
      
      case ErrorCategory.FILE_SYSTEM:
        return `File system error occurred while accessing ${this.context.filePath || 'file'}.`;
      
      case ErrorCategory.INPUT:
        return `Invalid input provided. Please check your command line arguments.`;
      
      default:
        return `An unexpected error occurred during ${this.context.operation}.`;
    }
  }

  /**
   * Generates helpful suggestions based on the error category and context.
   */
  private generateSuggestions(): string[] {
    switch (this.category) {
      case ErrorCategory.DETECTION:
        return [
          `Ensure ${this.context.providerName || 'the agent'} is properly installed`,
          'Check that the configuration file exists in the expected location',
          'Verify you have read permissions for the configuration directory'
        ];
      
      case ErrorCategory.PERMISSION:
        return [
          'Run the command with appropriate permissions',
          'Check file and directory ownership',
          'Ensure the configuration directory is writable'
        ];
      
      case ErrorCategory.PARSING:
        return [
          'Validate the JSON syntax in your configuration file',
          'Restore from a backup if available',
          'Recreate the configuration file if it\'s corrupted'
        ];
      
      case ErrorCategory.BACKUP:
        return [
          'Ensure sufficient disk space for backup creation',
          'Check write permissions in the configuration directory',
          'Manually backup your configuration before retrying'
        ];
      
      case ErrorCategory.VALIDATION:
        return [
          'Verify the MCP server URL is valid and accessible',
          'Check that the access key is correctly formatted',
          'Ensure all required configuration fields are provided'
        ];
      
      case ErrorCategory.INPUT:
        return [
          'Use --help to see available options',
          'Check the format of your MCP server ID and access key',
          'Ensure all required arguments are provided'
        ];
      
      default:
        return [
          'Try running the command again',
          'Check the system logs for more details',
          'Report this issue if the problem persists'
        ];
    }
  }
}

/**
 * Specific error class for agent detection failures.
 */
export class DetectionError extends AlphError {
  constructor(providerName: string, filePath?: string, originalError?: Error) {
    const context: Partial<ErrorContext> = {
      operation: 'agent-detection',
      providerName,
      metadata: { originalError: originalError?.message }
    };
    if (filePath) {
      context.filePath = filePath;
    }
    
    super(
      `Failed to detect ${providerName}${filePath ? ` at ${filePath}` : ''}`,
      ErrorCategory.DETECTION,
      ErrorSeverity.MEDIUM,
      context
    );
  }
}

/**
 * Specific error class for file system permission issues.
 */
export class PermissionError extends AlphError {
  constructor(filePath: string, operation: string, originalError?: Error) {
    super(
      `Permission denied: ${operation} ${filePath}`,
      ErrorCategory.PERMISSION,
      ErrorSeverity.HIGH,
      {
        operation,
        filePath,
        metadata: { originalError: originalError?.message }
      }
    );
  }
}

/**
 * Specific error class for JSON parsing failures.
 */
export class ParsingError extends AlphError {
  constructor(filePath: string, originalError?: Error) {
    super(
      `Failed to parse configuration file: ${filePath}`,
      ErrorCategory.PARSING,
      ErrorSeverity.HIGH,
      {
        operation: 'config-parsing',
        filePath,
        metadata: { originalError: originalError?.message }
      }
    );
  }
}

/**
 * Specific error class for backup operation failures.
 */
export class BackupError extends AlphError {
  constructor(operation: string, filePath: string, backup?: BackupInfo, originalError?: Error) {
    const context: Partial<ErrorContext> = {
      operation: `backup-${operation}`,
      filePath,
      metadata: { originalError: originalError?.message }
    };
    if (backup) {
      context.backup = backup;
    }
    
    super(
      `Backup ${operation} failed for ${filePath}`,
      ErrorCategory.BACKUP,
      ErrorSeverity.HIGH,
      context
    );
  }
}

/**
 * Specific error class for configuration validation failures.
 */
export class ValidationError extends AlphError {
  constructor(message: string, filePath?: string, validationDetails?: Record<string, unknown>) {
    const context: Partial<ErrorContext> = {
      operation: 'config-validation',
      metadata: { validationDetails }
    };
    if (filePath) {
      context.filePath = filePath;
    }
    
    super(
      `Configuration validation failed: ${message}`,
      ErrorCategory.VALIDATION,
      ErrorSeverity.MEDIUM,
      context
    );
  }
}

/**
 * Error handler utility class for managing error recovery and user communication.
 */
export class ErrorHandler {
  /**
   * Handles configuration errors with automatic backup restoration if available.
   */
  static async handleConfigurationError(
    error: Error,
    backupInfo?: BackupInfo
  ): Promise<void> {
    ui.error('Configuration Error: ' + error.message);
    
    if (error instanceof AlphError) {
      ui.error('Details: ' + error.userMessage);
      
      if (error.suggestions.length > 0) {
        ui.error('Suggestions:');
        error.suggestions.forEach((suggestion, index) => {
          ui.error(`  ${index + 1}. ${suggestion}`);
        });
      }
      
      // Attempt backup restoration for high-severity errors
      if (error.severity === ErrorSeverity.HIGH && backupInfo) {
        ui.error(`\nAttempting to restore backup from ${backupInfo.backupPath}...`);
        try {
          await this.restoreFromBackup(backupInfo);
          ui.error('Backup restored successfully.');
        } catch (restoreError) {
          ui.error('Failed to restore backup: ' + (restoreError instanceof Error ? restoreError.message : String(restoreError)));
        }
      }
    }
    
    // Log detailed error information for debugging
    if (process.env['DEBUG']) {
      ui.error('Debug Information:');
      ui.error('Stack Trace: ' + (error.stack || ''));
      if (error instanceof AlphError) {
        ui.error('Context: ' + JSON.stringify(error.context, null, 2));
      }
    }
  }

  /**
   * Formats error messages for user display.
   */
  static formatErrorMessage(error: Error): string {
    if (error instanceof AlphError) {
      let message = `❌ ${error.userMessage}`;
      
      if (error.suggestions.length > 0) {
        message += '\n\n💡 Suggestions:';
        error.suggestions.forEach((suggestion, index) => {
          message += `\n  ${index + 1}. ${suggestion}`;
        });
      }
      
      return message;
    }
    
    return `❌ An unexpected error occurred: ${error.message}`;
  }

  /**
   * Determines if an error is recoverable and suggests recovery actions.
   */
  static isRecoverable(error: Error): boolean {
    if (error instanceof AlphError) {
      return error.severity !== ErrorSeverity.FATAL;
    }
    return false;
  }

  /**
   * Placeholder for backup restoration logic (will be implemented in backup utility).
   */
  private static async restoreFromBackup(backupInfo: BackupInfo): Promise<void> {
    // This will be implemented when the backup utility is created
    // For now, just log the attempt
    ui.error(`Would restore ${backupInfo.originalPath} from ${backupInfo.backupPath}`);
  }

  /**
   * Creates an error context object for consistent error reporting.
   */
  static createContext(
    operation: string,
    options: {
      filePath?: string;
      providerName?: string;
      backup?: BackupInfo;
      metadata?: Record<string, unknown>;
    } = {}
  ): ErrorContext {
    return {
      operation,
      timestamp: new Date(),
      ...options
    };
  }
}

/**
 * Utility function to wrap async operations with error handling.
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AlphError) {
      // Re-throw AlphError with additional context
      error.context.metadata = {
        ...error.context.metadata,
        ...context.metadata
      };
      throw error;
    }
    
    // Wrap unknown errors in AlphError
    throw new AlphError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      ErrorCategory.SYSTEM,
      ErrorSeverity.HIGH,
      context,
      undefined,
      ['Check the system logs for more details', 'Try running the operation again']
    );
  }
}