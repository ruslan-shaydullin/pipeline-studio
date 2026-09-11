import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const defaults = { maxFiles: 10000, maxBytes: 150 * 1024 * 1024 };
const alwaysExcluded = new Set([
  '.git',
  'node_modules',
  '.pipeline-data',
  '.DS_Store',
]);
const sourceExcluded = new Set([
  '.next',
  '.vinext',
  '.wrangler',
  '.codex',
  'dist',
  'coverage',
]);

export function normalizeCopyOptions(input) {
  if (input === undefined) return { ...defaults };
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(defaults, key))
  )
    throw new Error(
      'Настройки копирования должны содержать только maxFiles и maxBytes.',
    );
  const result = { ...defaults, ...input };
  for (const key of Object.keys(defaults)) {
    if (!Number.isSafeInteger(result[key]) || result[key] <= 0)
      throw new Error(
        'Лимиты копирования должны быть положительными целыми числами.',
      );
  }
  return result;
}

function emptyReport(limits) {
  return {
    fileCount: 0,
    bytes: 0,
    excludedCount: 0,
    largestDirectories: [],
    largestFiles: [],
    exceeded: [],
    limits,
    ignoreFiles: [],
  };
}

function exceeded(report) {
  report.exceeded = [];
  if (report.fileCount > report.limits.maxFiles) report.exceeded.push('files');
  if (report.bytes > report.limits.maxBytes) report.exceeded.push('bytes');
  return report;
}

const size = (bytes) =>
  bytes < 1024 * 1024
    ? `${bytes.toLocaleString('ru-RU')} байт`
    : `${(bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МиБ`;

export function assertWorkspaceFits(report, { handoff = false } = {}) {
  exceeded(report);
  if (!report.exceeded.length) return;
  const boundaries = report.exceeded
    .map((kind) => (kind === 'files' ? 'количество файлов' : 'объём файлов'))
    .join(' и ');
  const largest = report.largestDirectories.length
    ? report.largestDirectories
        .slice(0, 3)
        .map(
          (item) =>
            `${item.path}: ${item.fileCount} файлов, ${size(item.bytes)}`,
        )
        .join('; ')
    : report.largestFiles
        .slice(0, 3)
        .map((item) => `${item.path}: ${size(item.bytes)}`)
        .join('; ');
  const error = new Error(
    `${handoff ? 'Результаты предыдущего этапа' : 'Папка с исходниками'} превышают лимит копирования (${boundaries}): ${report.fileCount} файлов / ${size(report.bytes)}; лимиты: ${report.limits.maxFiles} файлов / ${size(report.limits.maxBytes)}.` +
      (largest ? ` Больше всего: ${largest}.` : '') +
      (handoff
        ? ' Увеличь лимиты для следующих этапов или сократи ненужные результаты в рабочей папке предыдущего этапа. Правила .gitignore и .pipelineignore при передаче результатов не применяются.'
        : ' Проверь состав папки, исключи ненужное через .gitignore или .pipelineignore, выбери папку меньшего размера либо увеличь лимиты запуска.'),
  );
  error.code = 'WORKSPACE_COPY_LIMIT';
  error.report = report;
  throw error;
}

// Keep Git's mature ignore parser, but isolate its metadata and configuration.
// Neither the source repository's index nor global excludes affect this copy.
function gitEnvironment() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
    ),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_FLUSH: '1',
  };
}

