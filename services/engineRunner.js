const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const { oc } = require("./output");
const { getConfig } = require("./config");
const { getApiKey } = require("./secrets");

/**
 * Remove a indentação mínima comum de um bloco de texto.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeIndent(text) {
  const lines = text.split("\n");
  const indents = lines
    .filter(l => l.trim())
    .map(l => l.match(/^(\s*)/)[1].length);
  const min = Math.min(...indents, 0);
  if (!min) return text;
  return lines.map(l => l.slice(min)).join("\n");
}

/**
 * Adiciona chaves de fechamento ausentes para garantir código PHP válido.
 *
 * @param {string} code
 * @returns {string}
 */
function balanceBraces(code) {
  const open = (code.match(/{/g) || []).length;
  const close = (code.match(/}/g) || []).length;
  let diff = open - close;
  while (diff-- > 0) code += "\n}";
  return code;
}

/**
 * Envolve um fragmento PHP em código válido para análise pelo engine.
 *
 * @param {string} fragment
 * @returns {{ code: string, offset: number }}
 */
function sanitizeFragment(fragment) {
  fragment = normalizeIndent(fragment);
  const lines = fragment.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  fragment = lines.join("\n");

  if (/^\s*<\?php/.test(fragment)) return { code: fragment, offset: 0 };

  const open = (fragment.match(/{/g) || []).length;
  const close = (fragment.match(/}/g) || []).length;
  if (open > close) fragment += "\n" + "}".repeat(open - close);

  const hasClass = /^\s*(class|interface|trait|enum)\s+/m.test(fragment);
  const hasVisibility = /^\s*(public|protected|private)\s+/m.test(fragment);
  const hasFunction = /\bfunction\b/.test(fragment);

  if (hasClass) {
    return { code: `<?php\n${fragment}\n`, offset: 1 };
  }

  if (hasVisibility || hasFunction) {
    return {
      code: `<?php\nclass __DocGenTemp {\n\n${fragment}\n\n}\n`,
      offset: 3
    };
  }

  return {
    code: `<?php\nfunction __docgen_fragment() {\n\n${fragment}\n\n}\n`,
    offset: 3
  };
}

/**
 * Aplica indentação a todas as linhas de um texto.
 *
 * @param {string} text
 * @param {string} indent
 * @returns {string}
 */
function applyIndent(text, indent) {
  return text.split("\n").map(l => indent + l).join("\n");
}

/**
 * Expande a seleção do editor para incluir a função ou classe completa.
 *
 * @param {import("vscode").TextEditor} editor
 * @returns {string}
 */
