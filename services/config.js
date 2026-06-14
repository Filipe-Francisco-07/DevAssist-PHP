const vscode = require("vscode");

/**
 * Lê as configurações da extensão do VSCode.
 *
 * Suporta as configurações legadas OPENAI_* para retrocompatibilidade,
 * priorizando as novas configurações LLM_*.
 *
 * @returns {{ phpPath: string, env: { LLM_PROVIDER: string, LLM_MODEL: string, LLM_BASE: string } }}
 */
function getConfig() {
  const cfg = vscode.workspace.getConfiguration("phpDocgen");

  return {
    phpPath: cfg.get("php.path", "php"),
    env: {
      LLM_PROVIDER: cfg.get("llm.provider", "openai"),
      LLM_MODEL: cfg.get("llm.model", ""),
      LLM_BASE:  cfg.get("llm.base",  ""),
    }
  };
}

module.exports = { getConfig };
