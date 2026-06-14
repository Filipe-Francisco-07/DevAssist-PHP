const vscode = require("vscode");
const path = require("path");

// Helpers de verificação
async function requireApiKey(context) {
  const { getApiKey } = require("./services/secrets");
  const key = await getApiKey(context);
  if (!key) {
    const action = await vscode.window.showErrorMessage(
      "DevAssist PHP: nenhuma API Key configurada. Configure antes de usar esta função.",
      "Configurar agora"
    );
    if (action === "Configurar agora") {
      await vscode.commands.executeCommand("docgen.setApiKey");
    }
    return false;
  }
  return true;
}

function testsEnabled() {
  return vscode.workspace.getConfiguration("phpDocgen").get("tests.enabled", true);
}

async function requireTestsEnabled() {
  if (!testsEnabled()) {
    vscode.window.showWarningMessage(
      "DevAssist PHP: funcionalidade de testes está desativada. Ative em Configurações → DevAssist PHP — Testes → tests.enabled."
    );
    return false;
  }
  return true;
}

// Mensagem de boas vindas
async function showWelcomeIfNeeded(context) {
  const shown = context.globalState.get("devassist.welcomeShown", false);
  if (shown) return;

  const { getApiKey, getGithubToken } = require("./services/secrets");
  const [key, token] = await Promise.all([getApiKey(context), getGithubToken(context)]);

  if (!key && !token) {
    const action = await vscode.window.showInformationMessage(
      "Bem-vindo ao DevAssist PHP! Configure sua API Key (IA) e GitHub Token para aproveitar todos os recursos.",
      "API Key", "GitHub Token", "Agora não"
    );
    if (action === "API Key") vscode.commands.executeCommand("docgen.setApiKey");
    if (action === "GitHub Token") vscode.commands.executeCommand("docgen.setGithubToken");
  } else if (!key) {
    const action = await vscode.window.showInformationMessage(
      "DevAssist PHP: configure uma API Key para usar documentação e geração de testes com IA.",
      "Configurar API Key", "Agora não"
    );
    if (action === "Configurar API Key") vscode.commands.executeCommand("docgen.setApiKey");
  } else if (!token) {
    const action = await vscode.window.showInformationMessage(
      "DevAssist PHP: configure o GitHub Token para criar repositórios e usar o Dashboard completo.",
      "Configurar GitHub Token", "Agora não"
    );
    if (action === "Configurar GitHub Token") vscode.commands.executeCommand("docgen.setGithubToken");
  }

  await context.globalState.update("devassist.welcomeShown", true);
}

// Activate
async function activate(context) {
  const { oc } = require("./services/output");

  try {
    const { ensureComposerInstall } = require("./services/git");
    const engineDir = path.join(context.extensionPath, "engine");
    await ensureComposerInstall(engineDir);
  } catch (err) {
    oc.appendLine("[DevAssist] Aviso: erro ao verificar dependências PHP: " + err);
  }

  showWelcomeIfNeeded(context);

  context.subscriptions.push(

    // Documentação (requer API Key)
    vscode.commands.registerCommand("docgen.documentSelection", async () => {
      const { oc: log } = require("./services/output");
      log.show(true);
      try {
        if (!await requireApiKey(context)) return;
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const { runPhp } = require("./services/engineRunner");
        await runPhp(context, editor);
      } catch (err) {
        vscode.window.showErrorMessage("DevAssist PHP: erro ao documentar — " + err);
      }
    }),

    vscode.commands.registerCommand("docgen.documentFile", async () => {
      const { oc: log } = require("./services/output");
      log.show(true);
      try {
        if (!await requireApiKey(context)) return;
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const origin = new vscode.Position(0, 0);
        editor.selection = new vscode.Selection(origin, origin);
        const { runPhp } = require("./services/engineRunner");
        await runPhp(context, editor);
      } catch (err) {
        vscode.window.showErrorMessage("DevAssist PHP: erro ao documentar — " + err);
      }
    }),

    // Testes PHPUnit 
    vscode.commands.registerCommand("docgen.generateTests", async () => {
      const { oc: log } = require("./services/output");
      log.show(true);
      try {
        if (!await requireTestsEnabled()) return;
        if (!await requireApiKey(context)) return;
        const { generateAndRunTests } = require("./services/testRunner");
        await generateAndRunTests(context);
      } catch (err) {
        vscode.window.showErrorMessage("DevAssist PHP: erro ao gerar testes — " + err);
      }
    }),

    vscode.commands.registerCommand("docgen.runTests", async () => {
      const { oc: log } = require("./services/output");
      log.show(true);
      try {
        if (!await requireTestsEnabled()) return;
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) { vscode.window.showErrorMessage("Nenhum projeto aberto."); return; }
        const { runTestsOnly } = require("./services/testRunner");
        await runTestsOnly(workspace, context.extensionPath);
      } catch (err) {
        vscode.window.showErrorMessage("DevAssist PHP: erro ao executar testes — " + err);
      }
    }),

    // Git e GitHub
    vscode.commands.registerCommand("docgen.pushToGit", async () => {
      const { oc: log } = require("./services/output");
      log.show(true);
      try {
        const { pushToGit } = require("./services/git");
        const { autoDocumentFile } = require("./services/engineRunner");
        const { runTestsOnly } = require("./services/testRunner");
        await pushToGit(context, autoDocumentFile, runTestsOnly);
      } catch (err) {
        vscode.window.showErrorMessage("DevAssist PHP: erro no push — " + err);
      }
    }),

    vscode.commands.registerCommand("docgen.configurarGit", async () => {
      const { configurarGit } = require("./services/git");
      await configurarGit();
    }),

    // Dashboard 
    vscode.commands.registerCommand("docgen.openDashboard", async () => {
      try {
        const { openDashboard } = require("./services/dashboard");
        await openDashboard(context);
      } catch (err) {
        vscode.window.showErrorMessage("DevAssist PHP: erro ao abrir dashboard — " + err);
      }
    }),

    // n8n
    vscode.commands.registerCommand("docgen.setN8nWebhook", async () => {
      const { setN8nWebhook } = require("./services/secrets");
      await setN8nWebhook(context);
    }),

    vscode.commands.registerCommand("docgen.clearN8nWebhook", async () => {
      const { clearN8nWebhook } = require("./services/secrets");
      await clearN8nWebhook(context);
    }),

    vscode.commands.registerCommand("docgen.exportN8nWorkflow", async () => {
      const { exportN8nWorkflow } = require("./services/n8nExporter");
      await exportN8nWorkflow(context);
    }),

    // Configurações de credenciais
    vscode.commands.registerCommand("docgen.setApiKey", async () => {
      const { setApiKey } = require("./services/secrets");
      await setApiKey(context);
    }),

    vscode.commands.registerCommand("docgen.clearApiKey", async () => {
      const { clearApiKey } = require("./services/secrets");
      await clearApiKey(context);
    }),

    vscode.commands.registerCommand("docgen.setGithubToken", async () => {
      const { setGithubToken } = require("./services/secrets");
      await setGithubToken(context);
    }),

    vscode.commands.registerCommand("docgen.clearGithubToken", async () => {
      const { clearGithubToken } = require("./services/secrets");
      await clearGithubToken(context);
    }),

  );
}

function deactivate() { }

module.exports = { activate, deactivate };
