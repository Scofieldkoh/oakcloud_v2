/** Public display alias only; never changes stored company names or signing evidence. */
export function esigningDisplayName(name: string): string {
  return /^oakcloud$/i.test(name.trim()) ? 'Oaktree' : name;
}
