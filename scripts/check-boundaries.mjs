import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Only UI source and React may be imported by presentation. Relative imports are
// resolved and checked too, preventing a ../hooks or ../../../packages/db escape.
const roots = [
  "packages/ui/src",
  ...readdirSync("apps/web/src/features", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `apps/web/src/features/${e.name}/components`),
];
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}
let failures = 0;
for (const root of roots)
  for (const path of files(root)) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      ) {
        const spec = node.moduleSpecifier.text;
        if (
          ![
            "react",
            "react/jsx-runtime",
            "@confsys/ui",
            "./components.js",
          ].includes(spec)
        ) {
          console.error(`${path}: presentation import not allowed: ${spec}`);
          failures++;
        }
      }
      if (
        ts.isCallExpression(node) &&
        ["import", "require", "fetch"].includes(node.expression.getText(source))
      ) {
        console.error(`${path}: dynamic/network call forbidden`);
        failures++;
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        [
          "fetch",
          "localStorage",
          "sessionStorage",
          "cookie",
          "XMLHttpRequest",
          "WebSocket",
        ].includes(node.name.text)
      ) {
        console.error(`${path}: browser data access forbidden`);
        failures++;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
if (failures) process.exit(1);
console.log("Presentation boundaries verified");
