import "@fontsource-variable/archivo";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { homeRoute } from "./routes/home.tsx";
import { roomRoute } from "./routes/room.tsx";
import { rootRoute } from "./routes/root.tsx";
import "./styles.css";

const routeTree = rootRoute.addChildren([homeRoute, roomRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

// No StrictMode: its double-mounting in development opens the race WebSocket twice, and the
// second join is rejected as a duplicate nickname before the first socket finishes closing.
createRoot(container).render(<RouterProvider router={router} />);
