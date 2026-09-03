import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const rootRoute = createRootRoute({
  component: () => (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-5 py-10">
      <header>
        <Link to="/" className="font-mono text-sm uppercase tracking-[0.2em] text-muted">
          corrida de digitacao
        </Link>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  ),
  notFoundComponent: () => (
    <p className="text-muted">
      Pagina nao encontrada.{" "}
      <Link to="/" className="text-accent underline">
        Voltar ao inicio
      </Link>
    </p>
  ),
});
