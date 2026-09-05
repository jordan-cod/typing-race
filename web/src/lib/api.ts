/**
 * The site and the API are the same Go binary on the same origin, so every URL here is
 * relative. Nothing about the deployment is baked into the bundle: the page talks to wherever
 * it was served from, which is also what makes a preview or a tunnel work without a rebuild.
 */

export function websocketUrl(): string {
  const url = new URL("/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function createRoom(): Promise<string> {
  const response = await fetch("/api/rooms", { method: "POST" });
  if (!response.ok) throw new Error("Nao foi possivel criar a sala");
  const body = (await response.json()) as { code: string };
  return body.code;
}

export async function roomExists(code: string): Promise<boolean> {
  const response = await fetch(`/api/rooms/${code}`);
  return response.ok;
}
