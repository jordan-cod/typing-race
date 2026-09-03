import { createRoute, useNavigate } from "@tanstack/react-router";
import { NICKNAME_MAX_LENGTH, ROOM_CODE_LENGTH, roomCodeSchema } from "@typing-race/protocol";
import { useEffect, useState } from "react";
import { createRoom, roomExists } from "../lib/api.ts";
import { formatNumber } from "../lib/format.ts";
import { loadPersonalBest } from "../lib/personalBest.ts";
import { usePrefersReducedMotion } from "../lib/reducedMotion.ts";
import { loadNickname, saveNickname } from "../lib/session.ts";
import { rootRoute } from "./root.tsx";

const DEMO = "um minuto para digitar o máximo que der";

function Home() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const [nickname, setNickname] = useState(loadNickname);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typed = useAutoType(DEMO, reduced);
  const [best] = useState(loadPersonalBest);

  const trimmed = nickname.trim();

  async function handleCreate() {
    if (trimmed.length < 2) return setError("Escolha um apelido primeiro");
    setBusy(true);
    setError(null);
    try {
      saveNickname(trimmed);
      navigate({ to: "/sala/$code", params: { code: await createRoom() } });
    } catch {
      setError("Não foi possível criar a sala");
      setBusy(false);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    if (trimmed.length < 2) return setError("Escolha um apelido primeiro");
    const parsed = roomCodeSchema.safeParse(code);
    if (!parsed.success) return setError(`O código tem ${ROOM_CODE_LENGTH} letras`);
    setBusy(true);
    setError(null);
    if (!(await roomExists(parsed.data))) {
      setBusy(false);
      return setError("Sala não encontrada");
    }
    saveNickname(trimmed);
    navigate({ to: "/sala/$code", params: { code: parsed.data } });
  }

  return (
    <div className="space-y-12">
      {/* The hero is the thing itself: a line of the stream being typed, caret and all. */}
      <div>
        <p className="stream text-2xl leading-relaxed break-words text-paper sm:text-3xl">
          {typed}
          <span
            className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.18em] bg-signal"
            style={reduced ? undefined : { animation: "miss-shake 0s" }}
          />
          <span className="text-dim">{DEMO.slice(typed.length)}</span>
        </p>
        <p className="mt-5 max-w-lg text-dim">
          Corrida de digitação para duas ou mais pessoas. Todo mundo recebe o mesmo texto e começa
          no mesmo instante. Ganha quem digitar mais caracteres certos.
        </p>
      </div>

      <div className="border-t border-ink-700" />

      <div className="max-w-md space-y-8">
        <label className="block space-y-2">
          <span className="text-sm text-dim">seu apelido</span>
          <input
            className="w-full border-b border-ink-700 bg-transparent pb-2 text-2xl outline-none focus:border-signal"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={NICKNAME_MAX_LENGTH}
            placeholder="como você aparece na sala"
          />
        </label>

        <div className="space-y-5">
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="w-full bg-signal py-3.5 font-display font-semibold text-ink-900 disabled:opacity-50 sm:w-auto sm:px-10"
          >
            Criar sala
          </button>

          <form onSubmit={handleJoin} className="flex items-end gap-3">
            <label className="flex-1 space-y-2">
              <span className="text-sm text-dim">ou entre com um código</span>
              <input
                className="stream w-full border-b border-ink-700 bg-transparent pb-2 text-2xl tracking-[0.28em] uppercase outline-none focus:border-signal"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                maxLength={ROOM_CODE_LENGTH}
                placeholder="XXXX"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="border border-ink-700 px-6 py-3 font-display font-semibold hover:border-paper disabled:opacity-50"
            >
              Entrar
            </button>
          </form>
        </div>

        {error && <p className="text-miss">{error}</p>}
        {best && (
          <p className="text-sm text-dim">
            Seu recorde neste navegador: {formatNumber(best.wpm)} ppm.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Types the demo line out once, then stops.
 *
 * The one piece of motion on this page that nobody asked for, and it is here because it shows
 * what the product is faster than a sentence about it can. It runs a single pass — a loop
 * would turn it into decoration.
 */
function useAutoType(text: string, reduced: boolean): string {
  const [length, setLength] = useState(reduced ? text.length : 0);

  useEffect(() => {
    if (reduced) return;
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setLength(index);
      if (index >= text.length) clearInterval(timer);
    }, 55);
    return () => clearInterval(timer);
  }, [text, reduced]);

  return text.slice(0, length);
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});
