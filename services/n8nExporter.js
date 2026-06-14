const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

/**
 * Gera e salva um workflow n8n personalizado com o email e webhook URL do usuário.
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function exportN8nWorkflow(context) {
  const cfg = vscode.workspace.getConfiguration("phpDocgen");
  let email = cfg.get("notificationEmail", "").trim();

  if (!email) {
    const input = await vscode.window.showInputBox({
      prompt: "Email que receberá as notificações do n8n",
      placeHolder: "seu@gmail.com",
    });
    if (!input) return;
    email = input.trim();
    await cfg.update("notificationEmail", email, vscode.ConfigurationTarget.Global);
  }

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const defaultUri = workspace
    ? vscode.Uri.file(path.join(workspace, "n8n-workflow.json"))
    : undefined;

  const dest = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { JSON: ["json"] },
    title: "Salvar workflow n8n personalizado",
  });

  if (!dest) return;

  const templatePath = path.join(context.extensionPath, "n8n-workflow.json");
  let template;
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    vscode.window.showErrorMessage("DevAssist PHP: template n8n-workflow.json não encontrado.");
    return;
  }

  const personalized = template
    .replace(/seu@email\.com/g, email);

  fs.writeFileSync(dest.fsPath, personalized, "utf8");

  const open = await vscode.window.showInformationMessage(
    `Workflow n8n exportado para ${path.basename(dest.fsPath)} com o email ${email}.`,
    "Abrir arquivo"
  );

  if (open === "Abrir arquivo") {
    vscode.window.showTextDocument(dest);
  }
}

module.exports = { exportN8nWorkflow };
