import "./styles.css";
import "./beautiful3d.css";
import { App } from "./app";
import { installTitlePreview } from "./titlePreview";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("#app element was not found");

installTitlePreview();
new App(root);
