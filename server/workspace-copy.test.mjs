import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertWorkspaceFits,
  copyWorkspace,
  inspectWorkspace,
  normalizeCopyOptions,
} from './workspace-copy.mjs';

const exec = promisify(execFile);
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pipeline-copy-test-'));
  const source = path.join(dir, 'source');
  await mkdir(source);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const put = async (relative, contents = relative) => {
    const file = path.join(source, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  return { dir, source, put, destination: path.join(dir, 'copy') };
}
async function absent(file) {
  await assert.rejects(access(file), { code: 'ENOENT' });
}

async function afterDestinationCreated(t, destination, mutate) {
  const canonical = path.join(
    await realpath(path.dirname(destination)),
    path.basename(destination),
  );
  const original = fs.promises.mkdir;
  const mocked = t.mock.method(
    fs.promises,
    'mkdir',
    async (directory, ...args) => {
      const result = await original(directory, ...args);
      if (directory === canonical) await mutate();
      return result;
    },
  );
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
}

test('copy options retain legacy defaults and reject unlimited or malformed settings', () => {
  assert.deepEqual(normalizeCopyOptions(), {
    maxFiles: 10000,
    maxBytes: 157286400,
  });
  assert.deepEqual(normalizeCopyOptions({ maxFiles: 7 }), {
    maxFiles: 7,
    maxBytes: 157286400,
  });
  assert.deepEqual(
    normalizeCopyOptions({ maxFiles: Number.MAX_SAFE_INTEGER }),
    {
      maxFiles: Number.MAX_SAFE_INTEGER,
      maxBytes: 157286400,
    },
  );
  for (const input of [
    null,
    [],
    '10',
    { unknown: 2 },
    { maxFiles: 0 },
    { maxBytes: -1 },
    { maxFiles: 1.1 },
    { maxBytes: Infinity },
    { maxFiles: '10' },
    { maxBytes: NaN },
    { maxBytes: Number.MAX_SAFE_INTEGER + 1 },
    { maxFiles: undefined },
  ])
    assert.throws(() => normalizeCopyOptions(input));
});

test('inspection measures included files and summarizes folders without creating a copy', async (t) => {
  const { source, put, destination } = await fixture(t);
  await put('src/one.js', '123');
  await put('src/two.js', '12345');
  await put('assets/photo.bin', '1234567890');
  await put('README.md', '12');
  await put('node_modules/ignored.js', 'large ignored content');
  await put('dist/ignored.html');
  const report = await inspectWorkspace(source, {
    copyOptions: { maxFiles: 3, maxBytes: 15 },
  });
  assert.equal(report.fileCount, 4);
  assert.equal(report.bytes, 20);
  assert.equal(report.excludedCount, 2);
  assert.deepEqual(report.exceeded, ['files', 'bytes']);
  assert.deepEqual(report.largestDirectories, [
    { path: 'assets', fileCount: 1, bytes: 10 },
    { path: 'src', fileCount: 2, bytes: 8 },
    { path: '.', fileCount: 1, bytes: 2 },
  ]);
  assert.deepEqual(report.largestFiles[0], {
    path: 'assets/photo.bin',
    bytes: 10,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.throws(
    () => assertWorkspaceFits(report),
    (error) => {
      assert.equal(error.code, 'WORKSPACE_COPY_LIMIT');
      assert.equal(error.report, report);
      assert.match(error.message, /количество файлов и объём файлов/);
      assert.match(error.message, /assets/);
      assert.match(error.message, /20 байт; лимиты: 3 файлов \/ 15 байт/);
      return true;
    },
  );
  await absent(destination);
});

test('exact limits pass; exceeded preflight leaves no destination or parent directories', async (t) => {
  const { source, put, dir, destination } = await fixture(t);
  await put('file.txt', '1234');
  const report = await copyWorkspace(source, destination, {
    copyOptions: { maxFiles: 1, maxBytes: 4 },
  });
  assert.deepEqual(report.exceeded, []);
  assert.equal(
    await readFile(path.join(destination, 'file.txt'), 'utf8'),
    '1234',
  );
  const oversized = path.join(dir, 'not-created', 'copy');
  await assert.rejects(
    copyWorkspace(source, oversized, { copyOptions: { maxBytes: 3 } }),
    { code: 'WORKSPACE_COPY_LIMIT' },
  );
  await absent(path.dirname(oversized));
  await put('extra.txt', '');
  await assert.rejects(
    copyWorkspace(source, oversized, { copyOptions: { maxFiles: 1 } }),
    { code: 'WORKSPACE_COPY_LIMIT' },
  );
  await absent(path.dirname(oversized));
});

test('source respects nested Git rules, root pipeline overrides and mandatory exclusions', async (t) => {
  const { source, put, destination } = await fixture(t);
  await put('.gitignore', '*.log\nignored/\nroot-only.txt\n');
  await put('.pipelineignore', '!keep.log\nextra/\n!node_modules/\n!.env\n');
  await put('nested/.gitignore', '!keep.log\n/nested-only.txt\n');
  await put('keep.log');
  await put('drop.log');
  await put('ignored/hidden.txt');
  await put('root-only.txt');
  await put('nested/keep.log');
  await put('nested/drop.log');
  await put('nested/nested-only.txt');
  await put('nested/sub/nested-only.txt');
  await put('extra/hidden.txt');
  await put('node_modules/hidden.txt');
  await put('.env', 'secret');
  await put('.env.local', 'secret');
  await put('nested/key.pem', 'secret');
  await put('nested/key.key', 'secret');
  await put('source.js');
  await symlink(path.join(source, 'source.js'), path.join(source, 'linked.js'));
  const report = await copyWorkspace(source, destination);
  for (const relative of [
    'keep.log',
    'nested/keep.log',
    'nested/sub/nested-only.txt',
    'source.js',
  ])
    assert.equal(
      await readFile(path.join(destination, relative), 'utf8'),
      relative,
    );
  for (const relative of [
    'drop.log',
    'ignored',
    'root-only.txt',
    'nested/drop.log',
    'nested/nested-only.txt',
    'extra',
    'node_modules',
    '.env',
    '.env.local',
    'nested/key.pem',
    'nested/key.key',
    'linked.js',
  ])
    await absent(path.join(destination, relative));
  assert.deepEqual(report.ignoreFiles, [
    '.gitignore',
    '.pipelineignore',
    'nested/.gitignore',
  ]);
});

test('pipeline rules override nested Git rules and retain Git excluded-parent behavior', async (t) => {
  const { source, put, destination } = await fixture(t);
  await put('.gitignore', 'restored/\n');
  await put('nested/.gitignore', '!data.bin\n');
  await put(
    '.pipelineignore',
    'nested/data.bin\n!restored/\n!restored/**\nblocked/\n!blocked/file.txt\n',
  );
  await put('nested/data.bin');
  await put('restored/file.txt');
  await put('blocked/file.txt');
  await copyWorkspace(source, destination);
  await absent(path.join(destination, 'nested/data.bin'));
  await absent(path.join(destination, 'blocked'));
  assert.equal(
    await readFile(path.join(destination, 'restored/file.txt'), 'utf8'),
    'restored/file.txt',
  );
});

test('source ignores tracked matching files and excludes no files due to external Git configuration', async (t) => {
  const { source, put, dir, destination } = await fixture(t);
  await exec('git', ['init', '--quiet', '--template=', source]);
  await put('tracked.log');
  await exec('git', ['-C', source, 'add', 'tracked.log']);
  await put('.gitignore', '*.log\n');
  await put('keep.txt');
  const before = await readFile(path.join(source, '.git/index'));
  const globalIgnore = path.join(dir, 'global-ignore');
  await writeFile(globalIgnore, 'keep.txt\n');
  const previous = { ...process.env };
  t.after(() => {
    for (const key of [
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'core.excludesFile';
  process.env.GIT_CONFIG_VALUE_0 = globalIgnore;
  await copyWorkspace(source, destination);
  await absent(path.join(destination, 'tracked.log'));
  assert.equal(
    await readFile(path.join(destination, 'keep.txt'), 'utf8'),
    'keep.txt',
  );
  assert.deepEqual(await readFile(path.join(source, '.git/index')), before);
});

test('handoff retains ignored generated artifacts and secrets but omits dependencies and symlinks', async (t) => {
  const { source, put, destination, dir } = await fixture(t);
  await put('.gitignore', 'generated/\n');
  await put('.pipelineignore', 'generated/\n');
  for (const relative of [
    'generated/output.txt',
    'dist/report.html',
    '.env.generated',
    '.codex/config.toml',
    'coverage/report.txt',
  ])
    await put(relative);
  for (const relative of [
    '.git/config',
    'node_modules/package/file',
    '.pipeline-data/data',
    '.DS_Store',
  ])
    await put(relative);
  await symlink(source, path.join(source, 'linked'));
  const report = await copyWorkspace(source, destination, { handoff: true });
  assert.deepEqual(report.ignoreFiles, []);
  for (const relative of [
    'generated/output.txt',
    'dist/report.html',
    '.env.generated',
    '.codex/config.toml',
    'coverage/report.txt',
  ])
    assert.equal(
      await readFile(path.join(destination, relative), 'utf8'),
      relative,
    );
  for (const relative of [
    '.git',
    'node_modules',
    '.pipeline-data',
    '.DS_Store',
    'linked',
  ])
    await absent(path.join(destination, relative));
  await assert.rejects(
    copyWorkspace(source, path.join(dir, 'too-small'), {
      handoff: true,
      copyOptions: { maxBytes: 1 },
    }),
    (error) => {
      assert.match(error.message, /Результаты предыдущего этапа/);
      assert.match(error.message, /не применяются/);
      return true;
    },
  );
});

test('copy failure never merges into or removes an existing destination', async (t) => {
  const { source, put, destination } = await fixture(t);
  await put('source.txt');
  await mkdir(destination);
  await writeFile(path.join(destination, 'user.txt'), 'preserve');
  await assert.rejects(copyWorkspace(source, destination), { code: 'EEXIST' });
  assert.equal(
    await readFile(path.join(destination, 'user.txt'), 'utf8'),
    'preserve',
  );
  await absent(path.join(destination, 'source.txt'));
});

test('files growing after preflight fail the dynamic limit and remove only the new copy', async (t) => {
  const { source, put, destination } = await fixture(t);
  await put('growing.txt', 'x');
  let mutated = false;
  await afterDestinationCreated(t, destination, async () => {
    mutated = true;
    await writeFile(path.join(source, 'growing.txt'), 'xx');
  });
  await assert.rejects(
    copyWorkspace(source, destination, { copyOptions: { maxBytes: 1 } }),
    { code: 'WORKSPACE_COPY_LIMIT' },
  );
  assert.equal(mutated, true);
  await absent(destination);
  assert.equal(await readFile(path.join(source, 'growing.txt'), 'utf8'), 'xx');
});

test('empty sources create a fresh empty working folder without requiring Git', async (t) => {
  const { destination } = await fixture(t);
  const report = await copyWorkspace('', destination, {
    copyOptions: { maxFiles: 2 },
  });
  assert.equal(report.fileCount, 0);
  assert.equal(report.bytes, 0);
  assert.equal(report.limits.maxFiles, 2);
  await access(destination);
});

test('new files after preflight hit the dynamic count limit and clean the new directory', async (t) => {
  const { source, put, destination } = await fixture(t);
  await put('first.txt', 'x');
  let mutated = false;
  await afterDestinationCreated(t, destination, async () => {
    mutated = true;
    await writeFile(path.join(source, 'second.txt'), 'y');
  });
  await assert.rejects(
    copyWorkspace(source, destination, { copyOptions: { maxFiles: 1 } }),
    { code: 'WORKSPACE_COPY_LIMIT' },
  );
  assert.equal(mutated, true);
  await absent(destination);
  assert.equal(await readFile(path.join(source, 'second.txt'), 'utf8'), 'y');
});

test('destinations nested in source require an excluded ancestor, including through symlink aliases', async (t) => {
  const { source, put, dir } = await fixture(t);
  await put('first.txt', 'x');
  const nested = path.join(source, 'custom-data', 'copy');
  await assert.rejects(
    copyWorkspace(source, nested),
    /внутри копируемой папки/,
  );
  await absent(path.dirname(nested));
  const alias = path.join(dir, 'alias');
  await symlink(source, alias);
  await assert.rejects(
    copyWorkspace(source, path.join(alias, 'copy')),
    /внутри копируемой папки/,
  );
  await absent(path.join(source, 'copy'));
  const safe = path.join(source, '.pipeline-data', 'copy');
  const report = await copyWorkspace(source, safe);
  assert.equal(report.fileCount, 1);
  assert.equal(await readFile(path.join(safe, 'first.txt'), 'utf8'), 'x');
});

test('file names with spaces, newlines and non-ASCII text pass through the ignore protocol', async (t) => {
  const { source, put, destination } = await fixture(t);
  await put('nested folder/файл\nс переносом.txt', 'ok');
  await put('.pipelineignore', '*.log\n');
  await put('лог с пробелом.log', 'ignored');
  const report = await copyWorkspace(source, destination);
  assert.equal(report.fileCount, 2);
  assert.equal(
    await readFile(
      path.join(destination, 'nested folder/файл\nс переносом.txt'),
      'utf8',
    ),
    'ok',
  );
  await absent(path.join(destination, 'лог с пробелом.log'));
});
