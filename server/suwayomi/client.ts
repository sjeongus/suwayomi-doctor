import type { Config } from '../config.js';

export class SuwayomiUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SuwayomiUnreachableError';
  }
}

export interface GraphQLResult<T> {
  data: T | null;
  errors: { message: string }[];
}

/**
 * Minimal GraphQL client for Suwayomi-Server (POST /api/graphql).
 * Handles the four AUTH_MODE settings described in docs/RESEARCH.md.
 */
export class SuwayomiClient {
  private sessionCookie: string | null = null;
  private accessToken: string | null = null;

  constructor(private readonly config: Pick<Config, 'suwayomiUrl' | 'authMode' | 'username' | 'password'>) {}

  get baseUrl(): string {
    return this.config.suwayomiUrl;
  }

  /** Runs a query. GraphQL `errors` are returned alongside `data`, not thrown. */
  async request<T>(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal): Promise<GraphQLResult<T>> {
    const res = await this.send('/api/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    });
    const text = await res.text();
    let body: { data?: T | null; errors?: { message?: string }[] };
    try {
      body = JSON.parse(text);
    } catch {
      throw new SuwayomiUnreachableError(`Suwayomi answered HTTP ${res.status} with non-JSON: ${text.slice(0, 200)}`);
    }
    const errors = (body.errors ?? []).map((e) => ({ message: e.message ?? 'Unknown GraphQL error' }));
    if (errors.some((e) => /unauthorized|not authenticated|permission/i.test(e.message)) && body.data == null) {
      throw new SuwayomiUnreachableError(`Suwayomi rejected Doctor's credentials: ${errors[0]?.message}`);
    }
    return { data: body.data ?? null, errors };
  }

  /** Like request(), but throws when there is no data. */
  async query<T>(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const result = await this.request<T>(query, variables, signal);
    if (!result.data) {
      throw new Error(result.errors.map((e) => e.message).join('; ') || 'Suwayomi returned no data');
    }
    return result.data;
  }

  /** Fetches a Suwayomi path (e.g. a thumbnail) with Doctor's credentials. */
  async fetchPath(path: string, signal?: AbortSignal): Promise<Response> {
    return this.send(path, { method: 'GET', signal });
  }

  private async send(path: string, init: RequestInit, retried = false): Promise<Response> {
    await this.ensureLoggedIn();
    const headers = new Headers(init.headers);
    this.applyAuth(headers);
    let res: Response;
    try {
      res = await fetch(this.config.suwayomiUrl + path, { ...init, headers, redirect: 'manual' });
    } catch (err) {
      if ((err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError') throw err;
      throw new SuwayomiUnreachableError(`Cannot reach Suwayomi at ${this.config.suwayomiUrl}: ${(err as Error).message}`, { cause: err });
    }
    if (res.status === 401 || (res.status >= 300 && res.status < 400 && this.config.authMode === 'simple_login')) {
      if (!retried && (this.config.authMode === 'simple_login' || this.config.authMode === 'ui_login')) {
        this.sessionCookie = null;
        this.accessToken = null;
        return this.send(path, init, true);
      }
      throw new SuwayomiUnreachableError(`Suwayomi answered HTTP ${res.status}. Check SUWAYOMI_AUTH_MODE and the credentials.`);
    }
    return res;
  }

  private applyAuth(headers: Headers): void {
    const { authMode, username, password } = this.config;
    if (authMode === 'basic_auth') {
      headers.set('authorization', 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'));
    } else if (authMode === 'simple_login' && this.sessionCookie) {
      headers.set('cookie', this.sessionCookie);
    } else if (authMode === 'ui_login' && this.accessToken) {
      headers.set('authorization', `Bearer ${this.accessToken}`);
    }
  }

  private async ensureLoggedIn(): Promise<void> {
    const { authMode, username, password, suwayomiUrl } = this.config;
    if (authMode === 'simple_login' && !this.sessionCookie) {
      // JavalinSetup.kt: POST /login.html with form fields "user" and "pass" sets the session cookie.
      const res = await fetch(`${suwayomiUrl}/login.html`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ user: username, pass: password }),
        redirect: 'manual',
      }).catch((err: Error) => {
        throw new SuwayomiUnreachableError(`Cannot reach Suwayomi to log in: ${err.message}`, { cause: err });
      });
      const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      if (!cookie) throw new SuwayomiUnreachableError('Suwayomi simple_login did not return a session cookie. Check the credentials.');
      this.sessionCookie = cookie;
    }
    if (authMode === 'ui_login' && !this.accessToken) {
      const res = await fetch(`${suwayomiUrl}/api/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'mutation Login($u: String!, $p: String!) { login(input: { username: $u, password: $p }) { accessToken } }',
          variables: { u: username, p: password },
        }),
      }).catch((err: Error) => {
        throw new SuwayomiUnreachableError(`Cannot reach Suwayomi to log in: ${err.message}`, { cause: err });
      });
      const body = (await res.json()) as { data?: { login?: { accessToken?: string } }; errors?: { message: string }[] };
      const token = body.data?.login?.accessToken;
      if (!token) throw new SuwayomiUnreachableError(`Suwayomi ui_login failed: ${body.errors?.[0]?.message ?? 'no token'}`);
      this.accessToken = token;
    }
  }
}
