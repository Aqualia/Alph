#!/usr/bin/env node

import { executeUnifiedCommand } from './commands/unified';
import { ui } from './utils/ui';

// Execute the unified command
(async () => {
  try {
    await executeUnifiedCommand(process.argv);
  } catch (error) {
    ui.error('An unexpected error occurred: ' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
})();

// Export for testing
export { executeUnifiedCommand } from './commands/unified';
export { UnifiedConfigManager, createUnifiedConfigManager } from './config/unifiedManager';
export type { UnifiedConfig, UnifiedMCPServer, UnifiedTransport, UnifiedAuthentication } from './types/unified';
export { CatalogLoader, CatalogValidationError, defaultCatalogLoader } from './catalog/loader';
