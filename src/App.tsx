import { lazy, Suspense, useEffect } from "react";
import { useStore } from "./core/store";
import { Canvas } from "./canvas/Canvas";
import { UILayer } from "./ui/UILayer";
import { IOLayer } from "./io/IOLayer";
import { CollabLayer } from "./collab/CollabLayer";
import { WorkspaceLayer } from "./workspace/WorkspaceLayer";

// Heavier, rarely-opened features load on demand to keep the initial bundle small.
const DiagramLayer = lazy(() => import("./diagram/DiagramLayer"));
// const CloudLayer = lazy(() => import("./cloud/CloudLayer"));

export default function App() {
  const theme = useStore((s) => s.appState.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("theme--dark", theme === "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121212" : "#ffffff");
  }, [theme]);

  return (
    <div className={`app theme--${theme}`}>
      <Canvas />
      <CollabLayer />
      <UILayer />
      <WorkspaceLayer />
      <IOLayer />
      <Suspense fallback={null}>
        <DiagramLayer />
        {/* <CloudLayer /> */}
      </Suspense>
    </div>
  );
}
