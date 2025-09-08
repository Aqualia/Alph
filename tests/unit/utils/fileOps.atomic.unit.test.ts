import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileOperations } from '../../../src/utils/fileOps';

describe('FileOperations.atomicWrite', () => {
  const dir = join(tmpdir(), `alph-atomic-${Date.now()}`);
  const file = join(dir, 'config.json');

  beforeAll(async () => {
    await FileOperations.ensureDirectory(dir);
  });

  afterAll(async () => {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch {}
  });

  test('falls back to copy on EXDEV', async () => {
    const spy = jest.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('EXDEV'), { code: 'EXDEV' }));
    const data = { a: 1 };
    await FileOperations.writeJsonFile(file, data);
    const content = await FileOperations.readJsonFile<any>(file);
    expect(content).toEqual(data);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('respects ALPH_ATOMIC_MODE=copy', async () => {
    process.env['ALPH_ATOMIC_MODE'] = 'copy';
    const spy = jest.spyOn(fs, 'rename');
    const data = { b: 2 };
    await FileOperations.writeJsonFile(file, data);
    const content = await FileOperations.readJsonFile<any>(file);
    expect(content).toEqual(data);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    delete process.env['ALPH_ATOMIC_MODE'];
  });
});