function ignoreParser(gitDirectory, worktree, env) {
  const child = spawn(
    'git',
    [
      '--no-optional-locks',
      `--git-dir=${gitDirectory}`,
      `--work-tree=${worktree}`,
      '-c',
      'core.excludesFile=/dev/null',
      'check-ignore',
      '--no-index',
      '--stdin',
      '-z',
      '--verbose',
      '--non-matching',
    ],
    { cwd: worktree, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '',
    fields = [],
    pending = null,
    failure = null,
    closing = false;
  const fail = (error) => {
    failure = error;
    pending?.reject(error);
    pending = null;
  };
  const ended = new Promise((resolve) => {
    child.on('error', (error) => {
      fail(
        new Error(`Не удалось проверить правила исключения: ${error.message}`),
      );
      resolve();
    });
    child.on('close', (code) => {
      if (!closing || (code !== 0 && code !== 1))
        fail(
          new Error(
            'Git не смог проверить правила .gitignore / .pipelineignore.',
          ),
        );
      resolve();
    });
  });
  child.stdin.on('error', (error) => fail(error));
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    output += data;
    let end;
    while ((end = output.indexOf('\0')) >= 0) {
      fields.push(output.slice(0, end));
      output = output.slice(end + 1);
      if (fields.length !== 4) continue;
      const pattern = fields[2];
      if (pending) {
        pending.results.push(pattern ? !pattern.startsWith('!') : null);
        if (pending.results.length === pending.count) {
          pending.resolve(pending.results);
          pending = null;
        }
      }
      fields = [];
    }
  });
  return {
    check(paths) {
      if (failure) return Promise.reject(failure);
      if (!paths.length) return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, results: [], count: paths.length };
        child.stdin.write(`${paths.join('\0')}\0`);
      });
    },
    async close() {
      closing = true;
      child.stdin.end();
      await ended;
    },
  };
}

async function createIgnoreRules(source) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'pipeline-ignore-'));
  const parsers = [];
  try {
    const env = gitEnvironment();
    const metadata = path.join(temporary, 'metadata');
    await exec('git', ['init', '--quiet', '--template=', metadata], { env });
    const gitDirectory = path.join(metadata, '.git');
    const sourceRules = ignoreParser(gitDirectory, source, env);
    parsers.push(sourceRules);
    let pipelineRules = null;
    const custom = path.join(source, '.pipelineignore');
    const customStat = await lstat(custom).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (customStat?.isFile()) {
      const overlay = path.join(temporary, 'overlay');
      await mkdir(overlay);
      await writeFile(path.join(overlay, '.gitignore'), await readFile(custom));
      pipelineRules = ignoreParser(gitDirectory, overlay, env);
      parsers.push(pipelineRules);
    }
    return {
      custom: !!pipelineRules,
      async check(paths) {
        const [standard, customMatches] = await Promise.all([
          sourceRules.check(paths),
          pipelineRules ? pipelineRules.check(paths) : Promise.resolve([]),
        ]);
        return standard.map(
          (ignored, index) => customMatches[index] ?? ignored ?? false,
        );
      },
      async close() {
        await Promise.all(parsers.map((parser) => parser.close()));
        await rm(temporary, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await Promise.all(parsers.map((parser) => parser.close()));
    await rm(temporary, { recursive: true, force: true });
    throw new Error(
      `Не удалось подготовить проверку исключений. Убедись, что Git установлен. ${error.message}`,
    );
  }
}

function mandatoryExclusion(name, handoff) {
  return (
    alwaysExcluded.has(name) ||
    (!handoff &&
      (sourceExcluded.has(name) ||
        name === '.env' ||
        name.startsWith('.env.') ||
        /\.(pem|key)$/.test(name)))
  );
}

async function walkWorkspace(source, { handoff, copyOptions }, visit) {
  const report = emptyReport(normalizeCopyOptions(copyOptions));
  if (!source) return report;
  const root = await realpath(source);
  if (!(await lstat(root)).isDirectory())
    throw new Error('Выбери папку с исходниками.');
  const rules = handoff ? null : await createIgnoreRules(root);
  if (rules?.custom) report.ignoreFiles.push('.pipelineignore');
  const directories = new Map();
  const addFile = (relative, bytes) => {
    report.fileCount++;
    report.bytes += bytes;
    report.largestFiles.push({ path: relative, bytes });
    report.largestFiles.sort(
      (a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path),
    );
    report.largestFiles.length = Math.min(5, report.largestFiles.length);
    const top = relative.includes('/') ? relative.split('/')[0] : '.';
    const directory = directories.get(top) || {
      path: top,
      fileCount: 0,
      bytes: 0,
    };
    directory.fileCount++;
    directory.bytes += bytes;
    directories.set(top, directory);
    report.largestDirectories = [
      ...report.largestDirectories.filter((item) => item.path !== top),
      directory,
    ]
      .sort(
        (a, b) =>
          b.bytes - a.bytes ||
          b.fileCount - a.fileCount ||
          a.path.localeCompare(b.path),
      )
      .slice(0, 5);
  };
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!handoff && entry.name === '.gitignore' && entry.isFile())
        report.ignoreFiles.push(relative);
      if (
        mandatoryExclusion(entry.name, handoff) ||
        entry.isSymbolicLink() ||
        (!entry.isDirectory() && !entry.isFile())
      ) {
        report.excludedCount++;
        continue;
      }
      candidates.push({ entry, relative });
    }
    const ignored = rules
      ? await rules.check(
          candidates.map(
            ({ entry, relative }) =>
              relative + (entry.isDirectory() ? '/' : ''),
          ),
        )
      : [];
    for (let i = 0; i < candidates.length; i++) {
      if (ignored[i]) {
        report.excludedCount++;
        continue;
      }
      const { entry, relative } = candidates[i];
      const absolute = path.join(directory, entry.name);
      if (absolute === visit?.destination) {
        report.excludedCount++;
        continue;
      }
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        report.excludedCount++;
        continue;
      }
      if (stat.isDirectory()) {
        await visit?.directory(relative);
        await walk(absolute, relative);
      } else {
        addFile(relative, stat.size);
        await visit?.file(absolute, relative, stat, report);
      }
    }
  }
  try {
    await walk(root);
    report.ignoreFiles.sort((a, b) => a.localeCompare(b));
    return exceeded(report);
  } finally {
    await rules?.close();
  }
}

