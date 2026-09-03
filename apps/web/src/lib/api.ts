const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export const apiUrl = API_URL;

export function websocketUrl(): string {
  const url = new URL("/ws", API_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function createRoom(): Promise<string> {
  const response = await fetch(`${API_URL}/rooms`, { method: "POST" });
  if (!response.ok) throw new Error("Nao foi possivel criar a sala");
  const body = (await response.json()) as { code: string };
  return body.code;
}

export async function roomExists(code: string): Promise<boolean> {
  const response = await fetch(`${API_URL}/rooms/${code}`);
  return response.ok;
}
