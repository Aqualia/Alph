import { AgentType } from '../agents/types';
import { ValidationSchema } from '../types/config';

/**
 * Schema-based configuration validator
 * Provides robust validation for different agent configurations
 */
export class ConfigValidator {
  private schemas: Map<AgentType, ValidationSchema>;

  constructor() {
    this.schemas = new Map();
    this.initializeSchemas();
  }

  /**
   * Initialize validation schemas for different agent types
   */
  private initializeSchemas(): void {
    // Gemini configuration schema
    this.schemas.set('gemini', {
      required: ['mcpServers'],
      optional: ['model', 'temperature', 'maxTokens', 'topP', 'topK'],
      types: {
        model: 'string',
        temperature: 'number',
        maxTokens: 'number',
        topP: 'number',
        topK: 'number'
      },
      patterns: {
        model: /^[a-zA-Z0-9\-_.]+$/
      },
      validators: {
        temperature: (value: unknown) => {
          return typeof value === 'number' && value >= 0 && value <= 1;
        },
        maxTokens: (value: unknown) => {
          return typeof value === 'number' && value > 0 && value <= 1000000;
        }
      }
    });

    // Cursor configuration schema
    this.schemas.set('cursor', {
      required: ['mcpServers'],
      optional: ['editor', 'theme', 'maxTokens', 'temperature'],
      types: {
        theme: 'string',
        maxTokens: 'number',
        temperature: 'number'
      },
      validators: {
        temperature: (value: unknown) => {
          return typeof value === 'number' && value >= 0 && value <= 1;
        },
        maxTokens: (value: unknown) => {
          return typeof value === 'number' && value > 0 && value <= 100000;
        }
      }
    });

    // Claude configuration schema
    this.schemas.set('claude', {
      required: ['mcpServers'],
      optional: ['maxTokens', 'temperature', 'system'],
      types: {
        maxTokens: 'number',
        temperature: 'number',
        system: 'string'
      },
      validators: {
        temperature: (value: unknown) => {
          return typeof value === 'number' && value >= 0 && value <= 1;
        },
        maxTokens: (value: unknown) => {
          return typeof value === 'number' && value > 0 && value <= 1000000;
        }
      }
    });

    // Generic MCP server schema
    this.schemas.set('mcp', {
      required: ['name'],
      optional: ['httpUrl', 'command', 'args', 'env', 'headers', 'transport', 'disabled', 'autoApprove'],
      types: {
        name: 'string',
        httpUrl: 'string',
        command: 'string',
        args: 'array',
        env: 'object',
        headers: 'object',
        transport: 'string',
        disabled: 'boolean',
        autoApprove: 'array'
      },
      patterns: {
        name: /^[a-zA-Z0-9\-_]+$/,
        httpUrl: /^https?:\/\/[^\s]+$/
      },
      validators: {
        transport: (value: unknown) => {
          return value === 'http' || value === 'sse';
        }
      }
    });

    // Unified alph.json schema (top-level)
    // We primarily validate the presence of mcpServers (array). Detailed entry validation is handled separately.
    this.schemas.set('alph', {
      required: ['mcpServers'],
      // No strict types map here to allow future expansion; entry-level validation will enforce structure
      types: {
        // Assert array type for mcpServers when using generic type checking
        mcpServers: 'array'
      }
    });
  }

  /**
   * Validate configuration for a specific agent type
   * @param agentType The type of agent
   * @param config The configuration to validate
   * @returns Validation result with errors if any
   */
  async validate(agentType: AgentType, config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Configuration must be an object'] };
    }

    const schema = this.schemas.get(agentType) || this.schemas.get('generic');
    if (!schema) {
      return { valid: true }; // No schema, assume valid
    }

