type Handler = (payload: any) => void;
export function setupCollaboration(server: unknown) {
  void server;
  return { on(event: string, handler: Handler) { void event; void handler; } };
}
