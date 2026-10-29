import { lookup } from 'node:dns/promises';
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_GET_BYTES = 64 * 1024;

export type RawUrlCheckResult = {
  status: number | null;
  finalUrl: string;
  errorCode: string | null;
  errorMessage: string | null;
};

export type UrlCheckerDependencies = {
  resolve: typeof lookup;
  request: typeof httpRequest;
  secureRequest: typeof httpsRequest;
};

type RequestResult = {
  status: number;
  location: string | null;
};

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6');
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  if (family === 6) return !blockedAddresses.check(address, 'ipv6');
  return false;
}

function errorResult(url: string, code: string, message: string): RawUrlCheckResult {
  return {
    status: null,
    finalUrl: url,
    errorCode: code,
    errorMessage: message.slice(0, 500),
  };
}

function errorDetails(error: unknown, fallbackCode: string) {
  const candidate = error as NodeJS.ErrnoException;
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function hostnameWithoutBrackets(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

async function resolvePublicAddress(url: URL, resolve: typeof lookup) {
  const hostname = hostnameWithoutBrackets(url.hostname);
  const answers = await resolve(hostname, { all: true, verbatim: true });
  if (answers.length === 0) {
    const error = new Error('Hostname did not resolve') as NodeJS.ErrnoException;
    error.code = 'ENOTFOUND';
    throw error;
  }
  if (answers.some((answer) => !isPublicIpAddress(answer.address))) {
    const error = new Error('Hostname resolved to a non-public address') as NodeJS.ErrnoException;
    error.code = 'NON_PUBLIC_ADDRESS';
    throw error;
  }
  return answers[0];
}

function requestOnce(
  url: URL,
  method: 'HEAD' | 'GET',
  address: { address: string; family: number },
  request: typeof httpRequest,
): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: RequestResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const originalHostname = hostnameWithoutBrackets(url.hostname);
    const options: RequestOptions & { servername: string } = {
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: { Host: url.host },
      servername: originalHostname,
      agent: false,
    };

    let clientRequest: ClientRequest;
    try {
      clientRequest = request(options, (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === 'string' ? response.headers.location : null;
        if (method === 'HEAD') {
          response.resume();
          finish({ status, location });
          return;
        }

        let bytesRead = 0;
        response.on('data', (chunk: Buffer | string) => {
          bytesRead += Buffer.byteLength(chunk);
          if (bytesRead > MAX_GET_BYTES) {
            response.destroy();
            finish({ status, location });
          }
        });
        response.once('end', () => finish({ status, location }));
        response.once('error', fail);
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    clientRequest.once('error', fail);
    clientRequest.setTimeout(REQUEST_TIMEOUT_MS, () => {
      const error = new Error('URL check timed out') as NodeJS.ErrnoException;
      error.code = 'ETIMEDOUT';
      clientRequest.destroy(error);
    });
    clientRequest.end();
  });
}

export async function checkPublicHttpUrl(
  input: string,
  dependencyOverrides: Partial<UrlCheckerDependencies> = {},
): Promise<RawUrlCheckResult> {
  let initialUrl: URL;
  try {
    initialUrl = new URL(input);
  } catch {
    return errorResult(input, 'INVALID_URL', 'URL is malformed');
  }

  if (initialUrl.protocol !== 'http:' && initialUrl.protocol !== 'https:') {
    return errorResult(initialUrl.toString(), 'UNSUPPORTED_PROTOCOL', 'Only HTTP and HTTPS URLs can be checked');
  }
  if (initialUrl.username || initialUrl.password) {
    return errorResult(initialUrl.toString(), 'URL_CREDENTIALS_NOT_ALLOWED', 'URLs containing credentials cannot be checked');
  }

  const dependencies: UrlCheckerDependencies = {
    resolve: dependencyOverrides.resolve ?? lookup,
    request: dependencyOverrides.request ?? httpRequest,
    secureRequest: dependencyOverrides.secureRequest ?? httpsRequest,
  };

  async function checkAt(url: URL, redirectCount: number, method: 'HEAD' | 'GET'): Promise<RawUrlCheckResult> {
    let address: { address: string; family: number };
    try {
      address = await resolvePublicAddress(url, dependencies.resolve);
    } catch (error) {
      const details = errorDetails(error, 'DNS_ERROR');
      return errorResult(url.toString(), details.code, details.message);
    }

    let response: RequestResult;
    try {
      const request = url.protocol === 'https:' ? dependencies.secureRequest : dependencies.request;
      response = await requestOnce(url, method, address, request);
    } catch (error) {
      const details = errorDetails(error, 'REQUEST_ERROR');
      return errorResult(url.toString(), details.code, details.message);
    }

    if (response.status >= 300 && response.status < 400) {
      if (!response.location) {
        return errorResult(url.toString(), 'MISSING_REDIRECT_LOCATION', 'Redirect response did not include a location');
      }
      if (redirectCount >= MAX_REDIRECTS) {
        return errorResult(url.toString(), 'TOO_MANY_REDIRECTS', `URL exceeded ${MAX_REDIRECTS} redirects`);
      }
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(response.location, url);
      } catch {
        return errorResult(url.toString(), 'INVALID_REDIRECT', 'Redirect location is malformed');
      }
      if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
        return errorResult(redirectUrl.toString(), 'UNSUPPORTED_PROTOCOL', 'Redirect used a non-HTTP protocol');
      }
      if (redirectUrl.username || redirectUrl.password) {
        return errorResult(redirectUrl.toString(), 'URL_CREDENTIALS_NOT_ALLOWED', 'Redirect URLs containing credentials cannot be checked');
      }
      return checkAt(redirectUrl, redirectCount + 1, method);
    }

    if (method === 'HEAD' && (response.status === 405 || response.status === 501)) {
      return checkAt(url, redirectCount, 'GET');
    }

    return {
      status: response.status,
      finalUrl: url.toString(),
      errorCode: null,
      errorMessage: null,
    };
  }

  return checkAt(initialUrl, 0, 'HEAD');
}
