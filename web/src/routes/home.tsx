import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createRoom, roomExists } from "../lib/api.ts";
import { formatNumber } from "../lib/format.ts";
import { loadPersonalBest } from "../lib/personalBest.ts";
import { usePrefersReducedMotion } from "../lib/reducedMotion.ts";
import { loadNickname, saveNickname } from "../lib/session.ts";
import { NicknameMaxLength, normalizeRoomCode, RoomCodeLength } from "../protocol/index.ts";
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
  // Padrão nos dois ligados: as passagens são português de verdade, e é isso que vale treinar.
  const [accents, setAccents] = useState(true);
  const [punctuation, setPunctuation] = useState(true);

  const trimmed = nickname.trim();

  // `solo` sai daqui como busca na URL porque a sala só existe depois da chamada à API: a
  // tela seguinte lê isso e larga a corrida sozinha, sem passar pela espera de ninguém.
  async function handleCreate(solo: boolean) {
    if (trimmed.length < 2) return setError("Escolha um apelido primeiro");
    setBusy(true);
    setError(null);
    try {
      saveNickname(trimmed);
      navigate({
        to: "/$code",
        params: { code: await createRoom() },
        search: { accents, punctuation, ...(solo ? { solo: true } : {}) },
      });
    } catch {
      setError("Não foi possível criar a sala");
      setBusy(false);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    if (trimmed.length < 2) return setError("Escolha um apelido primeiro");
    const normalized = normalizeRoomCode(code);
    if (!normalized) return setError(`O código tem ${RoomCodeLength} letras`);
    setBusy(true);
    setError(null);
    if (!(await roomExists(normalized))) {
      setBusy(false);
      return setError("Sala não encontrada");
    }
    saveNickname(trimmed);
    navigate({ to: "/$code", params: { code: normalized } });
  }

  return (
    <div className="space-y-14">
      {/* O herói é a coisa em si: uma linha sendo digitada, cursor e tudo. O resto da página
          fica menor do que ela de propósito — quem chega aqui já entende o jogo antes de ler
          qualquer frase explicando. */}
      <div>
        <p className="stream text-3xl leading-[1.35] break-words text-paper sm:text-5xl">
          {typed}
          <span
            className="ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[0.18em] bg-signal"
            style={reduced ? undefined : { animation: "miss-shake 0s" }}
          />
          <span className="text-ink-700">{DEMO.slice(typed.length)}</span>
        </p>
      </div>

      <div className="max-w-lg space-y-7">
        {/* Sem rótulo em cima: o campo diz o que quer dentro dele, e os botões dizem o que
            fazem. Uma etiqueta acima de cada bloco transforma a entrada de um jogo numa tela
            de configuração. */}
        <input
          className="w-full border-b border-ink-800 bg-transparent pb-3 text-3xl outline-none transition-colors placeholder:text-ink-700 focus:border-signal"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={NicknameMaxLength}
          placeholder="seu apelido"
          aria-label="Seu apelido"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Toggle on={accents} onClick={() => setAccents(!accents)}>
            acentos
          </Toggle>
          <Toggle on={punctuation} onClick={() => setPunctuation(!punctuation)}>
            pontuação
          </Toggle>
          {!accents && !punctuation && (
            <span className="text-sm text-ink-700">só letra e espaço</span>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => handleCreate(false)}
            disabled={busy}
            className="bg-signal px-8 py-4 font-semibold whitespace-nowrap text-ink-900 transition-colors hover:bg-paper disabled:opacity-50"
          >
            Chamar alguém
          </button>
          <button
            type="button"
            onClick={() => handleCreate(true)}
            disabled={busy}
            className="border border-ink-800 px-8 py-4 font-semibold whitespace-nowrap transition-colors hover:border-paper disabled:opacity-50"
          >
            Jogar sozinho
          </button>
        </div>

        {/* Entrar numa sala existente é uma frase, não um formulário: quem tem código já sabe
            o que fazer com ele. */}
        <form onSubmit={handleJoin} className="flex items-baseline gap-3 text-dim">
          <span>Tem um código?</span>
          <input
            className="stream w-28 border-b border-ink-800 bg-transparent pb-1 text-lg tracking-[0.28em] text-paper uppercase outline-none transition-colors placeholder:text-ink-700 focus:border-signal"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={RoomCodeLength}
            placeholder="XXXX"
            aria-label="Código da sala"
          />
          <button
            type="submit"
            disabled={busy}
            className="underline underline-offset-4 transition-colors hover:text-paper disabled:opacity-50"
          >
            entrar
          </button>
        </form>

        {error && <p className="text-miss">{error}</p>}
        {best && <p className="text-sm text-ink-700">Seu recorde: {formatNumber(best.wpm)} ppm.</p>}
      </div>
    </div>
  );
}

/**
 * Uma opção do texto. Ligada é sólida, desligada é contorno — o estado se lê de longe, sem
 * precisar de rótulo dizendo "ligado".
 */
function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      // Ligado é claro, desligado é contorno. O âmbar não entra aqui: nesta interface ele
      // quer dizer "a ação principal", e gastá-lo num interruptor esvazia o significado dele
      // no botão que importa.
      className={`px-4 py-2 text-sm transition-colors ${
        on
          ? "bg-paper font-medium text-ink-900"
          : "border border-ink-800 text-dim hover:border-paper hover:text-paper"
      }`}
    >
      {children}
    </button>
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
