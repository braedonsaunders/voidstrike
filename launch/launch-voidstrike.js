#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_DIR = path.resolve(__dirname, '..');
const DEFAULT_START_PORT = 3000;
const DEFAULT_PORT_SCAN_LIMIT = 100;
const DEFAULT_READY_TIMEOUT_MS = 120000;
const DEFAULT_READY_POLL_INTERVAL_MS = 1000;
const FALLBACK_MINIMUM_NODE_VERSION = '20.9.0';

function logInfo(message) {
  process.stdout.write(`${message}\n`);
}

function parseVersion(version) {
  const [major = '0', minor = '0', patch = '0'] = String(version).replace(/^v/, '').split('.');
  return [Number(major), Number(minor), Number(patch)];
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }

    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
  }

  return 0;
}

function extractMinimumVersion(range) {
  const matches = String(range).match(/\d+\.\d+\.\d+/g);

  if (!matches || matches.length === 0) {
    return null;
  }

  return matches.reduce((minimumVersion, candidateVersion) => {
    if (compareVersions(candidateVersion, minimumVersion) < 0) {
      return candidateVersion;
    }

    return minimumVersion;
  });
}

function getRequiredNodeVersion() {
  const nextPackagePath = path.join(PROJECT_DIR, 'node_modules', 'next', 'package.json');

  try {
    const nextPackage = JSON.parse(fs.readFileSync(nextPackagePath, 'utf8'));
    return extractMinimumVersion(nextPackage.engines?.node) ?? FALLBACK_MINIMUM_NODE_VERSION;
  } catch {
    return FALLBACK_MINIMUM_NODE_VERSION;
  }
}

function ensureSupportedNodeVersion() {
  const requiredVersion = getRequiredNodeVersion();

  if (compareVersions(process.versions.node, requiredVersion) < 0) {
    throw new Error(
      `Node.js ${requiredVersion}+ is required. Current version: ${process.version}.`
    );
  }
}

function normalizeStartPort(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_START_PORT), 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_START_PORT;
  }

  return parsed;
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function createDisplayUrl(port) {
  return `http://localhost:${port}`;
}

function createProbeUrl(port) {
  return `http://localhost:${port}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_DIR,
      env: process.env,
      stdio: 'inherit',
      ...options,
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} exited from signal ${signal}.`));
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}.`));
    });
  });
}

async function ensureDependenciesInstalled() {
  const nodeModulesPath = path.join(PROJECT_DIR, 'node_modules');

  if (!fs.existsSync(nodeModulesPath)) {
    logInfo('Installing dependencies...');
    await runCommand(getNpmCommand(), ['install']);
  }
}

function canListenOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.unref();
    server.once('error', (error) => {
      if (
        host === '::' &&
        typeof error?.code === 'string' &&
        (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL')
      ) {
        resolve('unsupported');
        return;
      }

      resolve(false);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

async function isPortAvailable(port) {
  const ipv4Availability = await canListenOnHost(port, '127.0.0.1');
  const ipv6Availability = await canListenOnHost(port, '::');

  return (
    ipv4Availability === true && (ipv6Availability === true || ipv6Availability === 'unsupported')
  );
}

async function findAvailablePort(startPort, limit = DEFAULT_PORT_SCAN_LIMIT) {
  const maxOffset = Math.min(limit, 65535 - startPort + 1);

  for (let offset = 0; offset < maxOffset; offset += 1) {
    const port = startPort + offset;

    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(
    `Unable to find an open port after checking ${maxOffset} ports starting at ${startPort}.`
  );
}

function probeUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.request(url, { method: 'GET' }, (response) => {
      response.resume();
      resolve(Boolean(response.statusCode) && response.statusCode < 500);
    });

    request.once('error', () => {
      resolve(false);
    });
    request.setTimeout(3000, () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

async function waitForServerReady(
  url,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  intervalMs = DEFAULT_READY_POLL_INTERVAL_MS
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await probeUrl(url)) {
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for the server to respond at ${url}.`);
}

async function waitForServerReadyOrExit(
  child,
  url,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
  intervalMs = DEFAULT_READY_POLL_INTERVAL_MS
) {
  const readyPromise = waitForServerReady(url, timeoutMs, intervalMs);
  const exitPromise = waitForChildExit(child).then((exitCode) => {
    throw new Error(`The production server exited before it became ready. Exit code: ${exitCode}.`);
  });

  await Promise.race([readyPromise, exitPromise]);
}

function openBrowser(url) {
  if (process.env.CI) {
    return;
  }

  let child;

  if (process.platform === 'darwin') {
    child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }

  child.once('error', () => {
    console.warn(`Unable to open a browser automatically. Open ${url} manually.`);
  });
  child.unref();
}

function waitForChildExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }

    child.once('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });

      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([waitForChildExit(child), sleep(5000)]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForChildExit(child);
  }
}

async function run() {
  ensureSupportedNodeVersion();
  await ensureDependenciesInstalled();

  const startPort = normalizeStartPort(process.env.VOIDSTRIKE_PORT);
  const port = await findAvailablePort(startPort);
  const displayUrl = createDisplayUrl(port);
  const probeUrlValue = createProbeUrl(port);

  logInfo(`Using port ${port}.`);
  logInfo('Building VOIDSTRIKE for production...');
  await runCommand(getNpmCommand(), ['run', 'build']);

  logInfo(`Starting production server at ${displayUrl}...`);
  const serverProcess = spawn(getNpmCommand(), ['run', 'start', '--', '-p', String(port)], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: 'inherit',
  });

  let shuttingDown = false;

  const shutdown = async (signal, exitCode = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await terminateProcessTree(serverProcess);

    if (signal) {
      process.exit(exitCode);
    }
  };

  const handleSignal = (signal) => {
    shutdown(signal, 0).catch((error) => {
      console.error(`Failed to stop the server cleanly after ${signal}.`);
      console.error(error);
      process.exit(1);
    });
  };

  serverProcess.once('error', (error) => {
    console.error('Failed to start the production server.');
    console.error(error);
    process.exit(1);
  });

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  process.once('SIGHUP', handleSignal);
  process.once('uncaughtException', (error) => {
    console.error(error);
    shutdown('uncaughtException', 1).catch(() => {
      process.exit(1);
    });
  });
  process.once('unhandledRejection', (error) => {
    console.error(error);
    shutdown('unhandledRejection', 1).catch(() => {
      process.exit(1);
    });
  });
  process.once('exit', () => {
    if (serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM');
    }
  });

  await waitForServerReadyOrExit(serverProcess, probeUrlValue);
  logInfo(`VOIDSTRIKE is ready at ${displayUrl}`);
  logInfo('Logs will stay in this terminal. Close it or press Ctrl+C to stop the server.');
  openBrowser(displayUrl);

  const exitCode = await waitForChildExit(serverProcess);
  await shutdown(null, exitCode);
  process.exit(exitCode);
}

module.exports = {
  compareVersions,
  createDisplayUrl,
  createProbeUrl,
  extractMinimumVersion,
  findAvailablePort,
  getRequiredNodeVersion,
  isPortAvailable,
  logInfo,
  normalizeStartPort,
  parseVersion,
  waitForServerReady,
  waitForServerReadyOrExit,
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
