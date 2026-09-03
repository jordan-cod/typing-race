import { createRoute, useNavigate } from "@tanstack/react-router";
import { NICKNAME_MAX_LENGTH, ROOM_CODE_LENGTH, roomCodeSchema } from "@typing-race/protocol";
import { useState } from "react";
import { createRoom, roomExists } from "../lib/api.ts";
import { loadNickname, saveNickname } from "../lib/session.ts";
import { rootRoute } from "./root.tsx";

function Home() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState(loadNickname);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = nickname.trim();
  const nicknameOk = trimmed.length >= 2;

  async function handleCreate() {
    if (!nicknameOk) return setError("Escolha um apelido");
    setBusy(true);
    setError(null);
    try {
      saveNickname(trimmed);
      const created = await createRoom();
      navigate({ to: "/sala/$code", params: { code: created } });
    } catch {
      setError("Nao foi possivel criar a sala");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    if (!nicknameOk) return setError("Escolha um apelido");
    const parsed = roomCodeSchema.safeParse(code);
    if (!parsed.success) return setError(`O codigo tem ${ROOM_CODE_LENGTH} caracteres`);
    setBusy(true);
    setError(null);
    if (!(await roomExists(parsed.data))) {
      setBusy(false);
      return setError("Sala nao encontrada");
    }
    saveNickname(trimmed);
    navigate({ to: "/sala/$code", params: { code: parsed.data } });
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold">Digite mais rapido que os outros.</h1>

      <label className="block space-y-2">
        <span className="text-sm text-muted">Seu apelido</span>
        <input
          className="w-full rounded-lg border border-edge bg-surface px-4 py-3 outline-none focus:border-accent"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder="Como voce aparece na sala"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-edge bg-surface p-5">
          <h2 className="font-medium">Criar uma sala</h2>
          <p className="text-sm text-muted">Voce recebe um codigo para chamar os outros.</p>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-canvas disabled:opacity-50"
          >
            Criar sala
          </button>
        </div>

        <form
          onSubmit={handleJoin}
          className="space-y-3 rounded-xl border border-edge bg-surface p-5"
        >
          <h2 className="font-medium">Entrar em uma sala</h2>
          <p className="text-sm text-muted">Use o codigo que te passaram.</p>
          <input
            className="w-full rounded-lg border border-edge bg-canvas px-4 py-2.5 text-center font-mono text-lg uppercase tracking-[0.4em] outline-none focus:border-accent"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="XXXX"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border border-edge px-4 py-2.5 font-medium disabled:opacity-50"
          >
            Entrar
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});
