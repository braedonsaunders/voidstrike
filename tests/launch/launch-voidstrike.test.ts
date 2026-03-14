import { createServer } from 'node:net';
import type { Server } from 'node:net';

const {
  createDisplayUrl,
  extractMinimumVersion,
  findAvailablePort,
  normalizeStartPort,
} = require('../../launch/launch-voidstrike.js');

async function listenOnPort(port: number): Promise<Server> {
  return await new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    const server = await listenOnPort(port);
    await new Promise((resolve) => server.close(resolve));
    return true;
  } catch {
    return false;
  }
}

async function findConsecutivePorts(count: number): Promise<number> {
  for (let port = 41000; port <= 65000 - count; port += 1) {
    let available = true;

    for (let offset = 0; offset < count; offset += 1) {
      if (!(await isPortFree(port + offset))) {
        available = false;
        break;
      }
    }

    if (available) {
      return port;
    }
  }

  throw new Error(`Unable to find ${count} consecutive free ports for the launcher test.`);
}

describe('launch-voidstrike helpers', () => {
  let reservedServers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      reservedServers.map(
        (server) =>
          new Promise((resolve) => {
            server.close(resolve);
          })
      )
    );
    reservedServers = [];
  });

  it('uses 3000 when the requested start port is invalid', () => {
    expect(normalizeStartPort('invalid')).toBe(3000);
    expect(normalizeStartPort('70000')).toBe(3000);
  });

  it('extracts the minimum version from an engine range', () => {
    expect(extractMinimumVersion('>=20.9.0')).toBe('20.9.0');
    expect(extractMinimumVersion('^22.1.0 || >=20.9.0')).toBe('20.9.0');
  });

  it('creates a localhost display URL', () => {
    expect(createDisplayUrl(3123)).toBe('http://localhost:3123');
  });

  it('increments the port until it finds a free one', async () => {
    const startPort = await findConsecutivePorts(3);

    reservedServers = [await listenOnPort(startPort), await listenOnPort(startPort + 1)];

    await expect(findAvailablePort(startPort, 5)).resolves.toBe(startPort + 2);
  });
});
