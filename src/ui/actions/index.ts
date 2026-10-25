// Side-effect imports: each module registers its actions with the shared registry at load time.
import "./view";
import "./editing";
import "./arrange";

export { TOOL_DEFS, toolDef, toggleTheme } from "./view";
export { convertSelection, hasCopiedStyle } from "./editing";
