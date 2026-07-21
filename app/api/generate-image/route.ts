import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { request as nodeHttpsRequest } from 'node:https';

// ── OpenAI via node:https (bypasses Next.js patched fetch / AbortSignal) ──────
function openaiPost(apiKey: string, path: string, bodyObj: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const req = nodeHttpsRequest(
      {
        hostname: 'api.openai.com',
        path,
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          Authorization:    `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 200) >= 400) {
            try {
              const parsed = JSON.parse(text) as { error?: { message?: string } };
              reject(Object.assign(
                new Error(parsed.error?.message ?? `OpenAI error ${res.statusCode}`),
                { status: res.statusCode },
              ));
            } catch {
              reject(Object.assign(new Error(`OpenAI error ${res.statusCode}`), { status: res.statusCode }));
            }
            return;
          }
          try { resolve(JSON.parse(text)); }
          catch { reject(new Error('OpenAI returned invalid JSON')); }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(bodyStr);
  });
}

// ── Supabase Storage upload via node:https ────────────────────────────────────
// The Supabase JS client uses globalThis.fetch which Next.js patches and binds
// to the incoming request's AbortSignal. After ~30 s (image generation time)
// the signal fires and every subsequent fetch throws "fetch failed".
// Using node:https directly bypasses the signal entirely.
function supabaseStorageUpload(
  sbUrl: string,
  serviceKey: string,
  bucket: string,
  storagePath: string,
  imageBytes: Buffer,
): Promise<{ error: string | null }> {
  // Supabase Storage: POST creates a new object, PUT replaces an existing one.
  // Try POST first; if the server returns 409 "The resource already exists",
  // retry with PUT so regeneration always overwrites the stale file.
  function attempt(method: 'POST' | 'PUT'): Promise<{ error: string | null }> {
    return new Promise((resolve) => {
      const parsed = new URL(`${sbUrl}/storage/v1/object/${bucket}/${storagePath}`);
      const req = nodeHttpsRequest(
        {
          hostname:   parsed.hostname,
          port:       443,
          servername: parsed.hostname,
          path:       parsed.pathname,
          method,
          headers: {
            'Content-Type':   'image/png',
            'Content-Length': String(imageBytes.length),
            apikey:           serviceKey,
            Authorization:    `Bearer ${serviceKey}`,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) {
              resolve({ error: null });
            } else {
              const text = Buffer.concat(chunks).toString('utf8');
              let msg = `Storage upload HTTP ${status}`;
              try { msg = (JSON.parse(text) as { message?: string; error?: string }).message ?? (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* noop */ }
              resolve({ error: msg });
            }
          });
          res.on('error', (e) => resolve({ error: e.message }));
        },
      );
      req.on('error', (e) => resolve({ error: e.message }));
      req.write(imageBytes);
      req.end();
    });
  }

  return attempt('POST').then(async result => {
    // 409 = already exists → retry with PUT to overwrite
    if (result.error?.includes('already exists')) return attempt('PUT');
    return result;
  });
}

// ── Supabase REST upsert via node:https ───────────────────────────────────────
function supabaseUpsert(
  sbUrl: string,
  serviceKey: string,
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
): Promise<{ error: string | null }> {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(row);
    const parsed = new URL(`${sbUrl}/rest/v1/${table}`);
    const req = nodeHttpsRequest(
      {
        hostname: parsed.hostname,
        path:     `${parsed.pathname}?on_conflict=${onConflict}`,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          apikey:           serviceKey,
          Authorization:    `Bearer ${serviceKey}`,
          Prefer:           'resolution=merge-duplicates,return=minimal',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({ error: null });
          } else {
            const text = Buffer.concat(chunks).toString('utf8');
            let msg = `Supabase ${status}`;
            try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* noop */ }
            resolve({ error: msg });
          }
        });
        res.on('error', (e) => resolve({ error: e.message }));
      },
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.end(bodyStr);
  });
}

// ── Supabase REST select + update (courses.modules patch) ─────────────────────
function supabaseGetModules(
  sbUrl: string,
  serviceKey: string,
  courseId: string,
): Promise<{ modules: unknown[] | null; error: string | null }> {
  return new Promise((resolve) => {
    const parsed = new URL(`${sbUrl}/rest/v1/courses`);
    const req = nodeHttpsRequest(
      {
        hostname: parsed.hostname,
        path:     `${parsed.pathname}?id=eq.${encodeURIComponent(courseId)}&select=modules&limit=1`,
        method:   'GET',
        headers: {
          apikey:        serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept:        'application/json',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            const rows = JSON.parse(text) as Array<{ modules?: unknown[] }>;
            resolve({ modules: rows[0]?.modules ?? null, error: null });
          } catch {
            resolve({ modules: null, error: 'Failed to parse course row' });
          }
        });
        res.on('error', (e) => resolve({ modules: null, error: e.message }));
      },
    );
    req.on('error', (e) => resolve({ modules: null, error: e.message }));
    req.end();
  });
}

function supabasePatchModules(
  sbUrl: string,
  serviceKey: string,
  courseId: string,
  modules: unknown[],
): Promise<{ error: string | null }> {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify({ modules, updated_at: new Date().toISOString() });
    const parsed = new URL(`${sbUrl}/rest/v1/courses`);
    const req = nodeHttpsRequest(
      {
        hostname: parsed.hostname,
        path:     `${parsed.pathname}?id=eq.${encodeURIComponent(courseId)}`,
        method:   'PATCH',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          apikey:           serviceKey,
          Authorization:    `Bearer ${serviceKey}`,
          Prefer:           'return=minimal',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({ error: null });
          } else {
            const text = Buffer.concat(chunks).toString('utf8');
            let msg = `Supabase PATCH ${status}`;
            try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* noop */ }
            resolve({ error: msg });
          }
        });
        res.on('error', (e) => resolve({ error: e.message }));
      },
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.end(bodyStr);
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { title: string; context: string; courseId?: string; cardIndex?: number };
    const { title, context, courseId, cardIndex } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.startsWith('sk-')) {
      return NextResponse.json({ error: 'Service is not configured. Contact the administrator.' }, { status: 503 });
    }

    if (!title) {
      return NextResponse.json({ error: 'title is required.' }, { status: 400 });
    }

    const prompt = `Create a highly specific, detailed educational illustration that visually explains: "${title}".${context ? ` The concept is: ${context.slice(0, 400)}` : ''} The image must directly and unmistakably depict this exact concept — not a generic placeholder. Show the actual subject matter: relevant objects, diagrams, processes, or scenes that a student would immediately recognise as illustrating "${title}". No text, labels, or words anywhere in the image. Vivid colours, professional educational illustration quality.`;

    const data = await openaiPost(apiKey, '/v1/images/generations', {
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'low',
    }) as { data: Array<{ b64_json?: string; url?: string }> };

    const item = data.data[0];
    if (!item) return NextResponse.json({ error: 'No image returned.' }, { status: 500 });

    // ── Get raw PNG bytes ──────────────────────────────────────────────────────
    let imageBytes: Buffer | null = null;

    if (item.b64_json) {
      imageBytes = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      try {
        const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(20000) });
        if (imgRes.ok) imageBytes = Buffer.from(await imgRes.arrayBuffer());
      } catch { /* fall through */ }
    }

    if (!imageBytes) return NextResponse.json({ error: 'No image data in response.' }, { status: 500 });

    // ── Upload to Storage + patch course.modules — all via node:https ─────────
    // Using node:https bypasses Next.js's patched globalThis.fetch (which binds
    // the incoming request's AbortSignal). After ~30 s of image generation the
    // signal fires, causing the Supabase JS client to throw "fetch failed".
    if (courseId && cardIndex !== undefined) {
      const sbUrl        = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const storagePath  = `${courseId}/${cardIndex}.png`;

      const { error: upErr } = await supabaseStorageUpload(sbUrl, serviceKey, 'images', storagePath, imageBytes);
      if (upErr) {
        console.error('[generate-image] storage upload failed:', upErr);
        return NextResponse.json({ error: `Storage upload failed: ${upErr}` }, { status: 500 });
      }

      const publicUrl = `${sbUrl}/storage/v1/object/public/images/${storagePath}`;

      // Record in images metadata table
      await supabaseUpsert(sbUrl, serviceKey, 'images', {
        course_id:    courseId,
        card_index:   cardIndex,
        storage_path: storagePath,
        url:          publicUrl,
      }, 'course_id,card_index');

      // Patch imageUrl into courses.modules JSONB
      const { modules, error: fetchErr } = await supabaseGetModules(sbUrl, serviceKey, courseId);
      if (!fetchErr && modules) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updated: any[] = [...modules];
        updated[cardIndex] = { ...(updated[cardIndex] ?? {}), imageUrl: publicUrl };
        await supabasePatchModules(sbUrl, serviceKey, courseId, updated);
      }

      return NextResponse.json({ publicUrl });
    }

    // ── Fallback: return base64 dataUrl (no courseId supplied, e.g. editor) ───
    return NextResponse.json({ dataUrl: `data:image/png;base64,${imageBytes.toString('base64')}` });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Image generation failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
