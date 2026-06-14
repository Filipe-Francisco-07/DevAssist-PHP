const vscode = require("vscode");
const { getConfig } = require("./config");

const SECRET_LLM_API_KEY   = "docgen.llm_api_key";
const SECRET_GITHUB_TOKEN  = "docgen.github_token";
const SECRET_N8N_WEBHOOK   = "docgen.n8n_webhook_url";

/**
 * Recupera a API key do LLM armazenada nos secrets do VSCode.
 * Faz fallback para a chave legada (docgen.openai_api_key) caso exista.
 *
 * @param {import("vscode").ExtensionContext} context
 * @returns {Promise<string|undefined>}
 */
async function getApiKey(context) {
  return (await context.secrets.get(SECRET_LLM_API_KEY));
}

/**
 * Solicita ao usuário e armazena a API key do LLM configurado.
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function setApiKey(context) {
  const { env } = getConfig();
  const label = env.LLM_PROVIDER === "gemini" ? "Google Gemini API Key" : "OpenAI API Key";

  const key = await vscode.window.showInputBox({
    prompt: `Informe sua ${label}`,
    password: true
  });

  if (!key) return;

  await context.secrets.store(SECRET_LLM_API_KEY, key);
  vscode.window.showInformationMessage("API Key salva com sucesso.");
}

/**
 * Remove a API key armazenada (nova e legada).
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function clearApiKey(context) {
  await context.secrets.delete(SECRET_LLM_API_KEY);
  vscode.window.showInformationMessage("API Key removida.");
}

/**
 * Recupera o GitHub Personal Access Token armazenado.
 *
 * @param {import("vscode").ExtensionContext} context
 * @returns {Promise<string|undefined>}
 */
async function getGithubToken(context) {
  return context.secrets.get(SECRET_GITHUB_TOKEN);
}

/**
 * Solicita ao usuário e armazena o GitHub Personal Access Token.
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function setGithubToken(context) {
  const token = await vscode.window.showInputBox({
    prompt: "Informe seu GitHub Personal Access Token (escopos: repo + actions)",
    password: true
  });

  if (!token) return;

  await context.secrets.store(SECRET_GITHUB_TOKEN, token);
  vscode.window.showInformationMessage("GitHub token salvo.");
}

/**
 * Recupera a URL do webhook n8n armazenada.
 *
 * @param {import("vscode").ExtensionContext} context
 * @returns {Promise<string|undefined>}
 */
async function getN8nWebhook(context) {
  return context.secrets.get(SECRET_N8N_WEBHOOK);
}

/**
 * Solicita ao usuário e armazena a URL do webhook n8n.
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function setN8nWebhook(context) {
  const url = await vscode.window.showInputBox({
    prompt: "Informe a URL do webhook n8n (ex: https://seu-n8n.cloud/webhook/...)",
    placeHolder: "https://...",
  });

  if (!url) return;

  await context.secrets.store(SECRET_N8N_WEBHOOK, url);
  vscode.window.showInformationMessage("Webhook n8n salvo com sucesso.");
}

/**
 * Remove a URL do webhook n8n armazenada.
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function clearN8nWebhook(context) {
  await context.secrets.delete(SECRET_N8N_WEBHOOK);
  vscode.window.showInformationMessage("Webhook n8n removido.");
}

/**
 * Remove o GitHub Personal Access Token armazenado.
 *
 * @param {import("vscode").ExtensionContext} context
 */
async function clearGithubToken(context) {
  await context.secrets.delete(SECRET_GITHUB_TOKEN);
  vscode.window.showInformationMessage("GitHub Token removido.");
}

module.exports = { getApiKey, setApiKey, clearApiKey, getGithubToken, setGithubToken, clearGithubToken, getN8nWebhook, setN8nWebhook, clearN8nWebhook };
