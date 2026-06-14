const vscode = require("vscode");
const path = require("path");
const cp = require("child_process");
const { run } = require("./git");
const { getConfig } = require("./config");
const { ghRequest } = require("./github");
const { getGithubToken } = require("./secrets");

// Coleta local (git)
async function collectGitStats(workspace) {
  const safe = async (cmd) => { try { return (await run(cmd, workspace)).trim(); } catch { return ""; } };

  const [totalCommits, branch, lastCommitRaw, authorsRaw, branchesRaw, tagsRaw] = await Promise.all([
    safe("git rev-list --count HEAD"),
    safe("git rev-parse --abbrev-ref HEAD"),
    safe('git log -1 --format="%h|||%s|||%an|||%ar"'),
    safe("git log --format=%ae | sort -u"),
    safe("git branch -a --list | wc -l"),
    safe("git tag | wc -l"),
  ]);

  const [hash, subject, author, when] = (lastCommitRaw || "|||").split("|||");

  return {
    totalCommits: parseInt(totalCommits) || 0,
    branch: branch || "main",
    contributors: authorsRaw ? authorsRaw.trim().split("\n").filter(Boolean).length : 0,
    branches: parseInt(branchesRaw) || 0,
    tags: parseInt(tagsRaw) || 0,
    lastCommit: { hash, subject, author, when },
  };
}

async function collectLocalExtra(workspace) {
  const safe = async (cmd) => { try { return (await run(cmd, workspace)).trim(); } catch { return ""; } };

  const [weekRaw, monthRaw, firstCommitRaw, topFilesRaw, dowRaw, addDelRaw] = await Promise.all([
    safe('git log --since="1 week ago" --oneline'),
    safe('git log --since="1 month ago" --oneline'),
    safe('git log --reverse --format="%ad" --date=format:"%d/%m/%Y" | head -1'),
    safe("git log --name-only --format= | sort | uniq -c | sort -rn | head -10"),
    safe("git log --format=%ad --date=format:%u"),
    safe("git log --since=\"4 weeks ago\" --shortstat --format="),
  ]);

  const topFiles = topFilesRaw.split("\n").filter(Boolean).map(line => {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    return m ? { count: parseInt(m[1]), file: m[2].trim() } : null;
  }).filter(Boolean);

  const dayCount = [0, 0, 0, 0, 0, 0, 0];
  dowRaw.split("\n").filter(Boolean).forEach(d => {
    const idx = parseInt(d) - 1;
    if (idx >= 0 && idx < 7) dayCount[idx]++;
  });

  let added = 0, deleted = 0;
  const adDelLines = addDelRaw.split("\n").filter(Boolean);
  adDelLines.forEach(line => {
    const a = line.match(/(\d+) insertion/); if (a) added += parseInt(a[1]);
    const d = line.match(/(\d+) deletion/); if (d) deleted += parseInt(d[1]);
  });

  return {
    commitsThisWeek: weekRaw ? weekRaw.split("\n").filter(Boolean).length : 0,
    commitsThisMonth: monthRaw ? monthRaw.split("\n").filter(Boolean).length : 0,
    firstCommit: firstCommitRaw || "—",
    topFiles,
    dayCount,
    linesAdded: added,
    linesDeleted: deleted,
  };
}

async function collectRecentCommits(workspace, n = 15) {
  try {
    const raw = await run(`git log -${n} --format="%h|||%s|||%an|||%ar|||%ae"`, workspace);
    return raw.trim().split("\n").filter(Boolean).map(line => {
      const [hash, subject, author, when, email] = line.split("|||");
      return { hash, subject, author, when, email };
    });
  } catch { return []; }
}

async function collectLastCommitFiles(workspace) {
  try {
    const raw = await run("git show --stat --format= HEAD", workspace);
    return raw.trim().split("\n").filter(l => l.includes("|")).map(line => {
      const [file, rest] = line.split("|");
      return { file: file.trim(), changes: (rest || "").trim() };
    });
  } catch { return []; }
}

