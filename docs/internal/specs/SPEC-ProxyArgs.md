# SPEC: Proxy Argument Builder & Redaction Contracts

Status: Draft

This spec defines the TypeScript interfaces and behavior for composing Supergateway argv and for log-safe redaction utilities used by Alph.

## Types

```ts
export type ProxyTransport = 'http' | 'sse';

export interface ProxyHeader {
  key: string;
  value: string;
}

export interface ProxyOpts {
  remoteUrl: string;              // Required absolute URL
  transport: ProxyTransport;      // 'http' => --streamableHttp, 'sse' => --sse
  bearer?: string;                // Optional token => --oauth2Bearer <TOKEN>
  headers?: ProxyHeader[];        // Repeated --header "K: V" (order preserved)
  version?: string;               // Optional version pin (surfaced by higher layer)
}
```

## Functions

```ts
/**
 * Build argv for Supergateway. Returns argv only; caller chooses command
 * (e.g., command = 'npx' with args prefixed by ['-y','supergateway'], or Docker).
 *
 * No secrets are redacted inside the returned argv — it is meant for execution.
 */
export function buildSupergatewayArgs(opts: ProxyOpts): string[];

/**
 * Redact secrets for logs and previews. Accepts strings, argv arrays, or
 * objects containing values. Replaces bearer tokens and header values for
 * sensitive headers (Authorization, X-Api-Key, X-Auth-Token, etc.) with
 * fixed placeholders.
 */
export function redactForLogs<T extends string | string[] | Record<string, unknown>>(x: T): T;
```

## Mapping Rules

- Transport:
  - `http` ⇒ `--streamableHttp <URL>`
  - `sse`  ⇒ `--sse <URL>`
- Authentication:
  - If `bearer` provided, append `--oauth2Bearer <TOKEN>` (preferred over manual header).
- Headers:
  - Each additional header maps to a repeated `--header "K: V"` pair.
  - Preserve insertion order to keep behavior predictable.
- OS-Agnostic argv:
  - Never pre-quote or escape; return clean argv segments. The caller should pass argv arrays to spawn APIs (no shell wrapping).

## Error Handling

- `remoteUrl` must be a valid absolute URL; throw on invalid input.
- `transport` must be `http` or `sse`; throw on invalid value.
- `headers` with empty keys are ignored; values may be empty but are redacted in logs.

## Redaction Semantics

- Bearer tokens: replace with `<redacted:bearer>` when rendering to logs.
- Authorization header values: replace with `<redacted:authorization>`.
- Known sensitive header keys (case-insensitive): `authorization`, `x-api-key`, `x-auth-token`, `x-access-token`, `proxy-authorization` → value becomes `<redacted:${key}>`.
- Non-sensitive headers are preserved.
- Redaction never mutates execution argv returned by `buildSupergatewayArgs`.

## Examples

```ts
buildSupergatewayArgs({
  remoteUrl: 'https://mcp.example.com/mcp',
  transport: 'http',
  bearer: 'TEST_TOKEN_123',
  headers: [ { key: 'X-Org', value: 'demo' } ]
});
// => ["--streamableHttp","https://mcp.example.com/mcp","--oauth2Bearer","TEST_TOKEN_123","--header","X-Org: demo"]

redactForLogs(["--oauth2Bearer","TEST_TOKEN_123"])
// => ["--oauth2Bearer","<redacted:bearer>"]

redactForLogs("Authorization: Bearer TEST_TOKEN_123")
// => "Authorization: <redacted:authorization>"
```

## Notes

- Higher layers decide command selection (e.g., `npx -y supergateway` vs Docker) and timeouts.
- Streamable HTTP is the default transport per MCP guidance; SSE remains supported for compatibility.
