import "./styles.css";
import { App } from "./app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("#app element was not found");

new App(root);
