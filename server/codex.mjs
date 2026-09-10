import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';

export class CodexClient extends EventEmitter {
  pending = new Map();
  counter = 0;
  proc = null;
  async connect() {
    const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex';
    const executable =
      process.env.PIPELINE_CODEX_BIN ||
      (existsSync(bundled) ? bundled : 'codex');
    this.proc = spawn(executable, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method) {
        this.emit(
          message.id === undefined ? 'notification' : 'request',
          message,
        );
      } else {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    });
    // CLI diagnostics can include paths or request data; don't forward them to the browser.
    this.proc.stderr.on('data', () => {});
    this.proc.on('error', (error) => this.disconnected(error));
    this.proc.on('exit', () =>
      this.disconnected(
        new Error('Codex остановлен. Перезапусти локальный исполнитель.'),
      ),
    );
    await this.request('initialize', {
      clientInfo: {
        name: 'pipeline_studio',
        title: 'Pipeline',
        version: '0.1.0',
      },
    });
    this.send({ method: 'initialized', params: {} });
  }
  disconnected(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('disconnect', error);
  }
  send(message) {
    if (!this.proc?.stdin.writable) throw new Error('Нет соединения с Codex');
    this.proc.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex не ответил: ${method}`));
      }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  reply(id, result) {
    this.send({ id, result });
  }
  reject(id, message) {
    this.send({ id, error: { code: -32601, message } });
  }
  close() {
    this.proc?.kill('SIGTERM');
  }
}