    const errors: string[] = [];
    const configObj = config as Record<string, unknown>;

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in configObj) || configObj[field] === undefined || configObj[field] === null) {
          errors.push(`Required field '${field}' is missing`);
        }
      }
    }

    // Validate MCP servers if present
    if (configObj['mcpServers'] && typeof configObj['mcpServers'] === 'object') {
      const mcpVal: unknown = configObj['mcpServers'];

      // Unified alph.json uses an array of entries
      if (Array.isArray(mcpVal)) {
        for (let i = 0; i < mcpVal.length; i++) {
          const entry = mcpVal[i];
          if (entry && typeof entry === 'object') {
            const entryErrors = await this.validateUnifiedMCPServer(entry as Record<string, unknown>, i);
            errors.push(...entryErrors);
          } else {
            errors.push(`mcpServers[${i}] must be an object`);
          }
        }
      } else {
        // Legacy/object-map style validation
        const mcpServers = mcpVal as Record<string, unknown>;
        for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
          if (serverConfig && typeof serverConfig === 'object') {
            const serverErrors = await this.validateMCPServer(serverName, serverConfig as Record<string, unknown>);
            errors.push(...serverErrors);
          }
        }
      }
    }

    // Validate field types
    if (schema.types) {
      for (const [field, expectedType] of Object.entries(schema.types)) {
        if (field in configObj && configObj[field] !== undefined) {
          const value = configObj[field];
          const actualType = this.getType(value);
          
          if (actualType !== expectedType) {
            errors.push(`Field '${field}' must be of type ${expectedType}, got ${actualType}`);
          }
        }
      }
    }

    // Validate patterns
    if (schema.patterns) {
      for (const [field, pattern] of Object.entries(schema.patterns)) {
        if (field in configObj && typeof configObj[field] === 'string') {
          const value = configObj[field] as string;
          if (!pattern.test(value)) {
            errors.push(`Field '${field}' does not match required pattern`);
          }
        }
      }
    }

    // Run custom validators
    if (schema.validators) {
      for (const [field, validator] of Object.entries(schema.validators)) {
        if (field in configObj && configObj[field] !== undefined) {
          try {
            if (!validator(configObj[field])) {
              errors.push(`Field '${field}' failed custom validation`);
            }
          } catch (error) {
            errors.push(`Error validating field '${field}': ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }
    }

    return errors.length === 0 
      ? { valid: true } 
      : { valid: false, errors };
  }

  /**
   * Validate MCP server configuration
   * @param serverName The name of the server
   * @param serverConfig The server configuration
   * @returns Array of validation errors
   */
  private async validateMCPServer(serverName: string, serverConfig: Record<string, unknown>): Promise<string[]> {
    const errors: string[] = [];
    const mcpSchema = this.schemas.get('mcp');
    
    if (!mcpSchema) {
      return errors;
    }

    // Validate server name pattern
    if (mcpSchema.patterns?.['name'] && !mcpSchema.patterns['name'].test(serverName)) {
      errors.push(`MCP server name '${serverName}' does not match required pattern`);
    }

    // Check required fields for MCP server
    if (mcpSchema.required) {
      for (const field of mcpSchema.required) {
        if (!(field in serverConfig) || serverConfig[field] === undefined || serverConfig[field] === null) {
          // Special case: either httpUrl or command is required
          if (field === 'httpUrl' && (serverConfig as any)['command'] !== undefined) {
            continue;
          }
          if (field === 'command' && (serverConfig as any)['httpUrl'] !== undefined) {
            continue;
          }
          errors.push(`MCP server '${serverName}' is missing required field '${field}'`);
        }
      }
    }

    // Validate field types
    if (mcpSchema.types) {
      for (const [field, expectedType] of Object.entries(mcpSchema.types)) {
        if (field in serverConfig && (serverConfig as Record<string, unknown>)[field] !== undefined) {
          const value = (serverConfig as Record<string, unknown>)[field];
          const actualType = this.getType(value);
          
          if (actualType !== expectedType) {
            errors.push(`MCP server '${serverName}' field '${field}' must be of type ${expectedType}, got ${actualType}`);
          }
        }
      }
    }

    // Validate patterns
    if (mcpSchema.patterns) {
      for (const [field, pattern] of Object.entries(mcpSchema.patterns)) {
        if (field in serverConfig && typeof serverConfig[field] === 'string') {
          const value = serverConfig[field] as string;
          if (!pattern.test(value)) {
            errors.push(`MCP server '${serverName}' field '${field}' does not match required pattern`);
          }
        }
      }
    }

    // Run custom validators
    if (mcpSchema.validators) {
      for (const [field, validator] of Object.entries(mcpSchema.validators)) {
        if (field in serverConfig && serverConfig[field] !== undefined) {
          try {
            if (!validator(serverConfig[field])) {
              errors.push(`MCP server '${serverName}' field '${field}' failed custom validation`);
            }
          } catch (error) {
            errors.push(`Error validating MCP server '${serverName}' field '${field}': ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }
    }

    return errors;
  }

  /**
   * Get the type of a value as a string
   * @param value The value to check
   * @returns The type as a string
   */
  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Validate unified alph.json MCP server entry
   * @param entry The unified entry object
   * @param index Index within the mcpServers array (for error messages)
   */
  private async validateUnifiedMCPServer(entry: Record<string, unknown>, index: number): Promise<string[]> {
    const errors: string[] = [];

    // Required fields
    if (!('id' in entry) || typeof entry['id'] !== 'string' || (entry['id'] as string).trim() === '') {
      errors.push(`mcpServers[${index}] missing required field 'id' (non-empty string)`);
    } else {
      // id pattern similar to name
      const namePattern = /^[a-zA-Z0-9\-_]+$/;
      if (!namePattern.test(entry['id'] as string)) {
        errors.push(`mcpServers[${index}].id does not match required pattern`);
      }
    }

    // transport
    const transport = entry['transport'];
    if (transport !== 'http' && transport !== 'sse' && transport !== 'stdio') {
      errors.push(`mcpServers[${index}].transport must be one of 'http' | 'sse' | 'stdio'`);
    }

    // endpoint/command requirements based on transport
    if (transport === 'http' || transport === 'sse') {
      if (typeof entry['endpoint'] !== 'string' || !/^https?:\/\/[^\s]+$/.test(String(entry['endpoint']))) {
        errors.push(`mcpServers[${index}].endpoint must be a valid http(s) URL for transport ${transport}`);
      }
    }
    if (transport === 'stdio') {
      if (typeof entry['command'] !== 'string' || (entry['command'] as string).trim() === '') {
        errors.push(`mcpServers[${index}].command is required for transport 'stdio'`);
      }
    }

    // Type checks for optional fields
    if ('enabled' in entry && typeof entry['enabled'] !== 'boolean') {
      errors.push(`mcpServers[${index}].enabled must be boolean`);
    }
    if ('args' in entry && !Array.isArray(entry['args'])) {
      errors.push(`mcpServers[${index}].args must be an array`);
    }
    if ('env' in entry && (typeof entry['env'] !== 'object' || entry['env'] === null || Array.isArray(entry['env']))) {
      errors.push(`mcpServers[${index}].env must be an object`);
    }
    if ('headers' in entry && (typeof entry['headers'] !== 'object' || entry['headers'] === null || Array.isArray(entry['headers']))) {
      errors.push(`mcpServers[${index}].headers must be an object`);
    }
    if ('timeout' in entry && (typeof entry['timeout'] !== 'number' || (entry['timeout'] as number) < 0)) {
      errors.push(`mcpServers[${index}].timeout must be a non-negative number`);
    }

    // authentication block (optional)
    if ('authentication' in entry) {
      const auth = entry['authentication'];
      if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
        errors.push(`mcpServers[${index}].authentication must be an object when provided`);
      } else {
        const strategy = (auth as any)['strategy'];
        if (typeof strategy !== 'string' || strategy.trim() === '') {
          errors.push(`mcpServers[${index}].authentication.strategy must be a non-empty string`);
        }
      }
    }

    return errors;
  }

  /**
   * Add or update a validation schema
   * @param agentType The agent type
   * @param schema The validation schema
   */
  addSchema(agentType: AgentType, schema: ValidationSchema): void {
    this.schemas.set(agentType, schema);
  }

  /**
   * Get validation schema for an agent type
   * @param agentType The agent type
   * @returns The validation schema or undefined
   */
  getSchema(agentType: AgentType): ValidationSchema | undefined {
    return this.schemas.get(agentType);
  }
}

/**
 * Factory function to create a configuration validator
 * @returns A new ConfigValidator instance
 */
export function createConfigValidator(): ConfigValidator {
  return new ConfigValidator();
}
