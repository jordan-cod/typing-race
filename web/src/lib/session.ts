const KEY = "typing-race:nickname";

/** The nickname is the whole identity: no accounts, no login, just a name kept locally. */
export function loadNickname(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function saveNickname(nickname: string): void {
  window.localStorage.setItem(KEY, nickname);
}