export async function inspectWorkspace(
  source,
  { handoff = false, copyOptions } = {},
) {
  return walkWorkspace(source, { handoff, copyOptions });
}

async function resolveDestination(destination) {
  let existing = path.resolve(destination);
  const suffix = [];
  for (;;) {
    try {
      return path.join(await realpath(existing), ...suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      suffix.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

export async function copyWorkspace(
  source,
  destination,
  { handoff = false, copyOptions } = {},
) {
  const options = { handoff, copyOptions: normalizeCopyOptions(copyOptions) };
  destination = await resolveDestination(destination);
  if (source) {
    const relative = path.relative(await realpath(source), destination);
    const insideSource =
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative));
    if (
      insideSource &&
      !relative
        .split(path.sep)
        .some((name) => mandatoryExclusion(name, handoff))
    )
      throw new Error(
        'Рабочая копия не должна находиться внутри копируемой папки. Выбери отдельную папку для данных Pipeline Studio.',
      );
  }
  const preview = await inspectWorkspace(source, options);
  assertWorkspaceFits(preview, options);
  // A non-recursive mkdir establishes ownership: an existing destination must
  // never be merged into or removed when a copy fails.
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination);
  try {
    return await walkWorkspace(source, options, {
      destination: path.resolve(destination),
      directory: (relative) => mkdir(path.join(destination, relative)),
      async file(absolute, relative, stat, report) {
        assertWorkspaceFits(report, options);
        const sourceFile = await open(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        let targetFile;
        try {
          if (!(await sourceFile.stat()).isFile())
            throw new Error(`Файл изменился во время копирования: ${relative}`);
          targetFile = await open(
            path.join(destination, relative),
            'wx',
            stat.mode,
          );
          let copied = 0;
          const guard = new Transform({
            transform(chunk, _encoding, callback) {
              copied += chunk.length;
              try {
                assertWorkspaceFits(
                  { ...report, bytes: report.bytes - stat.size + copied },
                  options,
                );
                callback(null, chunk);
              } catch (error) {
                callback(error);
              }
            },
          });
          await pipeline(
            sourceFile.createReadStream(),
            guard,
            targetFile.createWriteStream(),
          );
          if (copied !== stat.size)
            throw new Error(
              `Файл изменился во время копирования: ${relative}. Повтори проверку папки.`,
            );
        } finally {
          await sourceFile.close();
          await targetFile?.close();
        }
      },
    });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}
