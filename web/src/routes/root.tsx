import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const rootRoute = createRootRoute({
  component: () => (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-10 px-5 py-8 sm:px-8 sm:py-12">
      <header>
        <Link
          to="/"
          className="stream text-sm tracking-[0.2em] text-dim transition-colors hover:text-paper"
        >
          typing<span className="text-signal">.</span>
        </Link>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  ),
  notFoundComponent: () => (
    <p className="text-dim">
      Página não encontrada.{" "}
      <Link to="/" className="text-signal underline underline-offset-4">
        Voltar ao início
      </Link>
    </p>
  ),
});
