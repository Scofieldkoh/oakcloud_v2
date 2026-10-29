const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function flag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

export function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function uuidOption(argv: readonly string[], name: string): string {
  const value = option(argv, name);
  if (!value || !UUID.test(value)) throw new Error(`--${name} must be a valid UUID`);
  return value;
}
