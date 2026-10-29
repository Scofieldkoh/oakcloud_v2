function normalizeUploadUrl(url: string | URL): string {
  return typeof url === 'string' ? url : url.toString();
}

function headersFromXhr(rawHeaders: string): Headers {
  const headers = new Headers();

  for (const line of rawHeaders.trim().split(/[\r\n]+/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      headers.append(key, value);
    }
  }

  return headers;
}

function uploadViaXhr(url: string | URL, formData: FormData): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', normalizeUploadUrl(url), true);
    xhr.withCredentials = true;
    xhr.responseType = 'text';

    xhr.onload = () => {
      resolve(
        new Response(xhr.responseText ?? '', {
          status: xhr.status || 200,
          statusText: xhr.statusText,
          headers: headersFromXhr(xhr.getAllResponseHeaders()),
        })
      );
    };

    xhr.onerror = () => {
      reject(new Error('Browser upload transport failed.'));
    };

    xhr.onabort = () => {
      reject(new Error('Browser upload was aborted.'));
    };

    xhr.send(formData);
  });
}

/**
 * Some browser+tunnel combinations intermittently fail `fetch(FormData)` uploads
 * before the request reaches the app server. Retry with XHR in that case.
 */
export async function postFormDataWithFallback(
  url: string | URL,
  formData: FormData
): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (typeof window === 'undefined') {
      throw error;
    }

    console.warn(
      `[upload] fetch failed for ${normalizeUploadUrl(url)}, retrying with XMLHttpRequest`,
      error
    );

    return uploadViaXhr(url, formData);
  }
}
