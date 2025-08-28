#!/usr/bin/env node

import { executeUnifiedCommand } from './commands/unified';

// Execute the unified command
(async () => {
  try {
    await executeUnifiedCommand(process.argv);
  } catch (error) {
    console.error('An unexpected error occurred:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();

// Export for testing
export { executeUnifiedCommand } from './commands/unified';
export { UnifiedConfigManager, createUnifiedConfigManager } from './config/unifiedManager';
export type { UnifiedConfig, UnifiedMCPServer, UnifiedTransport, UnifiedAuthentication } from './types/unified';