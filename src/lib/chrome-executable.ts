import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

export const DEFAULT_CHROME_EXECUTABLE_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
] as const;

export async function findChromePath(): Promise<string> {
  const configuredPath = process.env.CHROME_PATH?.trim();
  const candidates = Array.from(
    new Set(
      [configuredPath, ...DEFAULT_CHROME_EXECUTABLE_PATHS].filter(
        (candidate): candidate is string => Boolean(candidate),
      ),
    ),
  );

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next candidate.
    }
  }

  throw new Error(
    `Chrome/Chromium executable not found. Checked: ${candidates.join(', ')}`,
  );
}
