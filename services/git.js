const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { oc } = require("./output");
const { getConfig } = require("./config");
const { getApiKey, getGithubToken, getN8nWebhook } = require("./secrets");
const { setGithubSecret, createGithubRepo, ghRequest } = require("./github");
const { notifyPush } = require("./n8n");

/**
 * Executa um comando shell e retorna stdout como Promise.
 *
 * @param {string} cmd  Comando a executar
 * @param {string} cwd  Diretório de trabalho
 * @returns {Promise<string>}
 */
function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(stderr || err.message);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Extrai owner e repo da URL remota do git.
 *
 * @param {string} workspace Caminho do workspace
 * @returns {Promise<{ owner: string, repo: string }>}
 */
async function getRepoInfo(workspace) {
  const url = (await run("git config --get remote.origin.url", workspace)).trim();
  const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
  if (!m) throw new Error("Não foi possível detectar owner/repo da URL do GitHub.");
  return { owner: m[1], repo: m[2] };
}

/**
 * Garante que as dependências do composer estão instaladas.
 *
 * @param {string} dir Diretório que contém composer.json
 */
async function ensureComposerInstall(dir) {
  if (!fs.existsSync(path.join(dir, "composer.json"))) return;

  const autoload = path.join(dir, "vendor", "autoload.php");
  if (fs.existsSync(autoload)) return;

  const composerAvailable = await run("composer --version", dir).then(() => true).catch(() => false);
  if (!composerAvailable) {
    vscode.window.showErrorMessage(
      "DevAssist PHP: Composer não encontrado. Instale em https://getcomposer.org e reabra o VS Code."
    );
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "DevAssist PHP: instalando dependências PHP...", cancellable: false },
    async () => {
      try {
        await run("composer install --no-interaction --no-progress", dir);
        oc.appendLine("[DevAssist] Dependências PHP instaladas.");
      } catch (err) {
        oc.appendLine("[DevAssist] Erro no composer install: " + err);
        vscode.window.showErrorMessage("DevAssist PHP: falha ao instalar dependências. Veja o painel OUTPUT.");
      }
    }
  );
}

/**
 * Cria o workflow do GitHub Actions (ci.yml) se ainda não existir.
 *
 * @param {string} workspace
 */
