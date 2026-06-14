const https = require("https");
const sodium = require("libsodium-wrappers");

/**
 * Realiza uma requisição HTTP à API do GitHub.
 *
 * @param {string} method  Método HTTP (GET, PUT, POST, etc.)
 * @param {string} apiPath Caminho da API (ex: /repos/owner/repo/actions/secrets/public-key)
 * @param {string} token   GitHub Personal Access Token
 * @param {object} [body]  Corpo da requisição (será serializado como JSON)
 * @returns {Promise<object>}
 */
function ghRequest(method, apiPath, token, body) {
  const data = body ? JSON.stringify(body) : null;

  const options = {
    hostname: "api.github.com",
    path: apiPath,
    method,
    headers: {
      "User-Agent": "docgen-extension",
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "Content-Length": data ? Buffer.byteLength(data) : 0
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let chunks = "";
      res.on("data", d => chunks += d);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(chunks ? JSON.parse(chunks) : {});
        } else {
          reject(new Error(`GitHub API ${res.statusCode}: ${chunks}`));
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Cria ou atualiza um secret no repositório GitHub usando libsodium.
 *
 * @param {string} owner        Owner do repositório
 * @param {string} repo         Nome do repositório
 * @param {string} githubToken  GitHub PAT com escopo repo+actions
 * @param {string} name         Nome do secret (ex: LLM_API_KEY)
 * @param {string} value        Valor do secret em texto plano
 */
async function setGithubSecret(owner, repo, githubToken, name, value) {
  const keyData = await ghRequest(
    "GET",
    `/repos/${owner}/${repo}/actions/secrets/public-key`,
    githubToken
  );

  const { key, key_id } = keyData;

  await sodium.ready;

  const messageBytes  = Buffer.from(value);
  const keyBytes      = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  const encrypted     = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);

  await ghRequest(
    "PUT",
    `/repos/${owner}/${repo}/actions/secrets/${name}`,
    githubToken,
    { encrypted_value: encrypted, key_id }
  );
}

/**
 * Cria um repositório no GitHub.
 *
 * @param {string} token     GitHub PAT
 * @param {string} name      Nome do repositório
 * @param {boolean} isPrivate Repositório privado?
 * @returns {Promise<object>} Dados do repositório criado
 */
async function createGithubRepo(token, name, isPrivate = false) {
  return ghRequest("POST", "/user/repos", token, {
    name,
    private: isPrivate,
    auto_init: false,
  });
}

module.exports = { ghRequest, setGithubSecret, createGithubRepo };
