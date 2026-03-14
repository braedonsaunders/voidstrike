import { NextRequest, NextResponse } from 'next/server';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { PathTelemetryEvent } from '@/engine/debug/pathTelemetry';

export const runtime = 'nodejs';

interface PathTelemetryPayload {
  sessionId?: string;
  href?: string;
  events?: PathTelemetryEvent[];
}

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'live-pathfinding.jsonl');

export async function POST(request: NextRequest): Promise<NextResponse> {
  let payload: PathTelemetryPayload;

  try {
    payload = (await request.json()) as PathTelemetryPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) {
    return NextResponse.json({ ok: true, written: 0 });
  }

  const receivedAt = new Date().toISOString();
  const lines = events
    .map((event) =>
      JSON.stringify({
        receivedAt,
        sessionId: payload.sessionId ?? null,
        href: payload.href ?? null,
        ...event,
      })
    )
    .join('\n');

  await mkdir(OUTPUT_DIR, { recursive: true });
  await appendFile(OUTPUT_FILE, `${lines}\n`, 'utf8');

  return NextResponse.json({ ok: true, written: events.length, file: OUTPUT_FILE });
}
