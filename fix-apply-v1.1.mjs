import { readFileSync, writeFileSync } from "node:fs";

const path = "apply-v1.1.mjs";
let source = readFileSync(path, "utf8");

const replacements = [
  [
    '    this.element.style.left = `\\${this.originX}px`;',
    '    this.element.style.left = this.originX + "px";'
  ],
  [
    '    this.element.style.top = `\\${this.originY}px`;',
    '    this.element.style.top = this.originY + "px";'
  ],
  [
    '    this.knob.style.transform = `translate3d(\\${x}px, \\${y}px, 0)`;',
    '    this.knob.style.transform = "translate3d(" + x + "px, " + y + "px, 0)";'
  ]
];

for (const [from, to] of replacements) {
  if (!source.includes(from)) {
    throw new Error(`Expected patch text not found: ${from}`);
  }
  source = source.replace(from, to);
}

writeFileSync(path, source);
console.log("Repaired nested template literals in apply-v1.1.mjs");
