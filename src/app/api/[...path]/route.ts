import { NextRequest, NextResponse } from 'next/server';
import { handle } from '../../../auth/handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function route(request: NextRequest) {
  try { return await handle(request); }
  catch { return NextResponse.json({ error: 'Authentication is temporarily unavailable. Please retry.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export { route as GET, route as POST };