async function ensureWorkflow(workspace) {
  const wfDir = path.join(workspace, ".github", "workflows");
  const wfFile = path.join(wfDir, "ci.yml");

  if (fs.existsSync(wfFile)) {
    const existing = await fs.promises.readFile(wfFile, "utf8");
    if (!existing.includes("working-directory: engine") && existing.includes("actions/deploy-pages")) {
      oc.appendLine("Workflow ci.yml já existe.");
      return;
    }
    oc.appendLine("Atualizando workflow ci.yml (template desatualizado detectado)...");
  }

  oc.appendLine("Criando workflow do GitHub Actions...");

  await fs.promises.mkdir(wfDir, { recursive: true });

  const workflow = `name: DevAssist PHP Pipeline

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest

    env:
      LLM_API_KEY:  \${{ secrets.LLM_API_KEY }}
      LLM_PROVIDER: \${{ secrets.LLM_PROVIDER }}
      LLM_MODEL:    \${{ secrets.LLM_MODEL }}

    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: "8.2"
          tools: composer

      - name: Instalar dependências
        if: \${{ hashFiles('composer.json') != '' }}
        run: composer install --no-interaction --no-progress

      - name: Executar testes unitários
        if: \${{ hashFiles('phpunit.xml', 'phpunit.xml.dist') != '' }}
        run: vendor/bin/phpunit --colors=never

      - name: Gerar documentação (phpDocumentor)
        run: |
          curl -sL https://phpdoc.org/phpDocumentor.phar -o phpdoc.phar
          mkdir -p docs
          if [ -d src ]; then
            php phpdoc.phar run --directory=src --target=docs --template=default --title="API Documentation" 2>/dev/null || true
          else
            php phpdoc.phar run --directory=. --ignore=vendor,tests,docs,node_modules --target=docs --template=default --title="API Documentation" 2>/dev/null || true
          fi

      - name: Configurar GitHub Pages
        if: github.event_name != 'pull_request'
        uses: actions/configure-pages@v5

      - name: Upload artefato do Pages
        if: github.event_name != 'pull_request'
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs

  deploy:
    needs: build
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    environment:
      name: "github-pages"
      url: \${{ steps.deployment.outputs.page_url }}

    steps:
      - name: Publicar no GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

  await fs.promises.writeFile(wfFile, workflow);
  oc.appendLine("Workflow criado: " + wfFile);
}

/**
 * Garante que existe um .gitignore PHP básico no workspace.
 *
 * @param {string} workspace
 */
async function ensureGitignore(workspace) {
  const file = path.join(workspace, ".gitignore");
  if (fs.existsSync(file)) return;

  const content = [
    "vendor/",
    "node_modules/",
    ".env",
    ".env.local",
    "*.log",
    "*.cache",
    "/coverage/",
    "/.phpunit.cache/",
    "n8n-workflow.json",
  ].join("\n") + "\n";

  await fs.promises.writeFile(file, content, "utf8");
  oc.appendLine("[DevAssist] .gitignore criado.");
}

/**
 * Configura nome e email do git automaticamente a partir do GitHub Token, caso ainda não estejam definidos no repositório.
 *
 * @param {string} workspace
 * @param {string} githubToken
 */
async function ensureGitUser(workspace, githubToken) {
  const name = await run("git config user.name", workspace).catch(() => "");
  const email = await run("git config user.email", workspace).catch(() => "");
  if (name.trim() && email.trim()) return;

  try {
    const https = require("https");
    const userData = await new Promise((resolve, reject) => {
      https.get({
        hostname: "api.github.com",
        path: "/user",
        headers: { "User-Agent": "devassist", "Authorization": `Bearer ${githubToken}`, "Accept": "application/vnd.github+json" }
      }, res => {
        let out = "";
        res.on("data", d => out += d);
        res.on("end", () => resolve(JSON.parse(out)));
      }).on("error", reject);
    });

    if (!name.trim() && userData.name) await run(`git config user.name "${userData.name}"`, workspace).catch(() => { });
    if (!email.trim() && userData.email) await run(`git config user.email "${userData.email}"`, workspace).catch(() => { });
    if (!email.trim() && !userData.email && userData.login) {
      await run(`git config user.email "${userData.login}@users.noreply.github.com"`, workspace).catch(() => { });
    }
    oc.appendLine("[DevAssist] Git user configurado via GitHub.");
  } catch {

  }
}

/**
 * Verifica se o remote origin tem commits (branches) publicados.
 *
 * @param {string} workspace
 * @returns {Promise<boolean>}
 */
async function remoteHasCommits(workspace) {
  try {
    const refs = (await run("git ls-remote --heads origin", workspace)).trim();
    return refs.length > 0;
  } catch {
    return false;
  }
}

/**
 * Verifica se um remote GitHub é acessível sem disparar git ls-remote.
 *
 * @param {string} remoteUrl
 * @param {import("vscode").ExtensionContext} context
 * @returns {Promise<boolean>}
 */
async function checkRemoteReachable(remoteUrl, context) {
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
  if (!m) {
    return run(`git ls-remote --heads "${remoteUrl}"`, process.cwd())
      .then(() => true).catch(() => false);
  }

  const [, owner, repo] = m;
  const token = await getGithubToken(context);

  if (token) {
    try {
      await ghRequest("GET", `/repos/${owner}/${repo}`, token);
      return true;
    } catch {
      return false;
    }
  }

  return run(`git ls-remote --heads "${remoteUrl}"`, process.cwd())
    .then(() => true).catch(() => false);
}

/**
 * Garante que o repositório local possui um remote "origin" configurado.
 * Se não houver, cria automaticamente no GitHub (token obrigatório)
 * ou permite informar URL manualmente.
 *
 * @param {import("vscode").ExtensionContext} context
 * @param {string} workspace
 * @returns {Promise<boolean>}
 */
async function ensureRemote(context, workspace) {
  try {
    await run("git rev-parse --git-dir", workspace);
  } catch {
    try { await run("git init -b main", workspace); } catch { await run("git init", workspace); }
    oc.appendLine("[DevAssist] Repositório git inicializado.");
  }

  const remoteUrl = await run("git remote get-url origin", workspace).catch(() => "");
  if (remoteUrl.trim()) {
    const reachable = await checkRemoteReachable(remoteUrl.trim(), context);
    if (reachable) return true;

    oc.appendLine("[DevAssist] Remote configurado mas inacessível — reconfigurando...");
    await run("git remote remove origin", workspace).catch(() => { });
  }

  const githubToken = await getGithubToken(context);

  if (githubToken) {
    const repoName = await vscode.window.showInputBox({
      prompt: "Nome do repositório no GitHub (será criado automaticamente)",
      value: path.basename(workspace).replace(/\s+/g, "-"),
      validateInput: v => (v && v.trim()) ? null : "Informe um nome válido.",
    });
    if (!repoName) return false;

    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "DevAssist PHP: criando repositório no GitHub...", cancellable: false },
      async () => {
        try {
          const repo = await createGithubRepo(githubToken, repoName.trim(), false);
          await run(`git remote add origin ${repo.clone_url}`, workspace);
          try { await run("git branch -M main", workspace); } catch { /* sem commits ainda */ }

          try {
            await ghRequest("POST", `/repos/${repo.full_name}/pages`, githubToken, { build_type: "workflow" });
            oc.appendLine("[DevAssist] GitHub Pages ativado via Actions.");
          } catch (pagesErr) {
            oc.appendLine("[DevAssist] Pages (aviso): " + (pagesErr.message || pagesErr));
          }

          oc.appendLine(`[DevAssist] Repositório criado: ${repo.html_url}`);
          vscode.window.showInformationMessage(`Repositório criado: ${repo.html_url}`);
          return true;
        } catch (err) {
          if (err.message && err.message.includes("401")) {
            const fix = await vscode.window.showErrorMessage(
              "GitHub Token inválido ou sem permissão. Reconfigure o token e tente novamente.",
              "Reconfigurar Token"
            );
            if (fix) await vscode.commands.executeCommand("docgen.setGithubToken");
          } else {
            vscode.window.showErrorMessage("Erro ao criar repositório: " + err.message);
          }
          return false;
        }
      }
    );
  }

  const action = await vscode.window.showWarningMessage(
    "Nenhum repositório remoto configurado. Configure o GitHub Token para criar automaticamente.",
    "Configurar Token"
  );

  if (!action) return false;

  await vscode.commands.executeCommand("docgen.setGithubToken");
  const newToken = await getGithubToken(context);
  if (!newToken) return false;

  return ensureRemote(context, workspace);
}

/**
 * Fluxo completo de push: atualiza secrets, documenta, roda testes, commita e envia ao GitHub.
 *
 * @param {import("vscode").ExtensionContext} context
 * @param {Function} autoDocumentFile Função de auto-documentação (evita dependência circular)
 * @param {Function} [runTestsOnly]   Função para rodar testes (opcional, evita dependência circular)
 */
async function pushToGit(context, autoDocumentFile, runTestsOnly) {
  oc.clear();
  oc.appendLine("[DevAssist] Iniciando push...");
  oc.show(true);

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspace) {
    vscode.window.showErrorMessage("Nenhum projeto aberto.");
    return;
  }

  oc.appendLine("Workspace: " + workspace);

  const remoteOk = await ensureRemote(context, workspace);
  if (!remoteOk) {
    oc.appendLine("Push cancelado: sem repositório remoto configurado.");
    return;
  }

  try {
    const githubToken = await getGithubToken(context);
    const apiKey = await getApiKey(context);

    if (!githubToken) {
      oc.appendLine("GitHub token não configurado. Use 'DevAssist PHP → Configurar GitHub Token'.");
    } else {
      const { owner, repo } = await getRepoInfo(workspace);
      const { env } = getConfig();

      oc.appendLine(`Atualizando secrets em ${owner}/${repo}...`);

      if (apiKey) {
        await setGithubSecret(owner, repo, githubToken, "LLM_API_KEY", apiKey);
        await setGithubSecret(owner, repo, githubToken, "LLM_PROVIDER", env.LLM_PROVIDER || "openai");
        if (env.LLM_MODEL) {
          await setGithubSecret(owner, repo, githubToken, "LLM_MODEL", env.LLM_MODEL);
        }
      }

      const webhookUrl = await getN8nWebhook(context);
      if (webhookUrl) {
        await setGithubSecret(owner, repo, githubToken, "N8N_WEBHOOK_URL", webhookUrl);
      }

      oc.appendLine("Secrets atualizados.");
    }
  } catch (err) {
    oc.appendLine("Erro ao atualizar secrets: " + err);
  }

  const engineDir = path.join(context.extensionPath, "engine");
  await ensureComposerInstall(engineDir);
  await ensureGitignore(workspace);
  await ensureWorkflow(workspace);

  const autoDoc = vscode.workspace.getConfiguration("phpDocgen").get("autoDocumentOnCommit", true);

  if (autoDoc && autoDocumentFile) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const changed = await autoDocumentFile(context, editor);
      if (changed) await new Promise(r => setTimeout(r, 500));
    }
  }

  const cfg2 = vscode.workspace.getConfiguration("phpDocgen");
  const runTestsBeforePush = cfg2.get("runTestsBeforePush", false) && cfg2.get("tests.enabled", true);

  if (runTestsBeforePush && runTestsOnly) {
    oc.appendLine("Executando testes antes do commit...");
    const result = await runTestsOnly(workspace, context.extensionPath);
    oc.appendLine(result.output);
    oc.appendLine(`Resultado: ${result.passed} passou | ${result.failed} falhou | ${result.skipped} pulado`);

    if (!result.success) {
      const proceed = await vscode.window.showWarningMessage(
        `${result.failed} teste(s) falharam. Deseja continuar com o push?`,
        "Continuar",
        "Cancelar"
      );
      if (proceed !== "Continuar") {
        oc.appendLine("Push cancelado: testes falharam.");
        return;
      }
    }
  }

  try {
    await run("git add .", workspace);

    const status = await run("git status --porcelain", workspace);
    const hasChanges = !!status.trim();

    const hasUpstream = await run("git rev-parse --abbrev-ref --symbolic-full-name @{u}", workspace)
      .then(() => true).catch(() => false);

    if (!hasChanges && hasUpstream) {
      oc.appendLine("Nada para commitar (working tree limpa).");
      vscode.window.showInformationMessage("DevAssist PHP: nada para commitar.");
      return;
    }

    const githubToken = await getGithubToken(context);
    if (githubToken) await ensureGitUser(workspace, githubToken);

    let message;

    if (hasChanges) {
      let autoMsg = "update";
      try {
        const diffStat = await run("git diff --cached --stat", workspace);
        const filesN = (diffStat.match(/(\d+) file/) ?? [])[1];
        if (filesN) autoMsg = `update: ${filesN} arquivo(s) modificado(s)`;
      } catch { /* usa padrão */ }

      message = await vscode.window.showInputBox({
        prompt: "Mensagem do commit (Enter para confirmar)",
        value: autoMsg,
      });

      if (!message) {
        oc.appendLine("Commit cancelado.");
        return;
      }

      await run(`git commit -m "${message.replace(/"/g, '\\"')}"`, workspace);
    } else {
      message = (await run("git log --format=%s -1", workspace).catch(() => "initial commit")).trim();
      oc.appendLine("[DevAssist] Sem mudanças locais — enviando commit atual para o remoto.");
    }

    if (!hasUpstream) {
      const remoteRefs = await run("git ls-remote --heads origin", workspace).catch(() => "");
      const remoteIsEmpty = !remoteRefs.trim();

      if (remoteIsEmpty) {
        const safeMsg = message.replace(/"/g, '\\"');
        const temp = "_da_" + Date.now();
        await run(`git checkout --orphan ${temp}`, workspace);
        await run("git add -A", workspace);
        await run(`git commit -m "${safeMsg}"`, workspace);
        const orphanSha = (await run("git rev-parse HEAD", workspace)).trim();
        await run(`git push origin ${temp}:main`, workspace);
        await run("git checkout main", workspace);
        await run(`git reset --hard ${orphanSha}`, workspace);
        await run(`git branch -D ${temp}`, workspace);
      } else {
        await run("git push -u origin main", workspace).catch(async () => {
          await run("git push -u origin main --force", workspace);
        });
      }
      await run("git branch --set-upstream-to=origin/main main", workspace).catch(() => { });
    } else {
      try {
        await run("git pull --rebase", workspace);
      } catch (pullErr) {
        oc.appendLine("Erro ao sincronizar com remoto: " + pullErr);
        vscode.window.showErrorMessage("Conflito ao sincronizar com o remoto. Resolva manualmente e tente de novo.");
        return;
      }
      await run("git push -u origin main", workspace);
    }

    vscode.window.showInformationMessage("Projeto enviado para o GitHub.");

    const cfg = vscode.workspace.getConfiguration("phpDocgen");
    if (cfg.get("n8n.notifyOnPush", true)) {
      const webhookUrl = await getN8nWebhook(context);
      if (webhookUrl) {
        try {
          const branch = (await run("git rev-parse --abbrev-ref HEAD", workspace)).trim();
          const sha = (await run("git rev-parse --short HEAD", workspace)).trim();
          const commitMsg = (await run("git log --format=%s -1", workspace)).trim();
          const author = (await run("git log --format=%an -1", workspace)).trim();
          const authorEmail = (await run("git log --format=%ae -1", workspace)).trim();
          const numstat = await run("git show --numstat HEAD", workspace).catch(() => "");
          const numLines = numstat.trim().split("\n").filter(l => /^\d/.test(l));
          const filesChanged = String(numLines.length || 0);
          const insertions = String(numLines.reduce((s, l) => s + (parseInt(l.split("\t")[0]) || 0), 0));
          const deletions = String(numLines.reduce((s, l) => s + (parseInt(l.split("\t")[1]) || 0), 0));
          const remoteUrl = (await run("git config --get remote.origin.url", workspace)).trim();
          const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
          const repoName = m ? `${m[1]}/${m[2]}` : workspace;
          const repoUrl = m ? `https://github.com/${m[1]}/${m[2]}` : "";
          const commitUrl = m ? `${repoUrl}/commit/${sha}` : "";
          const actionsUrl = m ? `${repoUrl}/actions` : "";
          const docsUrl = m ? `https://${m[1].toLowerCase()}.github.io/${m[2]}` : "";

          await notifyPush(webhookUrl, {
            repo: repoName, branch, sha,
            commitMessage: commitMsg, author, authorEmail,
            filesChanged, insertions, deletions,
            repoUrl, commitUrl, actionsUrl, docsUrl,
          });
          oc.appendLine("[n8n] Notificação de push enviada.");
        } catch (e) {
          oc.appendLine("[n8n] Falha ao notificar: " + e);
        }
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage("Erro ao enviar para o Git: " + err);
  }
}

/**
 * Configura nome e email do git no repositório atual.
 */
async function configurarGit() {
  const name = await vscode.window.showInputBox({ prompt: "Nome do usuário Git" });
  const email = await vscode.window.showInputBox({ prompt: "Email do Git" });

  if (!name || !email) return;

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  try {
    await run(`git config user.name "${name}"`, workspace);
    await run(`git config user.email "${email}"`, workspace);
    vscode.window.showInformationMessage("Git configurado.");
  } catch {
    vscode.window.showErrorMessage("Erro ao configurar Git.");
  }
}

module.exports = {
  run,
  getRepoInfo,
  ensureComposerInstall,
  ensureGitignore,
  ensureGitUser,
  ensureWorkflow,
  ensureRemote,
  pushToGit,
  configurarGit,
};