async function collectDocCoverage(extensionPath, dir) {
  const { phpPath } = getConfig();
  const engineDir = path.join(extensionPath, "engine");
  const scriptPath = path.join(engineDir, "bin", "analyze.php");

  return new Promise(resolve => {
    const proc = cp.spawn(phpPath, [scriptPath, "--dir", dir], { cwd: engineDir, timeout: 30000 });
    let stdout = "";
    proc.stdout.on("data", d => { stdout += d; });
    proc.on("close", code => {
      if (code !== 0 || !stdout.trim()) { resolve(null); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
    proc.on("error", () => resolve(null));
  });
}

// Coleta API do GitHub
async function collectGithubData(token, owner, repo) {
  const safe = async (apiPath) => {
    try { return await ghRequest("GET", apiPath, token); } catch { return null; }
  };

  const [repoInfo, languages, runsData, releases, allIssues, pulls, contributors, punchcard] = await Promise.all([
    safe(`/repos/${owner}/${repo}`),
    safe(`/repos/${owner}/${repo}/languages`),
    safe(`/repos/${owner}/${repo}/actions/runs?per_page=8`),
    safe(`/repos/${owner}/${repo}/releases?per_page=5`),
    safe(`/repos/${owner}/${repo}/issues?state=open&per_page=10`),
    safe(`/repos/${owner}/${repo}/pulls?state=open&per_page=5`),
    safe(`/repos/${owner}/${repo}/contributors?per_page=8`),
    safe(`/repos/${owner}/${repo}/stats/punch_card`),
  ]);

  const issues = Array.isArray(allIssues)
    ? allIssues.filter(i => !i.pull_request).slice(0, 5)
    : [];

  return {
    repoInfo: repoInfo || null,
    languages: languages || {},
    runs: runsData?.workflow_runs || [],
    releases: Array.isArray(releases) ? releases : [],
    issues,
    pulls: Array.isArray(pulls) ? pulls : [],
    contributors: Array.isArray(contributors) ? contributors : [],
    punchcard: Array.isArray(punchcard) ? punchcard : [],
  };
}

// Painel Webview
/** @type {vscode.WebviewPanel|undefined} */
let panel;

async function openDashboard(context) {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) { vscode.window.showErrorMessage("Nenhum projeto aberto."); return; }

  if (panel) { panel.reveal(); await refreshDashboard(context, workspace); return; }

  panel = vscode.window.createWebviewPanel(
    "docgenDashboard", "DevAssist PHP — Dashboard",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
  panel.webview.html = buildLoadingHtml();

  await refreshDashboard(context, workspace);

  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.command === "refresh") {
      panel.webview.html = buildLoadingHtml();
      await refreshDashboard(context, workspace);
    }
  }, null, context.subscriptions);
}

async function refreshDashboard(context, workspace) {
  if (!panel) return;

  const { env } = getConfig();
  const githubToken = await getGithubToken(context);

  let owner = "", repoName = "";
  let docsUrl = "";
  try {
    const remoteUrl = (await run("git config --get remote.origin.url", workspace)).trim();
    const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
    if (m) {
      owner = m[1];
      repoName = m[2];
      docsUrl = `https://${m[1].toLowerCase()}.github.io/${m[2]}`;
    }
  } catch { }

  const [gitStats, localExtra, recentCommits, lastFiles, coverage, ghData] = await Promise.all([
    collectGitStats(workspace),
    collectLocalExtra(workspace),
    collectRecentCommits(workspace),
    collectLastCommitFiles(workspace),
    collectDocCoverage(context.extensionPath, workspace),
    (githubToken && owner && repoName)
      ? collectGithubData(githubToken, owner, repoName)
      : Promise.resolve(null),
  ]);

  panel.webview.html = buildDashboardHtml({
    workspace,
    gitStats,
    localExtra,
    recentCommits,
    lastFiles,
    coverage,
    provider: env.LLM_PROVIDER || "openai",
    docsUrl,
    ghData,
    hasToken: !!githubToken,
  });
}

// HTML helpers
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function coverageBadge(pct) {
  if (pct >= 80) return `<span class="badge badge-green">${pct}%</span>`;
  if (pct >= 50) return `<span class="badge badge-yellow">${pct}%</span>`;
  return `<span class="badge badge-red">${pct}%</span>`;
}

