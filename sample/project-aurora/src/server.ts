export function createServer() {
  return { listen(port: string | number, ready: () => void) { void port; ready(); } };
}
