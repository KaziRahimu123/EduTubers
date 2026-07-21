/**
 * app/api/quota/route.ts
 *
 * Returns how many Standard generations the current user has used
 * in the rolling 3-day window.  Uses node:https directly (same as
 * /api/generate) to bypass Next.js's patched globalThis.fetch and
 * avoid the Content-Length / AbortSignal issues that cause the
 * Supabase JS client to silently return errors.
 */

import { NextResponse } from 'next/server';
import { request as nodeHttpsRequest } from 'node:https';
import { getAuth0User } from '@/lib/auth0-session';

export const dynamic = 'force-dynamic';

function supabaseRpc(
  sbUrl: string,
  serviceKey: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null }> {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(args);
    const parsed = new URL(`${sbUrl}/rest/v1/rpc/${fn}`);
    const req = nodeHttpsRequest(
      {
        hostname:   parsed.hostname,
        port:       443,
        servername: parsed.hostname,
        path:       parsed.pathname,
        method:     'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': String(Buffer.byteLength(bodyStr)),
          apikey:           serviceKey,
          Authorization:    `Bearer ${serviceKey}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            try { resolve({ data: JSON.parse(text), error: null }); }
            catch { resolve({ data: null, error: null }); }
          } else {
            let msg = `Supabase RPC ${status}`;
            try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* noop */ }
            resolve({ data: null, error: msg });
          }
        });
        res.on('error', (e) => resolve({ data: null, error: e.message }));
      },
    );
    req.on('error', (e) => resolve({ data: null, error: e.message }));
    req.end(bodyStr);
  });
}

export async function GET() {
  const user = await getAuth0User();
  if (!user) return NextResponse.json({ used: 0 });

  const sbUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const { data, error } = await supabaseRpc(sbUrl, serviceKey, 'count_gen_quota_3days', { p_user_id: user.id });
  if (error) {
    console.error('[quota] count_gen_quota_3days', error);
    return NextResponse.json({ used: 0 });
  }
  return NextResponse.json({ used: (data as number | null) ?? 0 });
}