function expandSelection(editor) {
  const doc = editor.document;
  const total = doc.lineCount;
  const startSel = editor.selection.start.line;
  const endSel = editor.selection.end.line;

  const isFunction = t => /(public|protected|private|static|\s)*function\s+[a-zA-Z0-9_]+\s*\(/.test(t);
  const isClass = t => /^\s*(class|interface|trait|enum)\s+/.test(t);

  let start = -1;

  for (let i = startSel; i <= endSel; i++) {
    if (isFunction(doc.lineAt(i).text)) { start = i; break; }
  }

  if (start === -1) {
    for (let i = startSel; i >= 0; i--) {
      const t = doc.lineAt(i).text;
      if (isFunction(t) || isClass(t)) { start = i; break; }
    }
  }

  if (start === -1) return doc.getText(editor.selection);

  let braceCount = 0, foundOpen = false, end = start;

  for (let i = start; i < total; i++) {
    for (const char of doc.lineAt(i).text) {
      if (char === "{") { braceCount++; foundOpen = true; }
      if (char === "}") { braceCount--; }
    }
    if (foundOpen && braceCount === 0) { end = i; break; }
  }

  return doc.getText(new vscode.Range(start, 0, end + 1, 0));
}

/**
 * Executa o engine PHP para documentar o código selecionado ou o arquivo inteiro.
 * Aplica os docblocks gerados diretamente no editor.
 *
 * @param {import("vscode").ExtensionContext} context
 * @param {import("vscode").TextEditor} editor
 */
async function runPhp(context, editor) {
  oc.clear();
  oc.appendLine("[DevAssist] Iniciando documentação...");
  oc.show(true);

  const { env, phpPath } = getConfig();

  const engineDir = path.join(context.extensionPath, "engine");
  const script = path.join(engineDir, "bin", "run.php");
  const inputDir = path.join(engineDir, "input");
  const outputDir = path.join(engineDir, "output");
  const inputFile = path.join(inputDir, "entrada.php");

  const autoload = path.join(engineDir, "vendor", "autoload.php");
  if (!fs.existsSync(autoload)) {
    vscode.window.showErrorMessage(
      "DevAssist PHP: dependências PHP não instaladas. Certifique-se de que o Composer está no PATH e recarregue o VS Code."
    );
    return;
  }

  await fs.promises.mkdir(inputDir, { recursive: true });
  await fs.promises.mkdir(outputDir, { recursive: true });

  const selected = editor.selection.isEmpty
    ? editor.document.getText()
    : expandSelection(editor);

  const wrapped = sanitizeFragment(selected);

  await fs.promises.writeFile(inputFile, wrapped.code, "utf8");

  oc.appendLine("----- PHP enviado ao engine -----");
  oc.appendLine(wrapped.code);
  oc.appendLine("---------------------------------");

  const apiKey = await getApiKey(context);

  const childEnv = {
    ...process.env,
    LLM_PROVIDER: env.LLM_PROVIDER || "openai",
    LLM_API_KEY: apiKey || "",
    LLM_MODEL: env.LLM_MODEL || "",
    LLM_BASE: env.LLM_BASE || "",
    OPENAI_API_KEY: apiKey || "",
    OPENAI_MODEL: env.LLM_MODEL || "",
    OPENAI_BASE: env.LLM_BASE || "",
  };

  const result = cp.spawnSync(
    phpPath,
    [script, "--input", inputFile, "--base", "entrada"],
    { cwd: engineDir, env: childEnv, encoding: "utf8" }
  );

  if (result.error) {
    oc.appendLine("[DevAssist] Erro ao executar PHP: " + result.error.message);
    vscode.window.showErrorMessage(
      `DevAssist PHP: PHP não encontrado (${phpPath}). Instale o PHP e adicione ao PATH.`
    );
    return;
  }

  if (result.stdout) oc.appendLine(result.stdout);
  if (result.stderr) oc.appendLine(result.stderr);

  const mapFile = path.join(outputDir, "doc_map_entrada.json");
  const docsFile = path.join(outputDir, "generated_docs_entrada.json");

  if (!fs.existsSync(mapFile) || !fs.existsSync(docsFile)) {
    vscode.window.showWarningMessage("DevAssist PHP: arquivos de saída não encontrados. Verifique se o PHP está no PATH.");
    return;
  }

  const map = JSON.parse(await fs.promises.readFile(mapFile, "utf8"));
  const docs = JSON.parse(await fs.promises.readFile(docsFile, "utf8"));

  const selectionStart = editor.selection.isEmpty ? 0 : editor.selection.start.line;
  const inserts = [];

  for (const item of map) {
    if (item.type === "class" && item.name === "__DocGenTemp") continue;

    const docBlock = docs[item.id];
    if (!docBlock) continue;

    let targetLine = (item.line - wrapped.offset) + selectionStart - 1;

    if (targetLine < 0 || targetLine >= editor.document.lineCount) continue;

    let insertAt = targetLine;
    while (insertAt < editor.document.lineCount - 1 && !editor.document.lineAt(insertAt).text.trim()) {
      insertAt++;
    }

    const indent = editor.document.lineAt(insertAt).text.match(/^(\s*)/)?.[0] ?? "";

    inserts.push({ line: insertAt, doc: applyIndent(docBlock, indent) });
  }

  inserts.sort((a, b) => b.line - a.line);

  await editor.edit(edit => {
    for (const ins of inserts) {
      edit.insert(new vscode.Position(ins.line, 0), ins.doc + "\n");
    }
  });

  await editor.document.save();

  vscode.window.setStatusBarMessage("DevAssist PHP: documentação aplicada.", 3000);
}

/**
 * Detecta métodos sem docblock no arquivo atual.
 *
 * @param {string} text Conteúdo do arquivo
 * @returns {number[]} Linhas com funções sem documentação
 */
function findUndocumentedMethods(text) {
  const lines = text.split("\n");
  const methods = [];

  for (let i = 0; i < lines.length; i++) {
    if (/function\s+[a-zA-Z0-9_]+\s*\(/.test(lines[i])) {
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j--;
      if (j < 0 || !lines[j].trim().startsWith("/**")) {
        methods.push(i);
      }
    }
  }

  return methods;
}

/**
 * Documenta automaticamente o arquivo inteiro caso existam métodos sem docblock.
 *
 * @param {import("vscode").ExtensionContext} context
 * @param {import("vscode").TextEditor} editor
 * @returns {Promise<boolean>} true se alguma documentação foi aplicada
 */
async function autoDocumentFile(context, editor) {
  const text = editor.document.getText();
  const methods = findUndocumentedMethods(text);

  if (methods.length === 0) return false;

  const origin = new vscode.Position(0, 0);
  editor.selection = new vscode.Selection(origin, origin);

  await runPhp(context, editor);
  await editor.document.save();

  return true;
}

module.exports = {
  runPhp,
  autoDocumentFile,
  sanitizeFragment,
  expandSelection,
};
