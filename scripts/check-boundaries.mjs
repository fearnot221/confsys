import ts from "typescript";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { pathToFileURL } from "node:url";
export function checkBoundaries(root = process.cwd()) {
  const files = (dir) =>
    !existsSync(dir)
      ? []
      : readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? files(resolve(dir, e.name))
            : /\.tsx?$/.test(e.name)
              ? [resolve(dir, e.name)]
              : [],
        );
  const failures = [];
  const features = resolve(root, "apps/web/src/features");
  const presentation = [
    resolve(root, "packages/ui/src"),
    ...(existsSync(features)
      ? readdirSync(features).map((name) =>
          resolve(features, name, "components"),
        )
      : []),
  ];
  const inside = (file, dir) => file.startsWith(dir + "/");
  const uiFile = (file) => presentation.some((dir) => inside(file, dir));
  const contracts = resolve(root, "packages/contracts/src");
  const configFile = ts.readConfigFile(
    resolve(root, "tsconfig.json"),
    ts.sys.readFile,
  );
  const options = ts.parseJsonConfigFileContent(
    configFile.config ?? {},
    ts.sys,
    root,
  ).options;
  const serverEntry = resolve(root, "apps/web/src/entry-server.tsx");
  for (const file of [
    ...presentation.flatMap(files),
    ...files(contracts),
    ...(existsSync(serverEntry) ? [serverEntry] : []),
  ]) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const fail = (reason) =>
      failures.push(`${relative(root, file)}: ${reason}`);
    const presentationFile = uiFile(file);
    const serverFile = file === serverEntry;
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      ) {
        const spec = node.moduleSpecifier.text;
        const resolved = ts.resolveModuleName(spec, file, options, ts.sys)
          .resolvedModule?.resolvedFileName;
        const localFallback = spec.startsWith(".")
          ? resolve(dirname(file), spec.replace(/\.js$/, ".ts"))
          : undefined;
        const target = resolved ?? localFallback;
        const allowed = serverFile
          ? spec === "react-dom/server" ||
            (spec === "@confsys/contracts" &&
              ts.isImportDeclaration(node) &&
              node.importClause?.isTypeOnly) ||
            (target && uiFile(target)) ||
            /^\.\/design\/[a-z-]+\.css$/.test(spec)
          : presentationFile
            ? ["react", "react/jsx-runtime", "@confsys/ui"].includes(spec) ||
              (spec === "@confsys/contracts" &&
                ts.isImportDeclaration(node) &&
                node.importClause?.isTypeOnly) ||
              (target && uiFile(target))
            : spec === "zod" || (target && inside(target, contracts));
        if (!allowed) fail(`import/re-export forbidden: ${spec}`);
      }
      if (
        ts.isCallExpression(node) &&
        [
          "import",
          "require",
          ...(presentationFile || serverFile ? ["fetch"] : []),
        ].includes(node.expression.getText(source))
      )
        fail("dynamic/network call forbidden");
      if (
        presentationFile &&
        ts.isPropertyAccessExpression(node) &&
        [
          "fetch",
          "localStorage",
          "sessionStorage",
          "cookie",
          "XMLHttpRequest",
          "WebSocket",
        ].includes(node.name.text)
      )
        fail("browser data access forbidden");
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return failures;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const failures = checkBoundaries();
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("Presentation and contract boundaries verified");
}
