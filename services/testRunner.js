const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");
const { oc } = require("./output");
const { getApiKey, getN8nWebhook } = require("./secrets");
const { getConfig } = require("./config");
const { notifyTests } = require("./n8n");

/**
 * Gera testes PHPUnit para todos os arquivos PHP do workspace usando LLM.
 *
 * @param {import("vscode").ExtensionContext} context
 * @param {string} workspace  Diretório raiz do projeto do usuário
 */
async function generateTests(context, workspace) {
  oc.clear();
  oc.appendLine("[DevAssist] Gerando testes para o projeto...");
  oc.show(true);

  const apiKey = await getApiKey(context);
  if (!apiKey) {
    vscode.window.showErrorMessage("DevAssist PHP: configure a API Key antes de gerar testes.");
    return;
  }

  const cfg = getConfig();
  const phpPath = cfg.phpPath;
  const engineDir = path.join(context.extensionPath, "engine");
  const scriptPath = path.join(engineDir, "bin", "generate-tests.php");
  const testsDir = vscode.workspace
    .getConfiguration("phpDocgen")
    .get("testsDir", "tests");
  const outputDir = path.join(workspace, testsDir);
  const phpFiles = collectPhpFiles(workspace);

  if (phpFiles.length === 0) {
    vscode.window.showInformationMessage("Nenhum arquivo PHP encontrado no projeto.");
    return;
  }

  oc.appendLine(`Arquivos PHP encontrados: ${phpFiles.length}`);
  oc.appendLine(`Testes serão gerados em: ${outputDir}`);

  const childEnv = {
    ...process.env,
    LLM_PROVIDER: cfg.env.LLM_PROVIDER || "openai",
    LLM_API_KEY: apiKey,
    LLM_MODEL: cfg.env.LLM_MODEL || "",
    LLM_BASE: cfg.env.LLM_BASE || "",
    OPENAI_API_KEY: apiKey,
    OPENAI_MODEL: cfg.env.LLM_MODEL || "",
    OPENAI_BASE: cfg.env.LLM_BASE || "",
  };

  let generated = 0;
  let errors = 0;

  for (const phpFile of phpFiles) {
    oc.appendLine(`\nProcessando: ${path.relative(workspace, phpFile)}`);

    const result = cp.spawnSync(
      phpPath,
      [scriptPath, "--input", phpFile, "--output-dir", outputDir],
      { cwd: engineDir, env: childEnv, encoding: "utf8", timeout: 60000 }
    );

    if (result.stdout) oc.appendLine(result.stdout.trim());
    if (result.stderr) oc.appendLine("[ERRO] " + result.stderr.trim());

    if (result.status === 0) {
      generated++;
    } else {
      errors++;
    }
  }

  oc.appendLine(`\n--- Concluído: ${generated} gerados, ${errors} erros ---`);

  const bootstrapLines = ["<?php"];
  for (const f of phpFiles) {
    bootstrapLines.push(`require_once ${JSON.stringify(f)};`);
  }
  const bootstrapPath = path.join(outputDir, "bootstrap.php");
  await fs.promises.writeFile(bootstrapPath, bootstrapLines.join("\n") + "\n", "utf8");

  const xmlPath = path.join(outputDir, "phpunit.xml");
  if (!fs.existsSync(xmlPath)) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="https://schema.phpunit.de/11/phpunit.xsd"
         bootstrap="bootstrap.php"
         cacheResultFile=".phpunit.result.cache"
         colors="true">
  <testsuites>
    <testsuite name="Project Test Suite">
      <directory>.</directory>
    </testsuite>
  </testsuites>
</phpunit>
`;
    await fs.promises.writeFile(xmlPath, xml, "utf8");
    oc.appendLine("[DevAssist] phpunit.xml criado em " + testsDir + "/");
  }

  vscode.window.showInformationMessage(
    `DevAssist PHP: ${generated} arquivo(s) de teste gerado(s) em ${testsDir}/`
  );
}

/**
 * Executa PHPUnit no projeto do usuário e retorna o resultado.
 *
 * @param {string} workspace  Diretório raiz do projeto
 * @returns {Promise<{ success: boolean, output: string, passed: number, failed: number, skipped: number }>}
 */
async function runTests(workspace, extensionPath) {
  const candidates = [
    path.join(workspace, "vendor", "bin", "phpunit"),
    path.join(workspace, "vendor", "bin", "phpunit.bat"),
  ];

  if (extensionPath) {
    candidates.push(
      path.join(extensionPath, "engine", "vendor", "bin", "phpunit"),
      path.join(extensionPath, "engine", "vendor", "bin", "phpunit.bat")
    );
  }

  const phpunit = candidates.find(c => { try { return fs.existsSync(c); } catch { return false; } });

  if (!phpunit) {
    return {
      success: null,
      output: "PHPUnit não encontrado.",
      passed: 0, failed: 0, skipped: 0,
      notInstalled: true,
    };
  }

  const testsDir = vscode.workspace.getConfiguration("phpDocgen").get("testsDir", "tests");
  const testsDirAbs = path.join(workspace, testsDir);

  const args = ["--colors=never", "--no-coverage"];

  const xmlConfigInTests = path.join(testsDirAbs, "phpunit.xml");
  const xmlConfigInRoot = path.join(workspace, "phpunit.xml");
  const xmlConfig = fs.existsSync(xmlConfigInTests) ? xmlConfigInTests
    : fs.existsSync(xmlConfigInRoot) ? xmlConfigInRoot
      : null;

  const bootstrap = path.join(testsDirAbs, "bootstrap.php");
  const userAutoload = path.join(workspace, "vendor", "autoload.php");

  if (xmlConfig) {
    args.push("--configuration", xmlConfig);
  } else {
    if (fs.existsSync(bootstrap)) {
      args.push("--bootstrap", bootstrap);
    } else if (fs.existsSync(userAutoload)) {
      args.push("--bootstrap", userAutoload);
    }
    args.push(testsDirAbs);
  }

  return new Promise(resolve => {
    const proc = cp.spawn(phpunit, args, {
      cwd: workspace,
      timeout: 120000,
      shell: true,
    });

    let output = "";
    proc.stdout.on("data", d => { output += d; });
    proc.stderr.on("data", d => { output += d; });

    proc.on("close", code => {
      const okMatch = output.match(/OK \((\d+) test/);
      const totalMatch = output.match(/Tests:\s*(\d+)/);
      const failMatch = output.match(/Failures:\s*(\d+)/);
      const errMatch = output.match(/Errors:\s*(\d+)/);
      const skipMatch = output.match(/Skipped:\s*(\d+)/);

      const total = okMatch ? parseInt(okMatch[1]) : parseInt(totalMatch?.[1] ?? "0");
      const failed = parseInt(failMatch?.[1] ?? "0") + parseInt(errMatch?.[1] ?? "0");
      const skipped = parseInt(skipMatch?.[1] ?? "0");
      const passed = Math.max(0, total - failed - skipped);

      resolve({ success: code === 0, output, passed, failed, skipped });
    });

    proc.on("error", (err) => {
      resolve({ success: false, output: "Erro ao executar PHPUnit: " + err.message, passed: 0, failed: 0, skipped: 0 });
    });
  });
}

/**
 * Gera os testes e depois os executa, exibindo o resultado no output channel.
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function generateAndRunTests(context) {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) {
    vscode.window.showErrorMessage("Nenhum projeto aberto.");
    return;
  }

  await generateTests(context, workspace);

  const cfg = vscode.workspace.getConfiguration("phpDocgen");
  if (!cfg.get("runTestsAfterGenerate", true)) return;

  oc.appendLine("\n[DevAssist] Executando PHPUnit...");

  const result = await runTests(workspace, context.extensionPath);

  if (result.notInstalled) {
    oc.appendLine("[DevAssist] " + result.output);
    return result;
  }

  oc.appendLine(result.output);
  oc.appendLine(`\nResultado: ${result.passed} passou | ${result.failed} falhou | ${result.skipped} pulado`);

  if (result.success) {
    vscode.window.setStatusBarMessage("DevAssist PHP: todos os testes passaram.", 5000);
  } else {
    vscode.window.showWarningMessage(`DevAssist PHP: ${result.failed} teste(s) falharam. Veja o Output.`);
  }

  if (cfg.get("n8n.notifyOnTests", true)) {
    try {
      const webhookUrl = await getN8nWebhook(context);
      if (webhookUrl) {
        const { exec } = require("child_process");
        const getGit = (cmd) => new Promise(r => exec(cmd, { cwd: workspace }, (_, o) => r((o || "").trim())));
        const branch = await getGit("git rev-parse --abbrev-ref HEAD");
        const sha = await getGit("git rev-parse --short HEAD");
        const remote = await getGit("git config --get remote.origin.url");
        const commitMsg = await getGit("git log --format=%s -1");
        const author = await getGit("git log --format=%an -1");
        const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
        const repo = m ? `${m[1]}/${m[2]}` : workspace;
        const repoUrl = m ? `https://github.com/${m[1]}/${m[2]}` : "";
        const actionsUrl = m ? `${repoUrl}/actions` : "";
        const total = result.passed + result.failed + result.skipped;
        const passRate = total > 0 ? Math.round((result.passed / total) * 100) : 0;

        const failedTests = (result.output || "")
          .split("\n")
          .filter(l => /^(FAIL|Error|✘|F )/.test(l.trim()))
          .slice(0, 10)
          .map(l => l.trim());

        await notifyTests(webhookUrl, {
          repo, branch, sha, commitMessage: commitMsg, author,
          passed: result.passed, failed: result.failed, skipped: result.skipped,
          total, passRate, success: result.success,
          failedTests,
          repoUrl, actionsUrl,
        });
        oc.appendLine("[n8n] Notificação de testes enviada.");
      }
    } catch (e) {
      oc.appendLine("[n8n] Falha ao notificar testes: " + e);
    }
  }

  return result;
}

/**
 * Apenas executa os testes existentes (sem gerar novos).
 *
 * @param {string} workspace
 */
async function runTestsOnly(workspace, extensionPath) {
  oc.clear();
  oc.appendLine("[DevAssist] Executando testes do projeto...");
  oc.show(true);

  const result = await runTests(workspace, extensionPath);

  if (result.notInstalled) {
    oc.appendLine("[DevAssist] " + result.output);
    return result;
  }

  oc.appendLine(result.output);
  oc.appendLine(`\nResultado: ${result.passed} passou | ${result.failed} falhou | ${result.skipped} pulado`);

  return result;
}

/**
 * Coleta arquivos PHP do projeto do usuário, ignorando vendor e diretórios comuns de build.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function collectPhpFiles(dir) {
  const ignored = new Set(["vendor", "node_modules", ".git", "tests", "test", "output", "docs"]);
  const files = [];

  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith(".")) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.name.endsWith(".php")) {
        files.push(path.join(current, entry.name));
      }
    }
  }

  walk(dir);
  return files;
}

module.exports = { generateAndRunTests, runTestsOnly };