function ciStatusBadge(run) {
  if (run.status === "in_progress" || run.status === "queued") {
    return `<span class="badge badge-yellow">⏳ em execução</span>`;
  }
  const c = run.conclusion;
  if (c === "success") return `<span class="badge badge-green">✓ sucesso</span>`;
  if (c === "failure") return `<span class="badge badge-red">✗ falhou</span>`;
  if (c === "cancelled") return `<span class="badge" style="background:#55555540;color:#888">⊘ cancelado</span>`;
  if (c === "skipped") return `<span class="badge" style="background:#55555540;color:#888">— pulado</span>`;
  return `<span class="badge" style="background:#55555540;color:#888">${escHtml(c || run.status)}</span>`;
}

function timeAgo(isoDate) {
  if (!isoDate) return "—";
  const diff = Date.now() - new Date(isoDate).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function fmtDate(isoDate) {
  if (!isoDate) return "—";
  return new Date(isoDate).toLocaleDateString("pt-BR");
}

function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

const LANG_COLORS = {
  PHP: "#4F5D95", JavaScript: "#f1e05a", TypeScript: "#3178c6",
  HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051",
  Python: "#3572A5", Go: "#00ADD8", Ruby: "#701516",
  Java: "#b07219", Rust: "#dea584", Dockerfile: "#384d54",
  YAML: "#cb171e", Makefile: "#427819", Blade: "#f7523f",
};

function buildLoadingHtml() {
  return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <div style="text-align:center;opacity:0.6">
      <div style="font-size:2em;margin-bottom:8px">⟳</div>
      <p>Carregando dados do repositório...</p>
    </div>
  </body></html>`;
}

// HTML builder principal
function buildDashboardHtml({ workspace, gitStats, localExtra, recentCommits, lastFiles, coverage, provider, docsUrl, ghData, hasToken }) {
  const repoLabel = path.basename(workspace);
  const gh = ghData;

  const providerLabel = provider === "gemini"
    ? `<span class="badge badge-green">Gemini</span>`
    : `<span class="badge" style="background:#10a37f26;color:#10a37f">OpenAI</span>`;

  // Extras do header do GitHub
  const ghStars = gh?.repoInfo?.stargazers_count ?? null;
  const ghForks = gh?.repoInfo?.forks_count ?? null;
  const ghWatchers = gh?.repoInfo?.watchers_count ?? null;
  const ghIssues = gh?.repoInfo?.open_issues_count ?? null;
  const ghDesc = gh?.repoInfo?.description ?? "";
  const ghLicense = gh?.repoInfo?.license?.spdx_id ?? "";
  const ghPrivate = gh?.repoInfo?.private;
  const ghSize = gh?.repoInfo?.size ? Math.round(gh.repoInfo.size / 1024 * 10) / 10 + " MB" : null;
  const ghDefaultBranch = gh?.repoInfo?.default_branch ?? "";
  const ghHomepage = gh?.repoInfo?.homepage ?? "";

  const ghMetaLine = [
    ghLicense ? `📄 ${escHtml(ghLicense)}` : "",
    ghSize ? `💾 ${escHtml(ghSize)}` : "",
    ghPrivate != null ? (ghPrivate ? `🔒 Privado` : `🌐 Público`) : "",
    ghHomepage ? `<a href="${escHtml(ghHomepage)}" style="color:var(--vscode-textLink-foreground)">${escHtml(ghHomepage)}</a>` : "",
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  // Grid de estatísticas
  const statCards = [
    { label: "Commits", value: fmtNum(gitStats.totalCommits) },
    { label: "Contribuidores", value: fmtNum(gitStats.contributors) },
    { label: "Branches", value: fmtNum(gitStats.branches) },
    { label: "Tags", value: fmtNum(gitStats.tags) },
    { label: "Esta semana", value: fmtNum(localExtra.commitsThisWeek) },
    { label: "Este mês", value: fmtNum(localExtra.commitsThisMonth) },
    { label: "⭐ Stars", value: fmtNum(ghStars) },
    { label: "🍴 Forks", value: fmtNum(ghForks) },
    { label: "👁 Watchers", value: fmtNum(ghWatchers) },
    { label: "🐛 Issues abertas", value: fmtNum(ghIssues) },
  ];
  const visibleCards = hasToken ? statCards : statCards.slice(0, 6);
  const statsHtml = visibleCards.map(s => `
    <div class="stat-card">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join("");

  // Linhas adicionadas/removidas
  const linesHtml = `
    <div class="two-col" style="gap:8px;margin-top:10px">
      <div class="mini-stat">
        <span style="color:#3fb950;font-weight:700">+${fmtNum(localExtra.linesAdded)}</span>
        <span class="mini-label">linhas adicionadas (4 sem.)</span>
      </div>
      <div class="mini-stat">
        <span style="color:#f85149;font-weight:700">-${fmtNum(localExtra.linesDeleted)}</span>
        <span class="mini-label">linhas removidas (4 sem.)</span>
      </div>
      <div class="mini-stat">
        <span style="color:var(--vscode-foreground);opacity:0.8;font-weight:700">${escHtml(localExtra.firstCommit)}</span>
        <span class="mini-label">primeiro commit</span>
      </div>
    </div>`;

  // Descrição do GitHub
  const descSection = (ghDesc || ghMetaLine) ? `
  <div class="section">
    <p class="section-title">Repositório</p>
    ${ghDesc ? `<p style="margin:0 0 8px;font-size:0.95em">${escHtml(ghDesc)}</p>` : ""}
    ${ghMetaLine ? `<p style="margin:0;font-size:0.82em;opacity:0.7">${ghMetaLine}</p>` : ""}
  </div>` : "";

  // Linguagens
  let languagesSection = "";
  if (gh?.languages && Object.keys(gh.languages).length) {
    const total = Object.values(gh.languages).reduce((a, b) => a + b, 0);
    const langBars = Object.entries(gh.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang, bytes]) => {
        const pct = Math.round(bytes / total * 100);
        const color = LANG_COLORS[lang] || "#888";
        return `
        <div class="lang-row">
          <span class="lang-name">${escHtml(lang)}</span>
          <div class="lang-bar-bg">
            <div class="lang-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="lang-pct">${pct}%</span>
        </div>`;
      }).join("");

    languagesSection = `
  <div class="section">
    <p class="section-title">Linguagens</p>
    ${langBars}
  </div>`;
  }

  // CI/CD
  let ciSection = "";
  if (!hasToken) {
    ciSection = noTokenSection("Status CI/CD");
  } else if (gh?.runs?.length) {
    const runRows = gh.runs.map(r => `
      <tr>
        <td class="mono" style="font-size:0.85em">${escHtml(r.name || r.workflow_id)}</td>
        <td>${ciStatusBadge(r)}</td>
        <td style="opacity:0.6;font-size:0.85em">${escHtml(r.head_branch || "")}</td>
        <td style="opacity:0.5;white-space:nowrap;font-size:0.85em">${timeAgo(r.created_at)}</td>
        <td><a href="${escHtml(r.html_url)}" style="color:var(--vscode-textLink-foreground);font-size:0.8em">↗</a></td>
      </tr>`).join("");

    ciSection = `
  <div class="section">
    <p class="section-title">CI/CD — Últimas Execuções</p>
    <table>
      <thead><tr><th>Workflow</th><th>Status</th><th>Branch</th><th>Quando</th><th></th></tr></thead>
      <tbody>${runRows}</tbody>
    </table>
  </div>`;
  }

  //URL GitHub Pages
  const docsSection = docsUrl ? `
  <div class="section">
    <p class="section-title">Documentação Online (GitHub Pages)</p>
    <p style="margin:0;font-size:0.9em">
      <a href="${escHtml(docsUrl)}" style="color:var(--vscode-textLink-foreground)">${escHtml(docsUrl)}</a>
      <span style="opacity:0.45;font-size:0.82em;margin-left:8px">(habilitado automaticamente pelo DevAssist)</span>
    </p>
  </div>` : "";

  //Cobertura
  let coverageHtml = `<p style="opacity:0.5;font-size:0.9em">Análise não disponível (gere documentação com o DevAssist PHP primeiro).</p>`;

  if (coverage) {
    const pct = coverage.coverage;
    const fillColor = pct >= 80 ? "#2ea043" : pct >= 50 ? "#e3b341" : "#f85149";
    const fileRows = (coverage.files || []).slice(0, 10).map(f => `
      <tr>
        <td class="mono">${escHtml(f.path)}</td>
        <td>${f.total}</td>
        <td>${f.documented}</td>
        <td>${coverageBadge(f.coverage)}</td>
      </tr>`).join("");

    coverageHtml = `
      <div class="coverage-bar-wrap">
        <div class="coverage-label">
          <span>${coverage.documented} / ${coverage.total} elementos documentados</span>
          ${coverageBadge(pct)}
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%;background:${fillColor}"></div>
        </div>
      </div>
      ${fileRows ? `
      <table>
        <thead><tr><th>Arquivo</th><th>Total</th><th>Documentado</th><th>Cobertura</th></tr></thead>
        <tbody>${fileRows}</tbody>
      </table>` : ""}`;
  }

  //Contribuidores
  let contribSection = "";
  if (!hasToken) {
    contribSection = noTokenSection("Top Contribuidores");
  } else if (gh?.contributors?.length) {
    const cards = gh.contributors.map(c => `
      <div class="contrib-card">
        <img src="${escHtml(c.avatar_url)}" class="avatar" alt="${escHtml(c.login)}">
        <div class="contrib-info">
          <a href="${escHtml(c.html_url)}" style="color:var(--vscode-textLink-foreground);font-weight:600;font-size:0.9em">${escHtml(c.login)}</a>
          <div style="font-size:0.8em;opacity:0.6">${c.contributions} commits</div>
        </div>
      </div>`).join("");

    contribSection = `
  <div class="section">
    <p class="section-title">Top Contribuidores</p>
    <div class="contrib-grid">${cards}</div>
  </div>`;
  }

  // Releases
  let releasesSection = "";
  if (!hasToken) {
    releasesSection = noTokenSection("Releases");
  } else if (gh?.releases?.length) {
    const rows = gh.releases.map(r => `
      <tr>
        <td><a href="${escHtml(r.html_url)}" style="color:var(--vscode-textLink-foreground);font-weight:600">${escHtml(r.tag_name)}</a></td>
        <td>${escHtml(r.name || "")}</td>
        <td style="opacity:0.5;white-space:nowrap">${fmtDate(r.published_at)}</td>
        <td>${r.prerelease ? `<span class="badge badge-yellow">pre-release</span>` : `<span class="badge badge-green">stable</span>`}</td>
      </tr>`).join("");

    releasesSection = `
  <div class="section">
    <p class="section-title">Releases</p>
    <table>
      <thead><tr><th>Tag</th><th>Nome</th><th>Data</th><th>Tipo</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  } else if (hasToken) {
    releasesSection = `
  <div class="section">
    <p class="section-title">Releases</p>
    <p style="opacity:0.5;font-size:0.9em">Nenhuma release publicada ainda.</p>
  </div>`;
  }

  // Issues Abertas
  let issuesSection = "";
  if (!hasToken) {
    issuesSection = noTokenSection("Issues Abertas");
  } else if (gh?.issues?.length) {
    const rows = gh.issues.map(i => `
      <tr>
        <td style="opacity:0.5;font-size:0.85em">#${i.number}</td>
        <td><a href="${escHtml(i.html_url)}" style="color:var(--vscode-textLink-foreground)">${escHtml(i.title)}</a></td>
        <td style="opacity:0.6;font-size:0.85em">${escHtml(i.user?.login || "")}</td>
        <td style="opacity:0.5;white-space:nowrap;font-size:0.85em">${timeAgo(i.created_at)}</td>
        <td>${(i.labels || []).slice(0, 2).map(l => `<span class="badge" style="background:#${l.color}33;color:#${l.color}">${escHtml(l.name)}</span>`).join(" ")}</td>
      </tr>`).join("");

    issuesSection = `
  <div class="section">
    <p class="section-title">Issues Abertas (${gh.issues.length})</p>
    <table>
      <thead><tr><th>#</th><th>Título</th><th>Autor</th><th>Criado</th><th>Labels</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  } else if (hasToken) {
    issuesSection = `
  <div class="section">
    <p class="section-title">Issues Abertas</p>
    <p style="opacity:0.5;font-size:0.9em">Nenhuma issue aberta. ✓</p>
  </div>`;
  }

  // Pull Requests
  let prsSection = "";
  if (hasToken && gh?.pulls?.length) {
    const rows = gh.pulls.map(p => `
      <tr>
        <td style="opacity:0.5;font-size:0.85em">#${p.number}</td>
        <td><a href="${escHtml(p.html_url)}" style="color:var(--vscode-textLink-foreground)">${escHtml(p.title)}</a></td>
        <td style="opacity:0.6;font-size:0.85em">${escHtml(p.user?.login || "")}</td>
        <td><span class="mono" style="font-size:0.8em;opacity:0.7">${escHtml(p.head?.ref || "")}</span> → <span class="mono" style="font-size:0.8em;opacity:0.7">${escHtml(p.base?.ref || "")}</span></td>
        <td style="opacity:0.5;white-space:nowrap;font-size:0.85em">${timeAgo(p.created_at)}</td>
      </tr>`).join("");

    prsSection = `
  <div class="section">
    <p class="section-title">Pull Requests Abertos (${gh.pulls.length})</p>
    <table>
      <thead><tr><th>#</th><th>Título</th><th>Autor</th><th>Branch</th><th>Criado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  }

  // Atividade de commit
  const dayNames = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const maxDay = Math.max(...localExtra.dayCount, 1);
  const dowBars = localExtra.dayCount.map((count, i) => {
    const pct = Math.round(count / maxDay * 100);
    return `
      <div class="dow-bar-wrap">
        <div class="dow-bar-outer">
          <div class="dow-bar-fill" style="height:${pct}%"></div>
        </div>
        <div class="dow-label">${dayNames[i]}</div>
        <div class="dow-count">${count}</div>
      </div>`;
  }).join("");

  const activitySection = `
  <div class="section">
    <p class="section-title">Atividade por Dia da Semana</p>
    <div class="dow-chart">${dowBars}</div>
    ${linesHtml}
  </div>`;

  // Punch card
  let punchcardSection = "";
  if (gh?.punchcard?.length) {
    const hours = Array.from({ length: 24 }, (_, h) => {
      const total = gh.punchcard.filter(p => p[1] === h).reduce((s, p) => s + p[2], 0);
      return total;
    });
    const maxH = Math.max(...hours, 1);
    const hourBars = hours.map((count, h) => {
      const pct = Math.round(count / maxH * 100);
      const label = h % 3 === 0 ? `${String(h).padStart(2, "0")}h` : "";
      return `
        <div class="hour-col">
          <div class="hour-bar-outer">
            <div class="hour-bar-fill" style="height:${pct}%;opacity:${0.3 + pct / 100 * 0.7}"></div>
          </div>
          <div class="hour-label">${label}</div>
        </div>`;
    }).join("");

    punchcardSection = `
  <div class="section">
    <p class="section-title">Horário de Maior Atividade (GitHub)</p>
    <div class="hour-chart">${hourBars}</div>
  </div>`;
  }

  // Arquivos mais alterados
  let topFilesSection = "";
  if (localExtra.topFiles?.length) {
    const maxCount = localExtra.topFiles[0]?.count || 1;
    const rows = localExtra.topFiles.map(f => {
      const pct = Math.round(f.count / maxCount * 100);
      return `
      <tr>
        <td class="mono" style="font-size:0.85em">${escHtml(f.file)}</td>
        <td style="width:40%">
          <div style="background:var(--vscode-progressBar-background,#333);border-radius:3px;overflow:hidden;height:8px">
            <div style="width:${pct}%;height:100%;background:var(--vscode-textLink-foreground);border-radius:3px"></div>
          </div>
        </td>
        <td style="opacity:0.6;text-align:right;font-size:0.85em">${f.count}x</td>
      </tr>`;
    }).join("");

    topFilesSection = `
  <div class="section">
    <p class="section-title">Arquivos Mais Modificados (histórico completo)</p>
    <table><tbody>${rows}</tbody></table>
  </div>`;
  }

  // Commits recentes
  const commitsHtml = recentCommits.length
    ? `<table>
        <thead><tr><th>Hash</th><th>Mensagem</th><th>Autor</th><th>Quando</th></tr></thead>
        <tbody>
          ${recentCommits.map(c => `
            <tr>
              <td class="mono" style="color:var(--vscode-textLink-foreground)">${c.hash || ""}</td>
              <td>${escHtml(c.subject || "")}</td>
              <td style="opacity:0.7">${escHtml(c.author || "")}</td>
              <td style="opacity:0.5;white-space:nowrap">${escHtml(c.when || "")}</td>
            </tr>`).join("")}
        </tbody>
      </table>`
    : `<p style="opacity:0.5">Nenhum commit encontrado.</p>`;

  // Últimos arquivos modificados
  const filesHtml = lastFiles.length
    ? `<table>
        <thead><tr><th>Arquivo</th><th>Alterações</th></tr></thead>
        <tbody>
          ${lastFiles.map(f => `
            <tr>
              <td class="mono">${escHtml(f.file || "")}</td>
              <td style="opacity:0.6">${escHtml(f.changes || "")}</td>
            </tr>`).join("")}
        </tbody>
      </table>`
    : `<p style="opacity:0.5">Nenhum arquivo alterado.</p>`;

  // Montar o dashboard
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DevAssist PHP — Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
      margin: 0;
      line-height: 1.5;
    }

    /* Header */
    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c);
    }
    .repo-name { font-size: 1.3em; font-weight: 700; }
    .branch-tag {
      font-size: 0.8em; padding: 2px 10px; border-radius: 12px;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .last-commit-info { font-size: 0.8em; opacity: 0.6; margin-top: 4px; }
    .gh-meta { display: flex; gap: 12px; margin-top: 8px; font-size: 0.85em; opacity: 0.75; }
    .gh-meta span { display: flex; align-items: center; gap: 4px; }

    /* Stats */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
      border-radius: 8px; padding: 14px 10px; text-align: center;
    }
    .stat-value { font-size: 1.7em; font-weight: 700; color: var(--vscode-textLink-foreground); }
    .stat-label { font-size: 0.75em; opacity: 0.6; margin-top: 4px; }

    /* Section */
    .section {
      background: var(--vscode-editor-inactiveSelectionBackground, #2a2d2e);
      border-radius: 8px; padding: 16px 20px; margin-bottom: 14px;
    }
    .section-title {
      font-size: 0.75em; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; opacity: 0.5; margin: 0 0 14px;
    }

    /* Table */
    table { width: 100%; border-collapse: collapse; font-size: 0.88em; }
    th {
      padding: 6px 10px; text-align: left; font-size: 0.75em;
      font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
      opacity: 0.5; border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c);
    }
    td { padding: 7px 10px; border-bottom: 1px solid var(--vscode-widget-border, #2a2a2a); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--vscode-list-hoverBackground, #2a2d2e33); }

    /* Coverage */
    .coverage-bar-wrap { margin-bottom: 14px; }
    .coverage-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 0.9em; }
    .progress-bar { height: 10px; background: var(--vscode-progressBar-background, #333); border-radius: 5px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 5px; transition: width .4s ease; }

    /* Language bars */
    .lang-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .lang-name { width: 90px; font-size: 0.85em; white-space: nowrap; }
    .lang-bar-bg { flex: 1; height: 8px; background: var(--vscode-progressBar-background, #333); border-radius: 4px; overflow: hidden; }
    .lang-bar-fill { height: 100%; border-radius: 4px; }
    .lang-pct { width: 36px; font-size: 0.8em; opacity: 0.7; text-align: right; }

    /* Contributors */
    .contrib-grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .contrib-card { display: flex; align-items: center; gap: 10px; background: var(--vscode-editor-background); padding: 8px 12px; border-radius: 6px; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; }
    .contrib-info { display: flex; flex-direction: column; }

    /* Badges */
    .badge { font-size: 0.72em; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
    .badge-green  { background: #2ea04326; color: #3fb950; }
    .badge-yellow { background: #e3b34126; color: #e3b341; }
    .badge-red    { background: #f8514926; color: #f85149; }

    /* Misc */
    .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
    .two-col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .mini-stat { background: var(--vscode-editor-background); border-radius: 6px; padding: 8px 12px; }
    .mini-label { font-size: 0.75em; opacity: 0.5; display: block; margin-top: 2px; }

    /* Day-of-week bar chart */
    .dow-chart { display: flex; gap: 12px; align-items: flex-end; height: 100px; margin-bottom: 4px; }
    .dow-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
    .dow-bar-outer { width: 100%; flex: 1; display: flex; align-items: flex-end; background: var(--vscode-editor-background); border-radius: 3px; overflow: hidden; }
    .dow-bar-fill { width: 100%; background: var(--vscode-textLink-foreground); border-radius: 3px; opacity: 0.8; }
    .dow-label { font-size: 0.72em; opacity: 0.6; }
    .dow-count { font-size: 0.7em; opacity: 0.4; }

    /* Hour heatmap */
    .hour-chart { display: flex; gap: 3px; align-items: flex-end; height: 70px; }
    .hour-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 3px; }
    .hour-bar-outer { width: 100%; flex: 1; display: flex; align-items: flex-end; background: var(--vscode-editor-background); border-radius: 2px; overflow: hidden; }
    .hour-bar-fill { width: 100%; background: var(--vscode-textLink-foreground); border-radius: 2px; }
    .hour-label { font-size: 0.6em; opacity: 0.5; }

    /* No token placeholder */
    .no-token { opacity: 0.45; font-size: 0.88em; font-style: italic; }

    /* Refresh button */
    button.refresh {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-size: 0.85em;
    }
    button.refresh:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="repo-name">${escHtml(repoLabel)}</span>
        <span class="branch-tag">${escHtml(gitStats.branch)}</span>
        ${providerLabel}
        ${ghPrivate != null ? `<span class="badge" style="background:#55555540;color:#aaa">${ghPrivate ? "🔒 Privado" : "🌐 Público"}</span>` : ""}
      </div>
      <div class="last-commit-info">
        Último commit: <strong>${escHtml(gitStats.lastCommit?.hash || "—")}</strong>
        ${escHtml(gitStats.lastCommit?.subject || "")}
        — ${escHtml(gitStats.lastCommit?.author || "")}
        · ${escHtml(gitStats.lastCommit?.when || "")}
      </div>
      ${ghDesc ? `<div style="font-size:0.85em;opacity:0.65;margin-top:6px">${escHtml(ghDesc)}</div>` : ""}
      <div class="gh-meta">
        ${ghStars != null ? `<span>⭐ ${fmtNum(ghStars)} stars</span>` : ""}
        ${ghForks != null ? `<span>🍴 ${fmtNum(ghForks)} forks</span>` : ""}
        ${ghWatchers != null ? `<span>👁 ${fmtNum(ghWatchers)}</span>` : ""}
        ${ghLicense ? `<span>📄 ${escHtml(ghLicense)}</span>` : ""}
        ${ghSize ? `<span>💾 ${escHtml(ghSize)}</span>` : ""}
        ${!hasToken ? `<span class="no-token">Configure GitHub Token para ver dados da API</span>` : ""}
      </div>
    </div>
    <button class="refresh" onclick="refresh()">↻ Atualizar</button>
  </div>

  <!-- Stats -->
  <div class="stats-grid">${statsHtml}</div>

  <!-- Repo description / meta -->
  ${descSection}

  <!-- Languages -->
  ${languagesSection}

  <!-- CI/CD -->
  ${ciSection}

  <!-- GitHub Pages -->
  ${docsSection}

  <!-- Doc Coverage -->
  <div class="section">
    <p class="section-title">Cobertura de Documentação PHP</p>
    ${coverageHtml}
  </div>

  <!-- Contributors -->
  ${contribSection}

  <!-- Releases -->
  ${releasesSection}

  <!-- Issues -->
  ${issuesSection}

  <!-- Pull Requests -->
  ${prsSection}

  <!-- Activity chart -->
  ${activitySection}

  <!-- Hour heatmap -->
  ${punchcardSection}

  <!-- Top changed files -->
  ${topFilesSection}

  <!-- Recent commits -->
  <div class="section">
    <p class="section-title">Commits Recentes</p>
    ${commitsHtml}
  </div>

  <!-- Last commit files -->
  <div class="section">
    <p class="section-title">Arquivos do Último Commit</p>
    ${filesHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function refresh() {
      vscode.postMessage({ command: 'refresh' });
      document.querySelector('.stats-grid').style.opacity = '0.4';
    }
  </script>
</body>
</html>`;
}

function noTokenSection(title) {
  return `
  <div class="section">
    <p class="section-title">${title}</p>
    <p class="no-token">Configure seu GitHub Token (DevAssist PHP → Configurar GitHub Token) para ver estes dados.</p>
  </div>`;
}

module.exports = { openDashboard };
