import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: 'up', dryRun: process.env.DRY_RUN !== 'false' });
  } catch (err) {
    return NextResponse.json({ ok: false, db: 'down', error: String(err) }, { status: 500 });
  }
}
