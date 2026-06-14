<?php

/**
 * Gera testes PHPUnit para o código PHP do usuário usando LLM.
 *
 * Utilizado com php bin/generate-tests.php --input /caminho/para/arquivo.php --output-dir /caminho/para/tests
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\Parser\Normalizador;
use App\Parser\ServicoAst;
use PhpParser\NodeTraverser;
use Analyser\MarcadorDocumentacao;
use Generator\ConstrutorPromptTeste;
use Generator\FabricaClienteLLM;

$aOptions = getopt('', ['input:', 'output-dir:']);
$sInputPath = $aOptions['input'] ?? null;
$sOutputDir = $aOptions['output-dir'] ?? null;

if (!$sInputPath) {
    fwrite(STDERR, "Uso: php bin/generate-tests.php --input <arquivo.php> --output-dir <tests/>\n");
    exit(1);
}

$sInputPath = realpath($sInputPath) ?: $sInputPath;

if (!file_exists($sInputPath)) {
    fwrite(STDERR, "Arquivo não encontrado: {$sInputPath}\n");
    exit(1);
}

if (!$sOutputDir) {
    $sOutputDir = dirname(dirname($sInputPath)) . DIRECTORY_SEPARATOR . 'tests';
}

@mkdir($sOutputDir, 0777, true);

echo "=> Input:      {$sInputPath}\n";
echo "=> Output dir: {$sOutputDir}\n";

//Parse
$sRaw = file_get_contents($sInputPath);

[$sNormalized, , $iAddedLines] = (new Normalizador())->normalizar($sRaw);
[$aAst, $aParseErrors] = (new ServicoAst())->analisarCodigo($sNormalized);

if (!empty($aParseErrors)) {
    fwrite(STDERR, "Erros de parse:\n");
    foreach ($aParseErrors as $aParseErr) {
        fwrite(STDERR, "  - " . $aParseErr['mensagem'] . "\n");
    }
    exit(1);
}

// Mapear classes e seus métodos públicos
$oMarker = new MarcadorDocumentacao();
$oTr = new NodeTraverser();
$oTr->addVisitor($oMarker);
$oTr->traverse($aAst);

$fnAdj = fn($v) => is_int($v) ? max(1, $v - $iAddedLines) : $v;

$aItems = array_map(function ($aIt) use ($fnAdj) {
    $aIt['line'] = $fnAdj($aIt['line'] ?? 1);
    $aIt['endLine'] = $fnAdj($aIt['endLine'] ?? null);
    return $aIt;
}, $oMarker->aItens ?? []);

$aClasses = array_filter($aItems, fn($aIt) => in_array($aIt['type'] ?? '', ['class', 'interface', 'trait'], true));
$aMetodos = array_filter($aItems, fn($aIt) => ($aIt['type'] ?? '') === 'method' && ($aIt['modificadores']['public'] ?? false) === true);

if (empty($aClasses)) {
    echo "Nenhuma classe encontrada em {$sInputPath}. Ignorando.\n";
    exit(0);
}

//LLM
$aLlmConfig = FabricaClienteLLM::resolverConfig();
$sApiKey = $aLlmConfig['apiKey'];
$sModel = $aLlmConfig['model'];
$sBaseUrl = rtrim($aLlmConfig['base'], '/');
$sProvider = $aLlmConfig['provider'];

echo "=> Provedor: {$sProvider}\n";
echo "=> Modelo:   {$sModel}\n";

if ($sApiKey === '') {
    fwrite(STDERR, "LLM_API_KEY não configurada. Configure via extensão ou variável de ambiente.\n");
    exit(1);
}

$oConstrutorTeste = new ConstrutorPromptTeste();
$oClienteLLM = FabricaClienteLLM::criar();

//Gerar teste para cada classe
foreach ($aClasses as $aClasse) {
    $sClassName = $aClasse['name'] ?? ($aClasse['fqn'] ?? 'Desconhecido');

    $aMetodosClasse = array_values(array_filter(
        $aMetodos,
        fn($aM) => str_starts_with($aM['fqn'] ?? '', ($aClasse['fqn'] ?? '') . '::')
    ));

    if (empty($aMetodosClasse)) {
        echo "Classe {$sClassName}: sem métodos públicos, ignorando.\n";
        continue;
    }

    $sFqn = $aClasse['fqn'] ?? $sClassName;
    $sNamespace = str_contains($sFqn, '\\')
        ? implode('\\', array_slice(explode('\\', $sFqn), 0, -1))
        : '';

    $aClasse['namespace'] = $sNamespace;

    echo "Gerando testes para: {$sFqn} ({$sClassName}, " . count($aMetodosClasse) . " método(s))...\n";

    $sPrompt = $oConstrutorTeste->construir($aClasse, $aMetodosClasse, $sRaw);
    $sSystemMsg = 'Você é um gerador de testes PHPUnit. Produza APENAS código PHP válido, sem markdown, sem explicações. '
        . 'Leia o código-fonte linha a linha. Baseie cada assertEquals no retorno real do método — '
        . 'execute o código mentalmente com os parâmetros que escolher e verifique o resultado antes de escrever. '
        . 'Nunca invente comportamento que não está no código. Nunca use expectException sem um throw explícito no método.';

    $sTestCode = $oClienteLLM->gerar($sBaseUrl, $sApiKey, $sModel, $sPrompt, $sSystemMsg);

    if (!$sTestCode || trim($sTestCode) === '') {
        echo "  [AVISO] LLM não retornou código para {$sClassName}.\n";
        continue;
    }

    if (!str_starts_with(ltrim($sTestCode), '<?php')) {
        $sTestCode = "<?php\n\n" . $sTestCode;
    }

    $sTestCode = preg_replace('/^```(?:php)?\s*/m', '', $sTestCode);
    $sTestCode = preg_replace('/\s*```\s*$/m', '', $sTestCode);
    $sTestCode = trim($sTestCode);

    $sTestFileName = $sClassName . 'Test.php';
    $sTestFilePath = rtrim($sOutputDir, '/\\') . DIRECTORY_SEPARATOR . $sTestFileName;

    if (file_exists($sTestFilePath)) {
        $sExisting = file_get_contents($sTestFilePath);
        if (!str_contains($sExisting, 'markTestIncomplete') && !str_contains($sExisting, 'TODO')) {
            echo "  [SKIP] {$sTestFileName} já existe com conteúdo real. Use --force para sobrescrever.\n";
            continue;
        }
    }

    file_put_contents($sTestFilePath, $sTestCode . "\n");
    echo "  => {$sTestFilePath}\n";
}

echo "\nTestes gerados com sucesso.\n";
