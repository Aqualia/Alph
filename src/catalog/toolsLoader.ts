import fs from 'fs';
import path from 'path';
import Ajv, { ErrorObject } from 'ajv';
import { parse as parseYAML } from 'yaml';

export interface ToolInstaller { type: string; command: string }
export interface ToolHealthCmd { command: string }

export interface ToolEnvPrompt { key: string; label?: string; secret?: boolean; optional?: boolean }

export interface ToolEntry {
  id: string;
  bin: string;
  discovery?: { commands?: string[] };
  installers: {
    macos?: ToolInstaller[];
    linux?: ToolInstaller[];
    windows?: ToolInstaller[];
  };
  health?: { version?: ToolHealthCmd; probe?: ToolHealthCmd };
  meta?: {
    envPrompts?: ToolEnvPrompt[];
    notes?: string;
  };
}

export interface ToolsCatalog {
  tools: ToolEntry[];
}

export class ToolsCatalogValidationError extends Error {
  readonly details: ErrorObject[];
  constructor(message: string, details: ErrorObject[]) {
    super(message);
    this.name = 'ToolsCatalogValidationError';
    this.details = details;
  }
}

export class ToolsCatalogLoader {
  private ajv: Ajv;
  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
  }

  load(cwd: string = process.cwd(), filePath?: string, schemaPath?: string): ToolsCatalog {
    const f = filePath ?? path.resolve(cwd, 'catalog', 'tools.yaml');
    const s = schemaPath ?? path.resolve(cwd, 'schema', 'tools.schema.json');
    const data = parseYAML(fs.readFileSync(f, 'utf8')) as ToolsCatalog;
    const schema = JSON.parse(fs.readFileSync(s, 'utf8'));

    const schemaId: string | undefined = schema['$id'];
    let validate;
    if (schemaId) {
      validate = this.ajv.getSchema(schemaId) || this.ajv.compile(schema);
    } else {
      validate = this.ajv.compile(schema);
    }
    const ok = validate(data);
    if (!ok) {
      throw new ToolsCatalogValidationError('tools.yaml failed schema validation', validate.errors ?? []);
    }
    return data;
  }
}

export const defaultToolsCatalogLoader = new ToolsCatalogLoader();
