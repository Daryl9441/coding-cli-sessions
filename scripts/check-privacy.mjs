import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

// These rules run on every PR and fail closed when process or filesystem entrypoints move.
const failures = [];
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (/\.tsx?$/.test(entry.name)) result.push(path);
  }
  return result;
}
for (const path of await files("src")) {
  const name = relative(".", path).replaceAll("\\", "/");
  const text = await readFile(path, "utf8");
  const source = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const fail = (rule, node) =>
    failures.push(`${name}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: ${rule}`);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      if (/node-pty|xterm|shelljs|execa|sentry|segment|posthog|mixpanel|amplitude/i.test(module))
        fail("forbidden runtime dependency", node);
      if (/^(node:)?child_process$/.test(module) && name !== "src/runtime/process.ts") {
        const imports = node.importClause?.namedBindings;
        const typeOnly =
          node.importClause?.isTypeOnly ||
          (imports && ts.isNamedImports(imports) && imports.elements.every((item) => item.isTypeOnly));
        if (!typeOnly) fail("all subprocess creation must use the audited process boundary", node);
      }
      if (/^(node:)?(?:https?|tls|dgram|dns)$/.test(module)) fail("no outbound network clients in the extension", node);
    }
    if (ts.isPropertyAccessExpression(node) && node.getText(source) === "process.env" && name !== "src/core/privacy.ts")
      fail("environment access outside the whitelist boundary", node);
    if (ts.isCallExpression(node)) {
      const call = node.expression.getText(source);
      if (["eval", "Function", "exec", "execSync", "spawnSync", "execFile", "execFileSync"].includes(call))
        fail("forbidden execution primitive", node);
      if (/\b(readFile|readFileSync|createReadStream)\b/.test(call))
        fail("unrestricted file reads are forbidden; use openSession", node);
      if (call === "open" && name !== "src/monitor/files.ts") fail("file-open boundary changed; audit required", node);
      if (call === "spawn") {
        if (name !== "src/runtime/process.ts") fail("spawn outside audited boundary", node);
        const args = node.arguments[1];
        const options = node.arguments[2];
        if (!args || ts.isStringLiteral(args) || ts.isTemplateExpression(args))
          fail("spawn argv must be an array", node);
        if (!options || !ts.isObjectLiteralExpression(options)) fail("explicit spawn options required", node);
        else {
          const props = options.properties.filter(ts.isPropertyAssignment);
          if (
            !props.some((p) => p.name.getText(source) === "shell" && p.initializer.kind === ts.SyntaxKind.FalseKeyword)
          )
            fail("shell must be explicitly false", node);
          if (
            !props.some(
              (p) => p.name.getText(source) === "env" && p.initializer.getText(source) === "minimalEnvironment()",
            )
          )
            fail("spawn must use whitelist environment", node);
          if (options.properties.some(ts.isSpreadAssignment)) fail("no spread into spawn options", node);
        }
      }
      if (/^console\./.test(call)) fail("runtime console output is forbidden", node);
    }
    if (ts.isStringLiteral(node) && /(?:\.credentials\.json|auth\.json|\.npmrc|--remote(?:$|\s))/.test(node.text))
      fail("forbidden credential or remote endpoint literal", node);
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const preferences = [
  ...(manifest.preferences ?? []),
  ...manifest.commands.flatMap((command) => command.preferences ?? []),
];
if (preferences.some((preference) => preference.type === "password"))
  failures.push("password preferences are forbidden");
const runtimeDependencies = Object.keys(manifest.dependencies ?? {});
if (runtimeDependencies.some((name) => !["@raycast/api", "@raycast/utils"].includes(name)))
  failures.push("new runtime dependency requires a privacy review");
if (failures.length) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exitCode = 1;
} else
  process.stdout.write(
    "Privacy static checks passed: process boundary, env whitelist, credential paths, network clients, telemetry dependencies, and preferences.\n",
  );
