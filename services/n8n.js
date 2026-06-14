const https = require("https");
const http  = require("http");
const { URL } = require("url");
const { oc }  = require("./output");

/**
 * Envia uma notificação POST para o webhook do n8n.
 *
 * @param {string} webhookUrl URL do webhook configurada pelo usuário
 * @param {object} payload    Dados do evento a enviar
 * @returns {Promise<void>}
 */
function sendNotification(webhookUrl, payload) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      oc.appendLine("[n8n] URL de webhook inválida: " + webhookUrl);
      resolve();
      return;
    }

    const body = JSON.stringify({ ...payload, timestamp: new Date().toISOString() });

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.request(options, (res) => {
      oc.appendLine(`[n8n] Webhook enviado → HTTP ${res.statusCode}`);
      res.resume();
      resolve();
    });

    req.on("error", (err) => {
      oc.appendLine("[n8n] Erro ao enviar webhook: " + err.message);
      resolve();
    });

    req.setTimeout(8000, () => {
      oc.appendLine("[n8n] Timeout ao enviar webhook.");
      req.destroy();
      resolve();
    });

    req.write(body);
    req.end();
  });
}

/**
 * Notifica o n8n sobre um evento de push concluído.
 *
 * @param {string} webhookUrl
 * @param {{ repo: string, branch: string, sha: string, docsUrl: string }} info
 */
async function notifyPush(webhookUrl, info) {
  if (!webhookUrl) return;
  await sendNotification(webhookUrl, { event: "push", ...info });
}

/**
 * Notifica o n8n sobre o resultado de uma execução de testes.
 *
 * @param {string} webhookUrl
 * @param {{ repo: string, branch: string, passed: number, failed: number, skipped: number, success: boolean }} info
 */
async function notifyTests(webhookUrl, info) {
  if (!webhookUrl) return;
  await sendNotification(webhookUrl, { event: "test_result", ...info });
}

/**
 * Notifica o n8n sobre documentação gerada com sucesso.
 *
 * @param {string} webhookUrl
 * @param {{ repo: string, branch: string, filesDocumented: number }} info
 */
async function notifyDocs(webhookUrl, info) {
  if (!webhookUrl) return;
  await sendNotification(webhookUrl, { event: "docs_generated", ...info });
}

module.exports = { notifyPush, notifyTests, notifyDocs };
