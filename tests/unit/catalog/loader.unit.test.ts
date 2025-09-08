import path from 'path';
import { CatalogLoader, CatalogValidationError } from '../../../src/catalog/loader';

describe('CatalogLoader', () => {
  const loader = new CatalogLoader();
  const repoRoot = path.resolve(__dirname, '../../../');

  test('loads and validates the default catalog', () => {
    const catalog = loader.load({
      filePath: path.join(repoRoot, 'catalog', 'agents.yaml'),
      schemaPath: path.join(repoRoot, 'schema', 'agents.schema.json'),
      projectDir: '/tmp/my-project'
    });

    expect(catalog.version).toBe(1);
    expect(catalog.agents.length).toBeGreaterThan(0);

    const cursor = catalog.agents.find(a => a.id === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor?.scopes?.project?.pathTemplate).toContain('/tmp/my-project');
  });

  test('fails validation on missing required fields', () => {
    const badYamlPath = path.join(repoRoot, 'tests', 'fixtures', 'catalog', 'bad-agents.yaml');
    const schemaPath = path.join(repoRoot, 'schema', 'agents.schema.json');

    expect(() => loader.load({ filePath: badYamlPath, schemaPath })).toThrow(CatalogValidationError);
  });
});

