const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const {
  chromium,
} = require('/Users/braedonsaunders/.codex/skills/develop-web-game/node_modules/playwright');

const baseUrl = process.env.VOIDSTRIKE_BASE_URL || 'http://127.0.0.1:3308';
const outDir = path.join(
  process.cwd(),
  'output',
  'playwright',
  'multiplayer-checksum-five-minute-' + Date.now()
);
const testDurationMs = 5 * 60 * 1000;

function round(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(3));
}

function normalizeQueue(queue = []) {
  return queue.map((item) => ({
    type: item.type,
    targetX: round(item.targetX),
    targetY: round(item.targetY),
    targetEntityId: item.targetEntityId ?? null,
  }));
}

function commandView(unit) {
  if (!unit) return null;
  return {
    state: unit.state,
    targetX: round(unit.targetX),
    targetY: round(unit.targetY),
    targetEntityId: unit.targetEntityId ?? null,
    queue: normalizeQueue(unit.queue),
    isDead: unit.isDead,
  };
}

function meaningfulChange(previous, current) {
  if (!previous || !current) return true;
  if (JSON.stringify(commandView(previous)) !== JSON.stringify(commandView(current))) {
    return true;
  }
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  return Math.hypot(dx, dy) > 0.5;
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function getStatus(page) {
  return page.evaluate(() => globalThis.__voidstrikeMultiplayerDebug__.getStatus());
}

async function requestChecksum(page) {
  return page.evaluate(
    async () => await globalThis.__voidstrikeMultiplayerDebug__.requestChecksum()
  );
}

async function waitForRenderWarm(page) {
  await page.waitForFunction(
    () =>
      !!globalThis.__voidstrikeMultiplayerDebug__ &&
      globalThis.__voidstrikeMultiplayerDebug__.getStatus().renderTick >= 20,
    { timeout: 45000 }
  );
}

async function ensureHealthy(page, name) {
  if (!page.url().includes('/game')) {
    throw new Error(name + ' left /game: ' + page.url());
  }
  const text = await bodyText(page);
  if (text.includes('Connection Lost')) {
    throw new Error(name + ' displayed Connection Lost');
  }
  if (text.includes('Game Desynchronized')) {
    throw new Error(name + ' displayed Game Desynchronized');
  }
}

async function captureSnapshot(page, name) {
  const debug = await page.evaluate(() => {
    const r = (value) => {
      if (value === null || value === undefined || Number.isNaN(value)) return null;
      return Number(value.toFixed(3));
    };
    const adapter = globalThis.__voidstrike_RenderStateWorldAdapter__;
    if (!adapter || !adapter.currentRenderState) {
      return null;
    }

    const rs = adapter.currentRenderState;
    return {
      tick: rs.tick,
      gameTime: r(rs.gameTime),
      units: rs.units
        .map((unit) => ({
          id: unit.id,
          playerId: unit.playerId,
          unitId: unit.unitId,
          x: r(unit.x),
          y: r(unit.y),
          z: r(unit.z),
          state: unit.state,
          health: r(unit.health),
          shield: r(unit.shield),
          isDead: unit.isDead,
          targetEntityId: unit.targetEntityId,
          targetX: r(unit.targetX),
          targetY: r(unit.targetY),
          speed: r(unit.speed),
          queue: unit.commandQueue.map((cmd) => ({
            type: cmd.type,
            targetX: r(cmd.targetX),
            targetY: r(cmd.targetY),
            targetEntityId: cmd.targetEntityId ?? null,
          })),
        }))
        .sort((a, b) => a.id - b.id),
    };
  });

  if (!debug) {
    throw new Error(name + ' snapshot unavailable');
  }

  return debug;
}

async function waitForPlayerAction(
  primaryPage,
  secondaryPage,
  playerId,
  previousPrimarySnap,
  previousSecondarySnap,
  label
) {
  const deadline = Date.now() + 20000;
  let lastError = 'not started';

  while (Date.now() < deadline) {
    const [primarySnap, secondarySnap, primaryStatus, secondaryStatus] = await Promise.all([
      captureSnapshot(primaryPage, 'primary'),
      captureSnapshot(secondaryPage, 'secondary'),
      getStatus(primaryPage),
      getStatus(secondaryPage),
    ]);

    if (primaryStatus.desyncState !== 'synced' || secondaryStatus.desyncState !== 'synced') {
      throw new Error(
        label + ' entered desync: ' + JSON.stringify({ primaryStatus, secondaryStatus })
      );
    }
    if (
      primaryStatus.connectionStatus !== 'connected' ||
      secondaryStatus.connectionStatus !== 'connected'
    ) {
      throw new Error(
        label + ' lost connection: ' + JSON.stringify({ primaryStatus, secondaryStatus })
      );
    }

    const primaryUnits = primarySnap.units.filter((unit) => unit.playerId === playerId);
    let matchingPair = null;

    for (const primaryUnit of primaryUnits) {
      const secondaryUnit = secondarySnap.units.find((unit) => unit.id === primaryUnit.id) ?? null;
      const previousPrimaryUnit =
        previousPrimarySnap.units.find((unit) => unit.id === primaryUnit.id) ?? null;
      const previousSecondaryUnit =
        previousSecondarySnap.units.find((unit) => unit.id === primaryUnit.id) ?? null;

      if (!secondaryUnit || !previousPrimaryUnit || !previousSecondaryUnit) {
        continue;
      }

      if (JSON.stringify(commandView(primaryUnit)) !== JSON.stringify(commandView(secondaryUnit))) {
        continue;
      }

      if (
        !meaningfulChange(previousPrimaryUnit, primaryUnit) ||
        !meaningfulChange(previousSecondaryUnit, secondaryUnit)
      ) {
        continue;
      }

      matchingPair = { primaryUnit, secondaryUnit };
      break;
    }

    if (!matchingPair) {
      lastError = 'no changed unit found for ' + playerId;
      await primaryPage.waitForTimeout(100);
      continue;
    }

    return {
      primaryUnit: matchingPair.primaryUnit,
      secondaryUnit: matchingPair.secondaryUnit,
      primarySnap,
      secondarySnap,
      primaryStatus,
      secondaryStatus,
    };
  }

  throw new Error(label + ' did not display consistently: ' + lastError);
}

async function ensureWorkerSelected(page) {
  const buildBasic = page.getByRole('button', { name: 'Build Basic' });
  if (await buildBasic.isVisible().catch(() => false)) {
    return;
  }

  const idleButton = page.getByRole('button', { name: /Idle \(/ });
  await idleButton.waitFor({ timeout: 15000 });
  await idleButton.click();
  await buildBasic.waitFor({ timeout: 10000 });
}

async function issueMove(page, position) {
  await ensureWorkerSelected(page);
  await page.keyboard.press('M');
  await page.getByText('Move - Click canvas or minimap, ESC to cancel').waitFor({ timeout: 5000 });
  await page.locator('canvas').first().click({ position });
  await page
    .getByText('Move - Click canvas or minimap, ESC to cancel')
    .waitFor({ state: 'hidden', timeout: 5000 });
}

async function issueHold(page) {
  await ensureWorkerSelected(page);
  await page.keyboard.press('H');
}

async function issueStop(page) {
  await ensureWorkerSelected(page);
  await page.keyboard.press('S');
}

async function toggleFogOff(page) {
  const fogRow = page.getByText('Fog of War', { exact: true }).locator('..');
  await fogRow.locator('button').click();
}

async function configureLobby(host, guest) {
  await Promise.all([
    host.goto(baseUrl + '/game/setup', { waitUntil: 'domcontentloaded' }),
    guest.goto(baseUrl + '/game/setup', { waitUntil: 'domcontentloaded' }),
  ]);

  await host.locator('input').first().fill('HostChecksumFive');
  await guest.locator('input').first().fill('GuestChecksumFive');
  await host.getByPlaceholder('Search maps...').fill('Scorched');
  await host.getByText('Scorched Basin').first().click();
  await host
    .locator('select')
    .filter({ has: host.locator('option[value="high"]') })
    .first()
    .selectOption('high');
  await host
    .locator('select')
    .filter({ has: host.locator('option[value="fastest"]') })
    .first()
    .selectOption('fastest');
  await toggleFogOff(host);
  await host.getByRole('button', { name: '+ Add Player' }).click();
  await host.getByRole('button', { name: '+ Add Player' }).click();
  const playerTypeSelects = host
    .locator('select')
    .filter({ has: host.locator('option[value="open"]') });
  await playerTypeSelects.nth(1).selectOption('open');

  const code = (
    (await host.locator('button[title="Click to copy"] .font-mono').textContent()) || ''
  ).trim();
  if (!/^[A-Z]{4}$/.test(code)) {
    throw new Error('Unexpected lobby code: ' + code);
  }

  await guest.getByRole('button', { name: 'Join Game' }).first().click();
  await guest.locator('input[placeholder="XXXX"]').fill(code);
  await guest.getByRole('button', { name: /^Join$/ }).click();
  await guest.getByText('Connected to Lobby').waitFor({ timeout: 30000 });
  await host.getByText('GuestChecksumFive').waitFor({ timeout: 30000 });
  await host.getByRole('button', { name: 'Start Game' }).click();

  return code;
}

async function run() {
  await fsp.mkdir(outDir, { recursive: true });
  console.log('OUTDIR ' + outDir);

  const hostLog = [];
  const guestLog = [];
  const securityErrors = [];
  const checkpoints = [];
  const actions = [];
  let failure = null;
  let browser;
  let hostContext;
  let guestContext;
  let host;
  let guest;

  try {
    browser = await chromium.launch({ headless: false, args: ['--window-size=1440,1000'] });
    hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    guestContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    host = await hostContext.newPage();
    guest = await guestContext.newPage();

    function hookLogging(page, name, sink) {
      page.on('console', (msg) => {
        const entry =
          '[' + new Date().toISOString() + '] console.' + msg.type() + ': ' + msg.text();
        sink.push(entry);
        if (entry.includes('[Game] SECURITY:')) {
          securityErrors.push({ name, entry });
        }
      });
      page.on('pageerror', (err) => {
        sink.push(
          '[' +
            new Date().toISOString() +
            '] pageerror: ' +
            (err.stack || err.message || String(err))
        );
      });
      page.on('requestfailed', (req) => {
        const details = req.failure();
        sink.push(
          '[' +
            new Date().toISOString() +
            '] requestfailed: ' +
            req.method() +
            ' ' +
            req.url() +
            ' :: ' +
            (details ? details.errorText : 'unknown')
        );
      });
    }

    hookLogging(host, 'host', hostLog);
    hookLogging(guest, 'guest', guestLog);

    const code = await configureLobby(host, guest);
    await Promise.all([
      host.waitForURL(/\/game(?:\?|$)/, { timeout: 30000 }),
      guest.waitForURL(/\/game(?:\?|$)/, { timeout: 30000 }),
    ]);
    await Promise.all([waitForRenderWarm(host), waitForRenderWarm(guest)]);

    const [hostStatus, guestStatus, hostChecksum, guestChecksum, hostInitial, guestInitial] =
      await Promise.all([
        getStatus(host),
        getStatus(guest),
        requestChecksum(host),
        requestChecksum(guest),
        captureSnapshot(host, 'host'),
        captureSnapshot(guest, 'guest'),
      ]);

    if (
      hostStatus.connectionStatus !== 'connected' ||
      guestStatus.connectionStatus !== 'connected'
    ) {
      throw new Error('Initial connection status not connected');
    }
    if (hostStatus.desyncState !== 'synced' || guestStatus.desyncState !== 'synced') {
      throw new Error('Initial desync state not synced');
    }
    if (hostStatus.localPlayerId !== 'player1' || guestStatus.localPlayerId !== 'player2') {
      throw new Error(
        'Unexpected local player IDs: ' + JSON.stringify({ hostStatus, guestStatus })
      );
    }
    if (hostStatus.fogOfWar !== false || guestStatus.fogOfWar !== false) {
      throw new Error('Fog of war was not disabled on both clients');
    }

    checkpoints.push({
      label: 'initial',
      hostStatus,
      guestStatus,
      hostChecksum,
      guestChecksum,
      hostTick: hostInitial.tick,
      guestTick: guestInitial.tick,
    });

    let lastHostSnapshot = hostInitial;
    let lastGuestSnapshot = guestInitial;

    await issueMove(host, { x: 980, y: 420 });
    actions.push({ who: 'host', action: 'move', atMs: 0 });
    const hostMove = await waitForPlayerAction(
      host,
      guest,
      'player1',
      lastHostSnapshot,
      lastGuestSnapshot,
      'host move'
    );
    lastHostSnapshot = hostMove.primarySnap;
    lastGuestSnapshot = hostMove.secondarySnap;
    checkpoints.push({
      label: 'host-move',
      hostUnit: hostMove.primaryUnit,
      guestUnit: hostMove.secondaryUnit,
    });

    await host.waitForTimeout(800);
    await issueHold(host);
    actions.push({ who: 'host', action: 'hold', atMs: 800 });
    const hostHold = await waitForPlayerAction(
      host,
      guest,
      'player1',
      lastHostSnapshot,
      lastGuestSnapshot,
      'host hold'
    );
    lastHostSnapshot = hostHold.primarySnap;
    lastGuestSnapshot = hostHold.secondarySnap;
    checkpoints.push({
      label: 'host-hold',
      hostUnit: hostHold.primaryUnit,
      guestUnit: hostHold.secondaryUnit,
    });

    await issueMove(guest, { x: 720, y: 520 });
    actions.push({ who: 'guest', action: 'move', atMs: 0 });
    const guestMove = await waitForPlayerAction(
      guest,
      host,
      'player2',
      lastGuestSnapshot,
      lastHostSnapshot,
      'guest move'
    );
    lastGuestSnapshot = guestMove.primarySnap;
    lastHostSnapshot = guestMove.secondarySnap;
    checkpoints.push({
      label: 'guest-move',
      guestUnit: guestMove.primaryUnit,
      hostUnit: guestMove.secondaryUnit,
    });

    await guest.waitForTimeout(800);
    await issueStop(guest);
    actions.push({ who: 'guest', action: 'stop', atMs: 800 });
    const guestStop = await waitForPlayerAction(
      guest,
      host,
      'player2',
      lastGuestSnapshot,
      lastHostSnapshot,
      'guest stop'
    );
    lastGuestSnapshot = guestStop.primarySnap;
    lastHostSnapshot = guestStop.secondarySnap;
    checkpoints.push({
      label: 'guest-stop',
      guestUnit: guestStop.primaryUnit,
      hostUnit: guestStop.secondaryUnit,
    });

    const start = Date.now();
    let nextHostMoveAt = 30000;
    let nextGuestMoveAt = 45000;
    let nextMinuteMark = 60000;
    let minuteCounter = 1;
    let hostMoveIndex = 0;
    let guestMoveIndex = 0;
    const hostMovePositions = [
      { x: 860, y: 340 },
      { x: 1080, y: 560 },
      { x: 760, y: 500 },
      { x: 980, y: 420 },
    ];
    const guestMovePositions = [
      { x: 620, y: 400 },
      { x: 820, y: 300 },
      { x: 900, y: 540 },
      { x: 720, y: 520 },
    ];

    while (Date.now() - start < testDurationMs) {
      const elapsed = Date.now() - start;

      if (elapsed >= nextHostMoveAt) {
        await issueMove(host, hostMovePositions[hostMoveIndex % hostMovePositions.length]);
        actions.push({ who: 'host', action: 'move', atMs: elapsed });
        const synced = await waitForPlayerAction(
          host,
          guest,
          'player1',
          lastHostSnapshot,
          lastGuestSnapshot,
          'host move loop'
        );
        lastHostSnapshot = synced.primarySnap;
        lastGuestSnapshot = synced.secondarySnap;
        hostMoveIndex += 1;
        nextHostMoveAt += 30000;
      }

      if (elapsed >= nextGuestMoveAt) {
        await issueMove(guest, guestMovePositions[guestMoveIndex % guestMovePositions.length]);
        actions.push({ who: 'guest', action: 'move', atMs: elapsed });
        const synced = await waitForPlayerAction(
          guest,
          host,
          'player2',
          lastGuestSnapshot,
          lastHostSnapshot,
          'guest move loop'
        );
        lastGuestSnapshot = synced.primarySnap;
        lastHostSnapshot = synced.secondarySnap;
        guestMoveIndex += 1;
        nextGuestMoveAt += 30000;
      }

      if (elapsed >= nextMinuteMark) {
        const [minuteHostStatus, minuteGuestStatus, minuteHostChecksum, minuteGuestChecksum] =
          await Promise.all([
            getStatus(host),
            getStatus(guest),
            requestChecksum(host),
            requestChecksum(guest),
          ]);
        if (
          minuteHostStatus.connectionStatus !== 'connected' ||
          minuteGuestStatus.connectionStatus !== 'connected'
        ) {
          throw new Error('Connection dropped during minute checkpoint ' + minuteCounter);
        }
        if (
          minuteHostStatus.desyncState !== 'synced' ||
          minuteGuestStatus.desyncState !== 'synced'
        ) {
          throw new Error(
            'Desync detected during minute checkpoint ' +
              minuteCounter +
              ': ' +
              JSON.stringify({ minuteHostStatus, minuteGuestStatus })
          );
        }
        checkpoints.push({
          label: 'minute-' + minuteCounter,
          hostStatus: minuteHostStatus,
          guestStatus: minuteGuestStatus,
          hostChecksum: minuteHostChecksum,
          guestChecksum: minuteGuestChecksum,
        });
        console.log(
          'minute ' +
            minuteCounter +
            ': hostTick=' +
            minuteHostChecksum.tick +
            ' guestTick=' +
            minuteGuestChecksum.tick +
            ' hostChecksum=' +
            minuteHostChecksum.checksum +
            ' guestChecksum=' +
            minuteGuestChecksum.checksum
        );
        minuteCounter += 1;
        nextMinuteMark += 60000;
      }

      await Promise.all([ensureHealthy(host, 'host'), ensureHealthy(guest, 'guest')]);
      await host.waitForTimeout(1000);
    }

    const [finalHostStatus, finalGuestStatus, finalHostChecksum, finalGuestChecksum] =
      await Promise.all([
        getStatus(host),
        getStatus(guest),
        requestChecksum(host),
        requestChecksum(guest),
      ]);
    if (finalHostStatus.desyncState !== 'synced' || finalGuestStatus.desyncState !== 'synced') {
      throw new Error('Final desync state not synced');
    }
    if (securityErrors.length > 0) {
      throw new Error('Security errors observed: ' + JSON.stringify(securityErrors.slice(0, 5)));
    }

    const result = {
      outDir,
      scenario: '2 humans + 2 ai, 5 minute checksum-backed multiplayer verification',
      code,
      realDurationMs: Date.now() - start,
      checkpoints,
      actions,
      finalHostStatus,
      finalGuestStatus,
      finalHostChecksum,
      finalGuestChecksum,
      securityErrors,
      hostUrl: host.url(),
      guestUrl: guest.url(),
      failure: null,
    };

    await fsp.writeFile(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    failure = error && error.stack ? error.stack : String(error);
    console.error(failure);
  } finally {
    try {
      await Promise.all([
        fsp.writeFile(path.join(outDir, 'host.log'), hostLog.join('\n')),
        fsp.writeFile(path.join(outDir, 'guest.log'), guestLog.join('\n')),
        fsp.writeFile(
          path.join(outDir, 'partial.json'),
          JSON.stringify({ outDir, checkpoints, actions, securityErrors, failure }, null, 2)
        ),
      ]);
      if (host && guest) {
        await Promise.allSettled([
          host.screenshot({ path: path.join(outDir, 'host-final.png'), fullPage: true }),
          guest.screenshot({ path: path.join(outDir, 'guest-final.png'), fullPage: true }),
          fsp.writeFile(path.join(outDir, 'host-final.txt'), await bodyText(host)),
          fsp.writeFile(path.join(outDir, 'guest-final.txt'), await bodyText(guest)),
        ]);
      }
    } catch (artifactError) {
      console.error(
        'artifact capture failed: ' +
          (artifactError && artifactError.stack ? artifactError.stack : String(artifactError))
      );
    }

    await Promise.allSettled([hostContext?.close(), guestContext?.close(), browser?.close()]);

    if (failure) {
      process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
