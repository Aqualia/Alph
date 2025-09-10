export type ProxyTransport = 'http' | 'sse';

export interface ProxyHeader {
  key: string;
  value: string;
}

export interface ProxyOpts {
  remoteUrl: string;
  transport: ProxyTransport;
  bearer?: string | undefined;
  headers?: ProxyHeader[] | undefined;
  version?: string | undefined; // surfaced elsewhere; not used for argv composition here
}

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'proxy-authorization',
];

/**
 * Build argv for Supergateway. Returns argv only; caller chooses command
 * (e.g., command = 'npx' with args prefixed by ['-y','supergateway']).
 *
 * Rules:
 * - transport=http => --streamableHttp <URL>
 * - transport=sse  => --sse <URL>
 * - bearer => --oauth2Bearer <TOKEN>
 * - headers => repeated --header "K: V" (order preserved)
 */
export function buildSupergatewayArgs(opts: ProxyOpts): string[] {
  if (!opts || typeof opts !== 'object') throw new Error('opts is required');
  const { remoteUrl, transport, bearer, headers } = opts;

  // Validate transport
  if (transport !== 'http' && transport !== 'sse') {
    throw new Error(`Unsupported transport: ${String(transport)}`);
  }

  // Validate URL
  try {
    const u = new URL(remoteUrl);
    if (!u.protocol.startsWith('http')) {
      throw new Error('URL must be http(s)');
    }
  } catch {
    throw new Error(`Invalid remoteUrl: ${remoteUrl}`);
  }

  const argv: string[] = [];
  if (transport === 'http') {
    argv.push('--streamableHttp', remoteUrl);
  } else {
    argv.push('--sse', remoteUrl);
  }

  if (bearer && bearer.length > 0) {
    argv.push('--oauth2Bearer', bearer);
  }

  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (!h || typeof h.key !== 'string' || h.key.trim() === '') continue; // ignore empty keys
      const key = h.key.trim();
      const value = (h.value ?? '').toString();
      argv.push('--header', `${key}: ${value}`);
    }
  }

  return argv;
}

/**
 * Redact secrets for logs and previews. Accepts strings, argv arrays, or objects.
 * Replaces bearer tokens and sensitive header values with fixed placeholders.
 */
export function redactForLogs<T extends string | string[] | Record<string, unknown>>(x: T): T {
  const redactString = (s: string): string => {
    let out = s;
    // --oauth2Bearer TOKEN
    out = out.replace(/(--oauth2Bearer\s+)([^\s"']+)/gi, '$1<redacted:bearer>');
    // Authorization: ... (header form)
    out = out.replace(/(Authorization\s*:\s*)(.+?)(?=$|\r|\n)/gi, '$1<redacted:authorization>');
    // Known sensitive headers (generic form inside strings like "X-Api-Key: value")
    for (const k of SENSITIVE_HEADER_KEYS) {
      const re = new RegExp(`(${k.replace(/[-]/g, '\\-')}\\s*:\\s*)(.+?)(?=$|\\r|\\n)`, 'gi');
      out = out.replace(re, (_m, p1) => `${p1}<redacted:${k}>`);
    }
    return out;
  };

  if (typeof x === 'string') {
    return redactString(x) as T;
  }
  if (Array.isArray(x)) {
    const out: any[] = [];
    for (let i = 0; i < x.length; i++) {
      const part = x[i];
      if (typeof part === 'string' && part.toLowerCase() === '--oauth2bearer') {
        out.push(part);
        // Replace following token if present
        if (i + 1 < x.length && typeof x[i + 1] === 'string') {
          out.push('<redacted:bearer>');
          i += 1; // skip consumed token
          continue;
        }
      }
      out.push(typeof part === 'string' ? redactString(part) : part);
    }
    return out as T;
  }
  if (x && typeof x === 'object') {
    const clone: Record<string, unknown> = Array.isArray(x) ? [...(x as any)] : { ...(x as any) };
    const walk = (obj: any) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
          walk(v);
          continue;
        }
        if (typeof v === 'string') {
          const keyLower = k.toLowerCase();
          // Authorization header: preserve scheme if present
          if (keyLower === 'authorization') {
            if (/^Bearer\s+\S+$/i.test(v)) {
              obj[k] = 'Bearer <redacted:authorization>';
            } else {
              obj[k] = '<redacted:authorization>';
            }
          } else if (SENSITIVE_HEADER_KEYS.includes(keyLower)) {
            obj[k] = `<redacted:${keyLower}>`;
          } else if (/^Bearer\s+\S+$/i.test(v)) {
            obj[k] = 'Bearer <redacted:authorization>';
          } else {
            obj[k] = redactString(v);
          }
        }
      }
    };
    walk(clone);
    return clone as T;
  }
  return x;
}
