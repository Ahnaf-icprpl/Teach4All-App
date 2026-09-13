import net from 'node:net';
import tls from 'node:tls';

/**
 * Minimal, zero-dependency Redis client using the Redis Serialization Protocol (RESP).
 * Designed for high throughput, sub-millisecond rate-limiting and counter operations.
 */
export class RedisClient {
  constructor(url) {
    this.url = new URL(url || process.env.REDIS_URL || 'redis://localhost:6379');
    this.socket = null;
    this.queue = [];
    this.buffer = '';
    this.connected = false;
    this.authenticated = false;
    this.connecting = false;
    this.reconnectTimer = null;
    this.destroyed = false;
  }

  connect() {
    if (this.connected || this.connecting || this.destroyed) return this;
    this.connecting = true;

    const isTls = this.url.protocol === 'rediss:';
    const port = Number(this.url.port) || (isTls ? 6380 : 6379);
    const host = this.url.hostname || 'localhost';

    const socket = isTls
      ? tls.connect({ host, port })
      : net.createConnection({ host, port });
    this.socket = socket;
    socket.setKeepAlive(true, 10000);
    socket.setNoDelay(true);
    socket.unref();

    socket.setTimeout(5000);
    socket.on('timeout', () => {
      this._handleDisconnect(new Error('Redis connection timed out'));
    });

    socket.on('connect', async () => {
      socket.setTimeout(0);
      this.connecting = false;
      this.connected = true;

      try {
        if (this.url.password) {
          const user = this.url.username || 'default';
          await this._rawSend(['AUTH', user, this.url.password]);
        }
        this.authenticated = true;
      } catch (err) {
        this._failPending(err);
      }
    });

    socket.on('data', chunk => this._handleData(chunk));

    socket.on('error', err => {
      this._handleDisconnect(err);
    });

    socket.on('close', () => {
      this._handleDisconnect(new Error('Redis connection closed'));
    });

    return this;
  }

  _handleDisconnect(err) {
    this.connected = false;
    this.connecting = false;
    this.authenticated = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = '';

    this._failPending(err || new Error('Connection lost'));

    if (!this.destroyed && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.destroyed) this.connect();
      }, 2000);
      if (this.reconnectTimer.unref) this.reconnectTimer.unref();
    }
  }

  _failPending(err) {
    while (this.queue.length > 0) {
      const { reject } = this.queue.shift();
      reject(err);
    }
  }

  _handleData(chunk) {
    this.buffer += chunk.toString('utf8');

    while (this.buffer.length > 0) {
      const parsed = this._parseResp(0);
      if (!parsed) break; // Incomplete response, wait for more data

      const { value, bytesParsed } = parsed;
      this.buffer = this.buffer.slice(bytesParsed);

      const item = this.queue.shift();
      if (item) {
        if (value instanceof Error) item.reject(value);
        else item.resolve(value);
      }
    }
  }

  _parseResp(offset) {
    const crlf = this.buffer.indexOf('\r\n', offset);
    if (crlf === -1) return null;

    const type = this.buffer[offset];
    const line = this.buffer.slice(offset + 1, crlf);

    if (type === '+') {
      return { value: line, bytesParsed: crlf + 2 - offset };
    }
    if (type === '-') {
      return { value: new Error(line), bytesParsed: crlf + 2 - offset };
    }
    if (type === ':') {
      return { value: parseInt(line, 10), bytesParsed: crlf + 2 - offset };
    }
    if (type === '$') {
      const len = parseInt(line, 10);
      if (len === -1) {
        return { value: null, bytesParsed: crlf + 2 - offset };
      }
      const dataStart = crlf + 2;
      const dataEnd = dataStart + len;
      if (this.buffer.length < dataEnd + 2) return null; // Need more data
      const str = this.buffer.slice(dataStart, dataEnd);
      return { value: str, bytesParsed: dataEnd + 2 - offset };
    }
    if (type === '*') {
      const count = parseInt(line, 10);
      if (count === -1) {
        return { value: null, bytesParsed: crlf + 2 - offset };
      }
      let currentOffset = crlf + 2;
      const elements = [];
      for (let i = 0; i < count; i++) {
        const elem = this._parseResp(currentOffset);
        if (!elem) return null;
        elements.push(elem.value);
        currentOffset += elem.bytesParsed;
      }
      return { value: elements, bytesParsed: currentOffset - offset };
    }

    return null;
  }

  _rawSend(args) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      let cmd = `*${args.length}\r\n`;
      for (const arg of args) {
        const str = String(arg);
        cmd += `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
      }
      this.socket.write(cmd);
    });
  }

  async send(...args) {
    if (this.destroyed) throw new Error('RedisClient has been closed');
    if (!this.connected) this.connect();

    // Wait until authenticated if connection is in progress
    if (!this.authenticated) {
      await new Promise((resolve, reject) => {
        const check = setInterval(() => {
          if (this.authenticated) {
            clearInterval(check);
            resolve();
          } else if (!this.connecting && !this.connected) {
            clearInterval(check);
            reject(new Error('Could not connect to Redis'));
          }
        }, 50);
      });
    }

    const flatArgs = Array.isArray(args[0]) ? args[0] : args;
    return this._rawSend(flatArgs);
  }

  ping() {
    return this.send('PING');
  }

  incr(key) {
    return this.send('INCR', key);
  }

  expire(key, seconds) {
    return this.send('EXPIRE', key, seconds);
  }

  del(key) {
    return this.send('DEL', key);
  }

  eval(script, numKeys, ...args) {
    return this.send('EVAL', script, numKeys, ...args);
  }

  get(key) {
    return this.send('GET', key);
  }

  set(key, value, ...options) {
    return this.send('SET', key, value, ...options);
  }

  hincrby(key, field, increment = 1) {
    return this.send('HINCRBY', key, field, increment);
  }

  hgetall(key) {
    return this.send('HGETALL', key);
  }

  ttl(key) {
    return this.send('TTL', key);
  }

  close() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.authenticated = false;
  }
}

let defaultClient = null;

export function getRedisClient(url) {
  const targetUrl = url || process.env.REDIS_URL;
  if (!targetUrl) return null;

  try {
    const parsed = new URL(targetUrl);
    if (!defaultClient || defaultClient.destroyed || defaultClient.url.href !== parsed.href) {
      if (defaultClient && !defaultClient.destroyed) {
        defaultClient.close();
      }
      defaultClient = new RedisClient(targetUrl);
      defaultClient.connect();
    }
  } catch {
    return null;
  }

  return defaultClient;
}

export function closeDefaultClient() {
  if (defaultClient) {
    defaultClient.close();
    defaultClient = null;
  }
}
