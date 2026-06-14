<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\Parser\Normalizador;
use App\Parser\ServicoAst;
use PhpParser\NodeTraverser;
use Analyser\MarcadorDocumentacao;
use Analyser\ValidadorDocblock;
use Util\InjetorPlaceholder;
use Util\RelatorErros;
use Generator\ConstrutorPrompt;
use Generator\FabricaClienteLLM;
use Generator\AplicadorDocumentacao;

$aOptions = getopt("", ["input:", "base:"]);
$sInputPath = $aOptions['input'] ?? (__DIR__ . '/../input/entrada.php');
$sInputPath = realpath($sInputPath) ?: $sInputPath;
$sBase = $aOptions['base'] ?? pathinfo($sInputPath, PATHINFO_FILENAME);
$sOutDir = __DIR__ . '/../output';

@mkdir($sOutDir, 0777, true);

foreach (glob($sOutDir . '/*_' . $sBase . '.*') as $sFile) {
    @unlink($sFile);
}

@unlink($sOutDir . '/errors.json');

echo "=> Input:  {$sInputPath}\n";
echo "=> Output: " . realpath($sOutDir) . "\n";
echo "=> Base:   {$sBase}\n";

//Carregar
$sRaw = @file_get_contents($sInputPath);

if ($sRaw === false) {

    (new RelatorErros())->escrever($sOutDir, [
        [
            'mensagem' => "Arquivo não encontrado: {$sInputPath}",
            'linha_inicio' => 0,
            'linha_fim' => 0,
        ]
    ]);

    fwrite(STDERR, "Erro: arquivo de entrada ausente\n");
    exit(1);
}

// Normalizar
[$sNormalized, $bIsFragment, $iAddedLines] =
    (new Normalizador())->normalizar($sRaw);

//AST
[$aAst, $aParseErrors] =
    (new ServicoAst())->analisarCodigo($sNormalized);

if (!empty($aParseErrors)) {

    (new RelatorErros())->escrever($sOutDir, $aParseErrors);

    file_put_contents(
        "{$sOutDir}/doc_map_{$sBase}.json",
        json_encode([], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
    );

    exit(1);
}

// Mapear nós
$oMarker = new MarcadorDocumentacao();
$oTr = new NodeTraverser();
$oTr->addVisitor($oMarker);
$oTr->traverse($aAst);

$aItems = array_map(function ($aIt) use ($iAddedLines) {

    $fnAdj = fn($v) => is_int($v) ? max(1, $v - $iAddedLines) : $v;

    $aIt['line'] = $fnAdj($aIt['line'] ?? 1);
    $aIt['endLine'] = $fnAdj($aIt['endLine'] ?? null);
    $aIt['doc_start'] = $fnAdj($aIt['doc_start'] ?? null);
    $aIt['doc_end'] = $fnAdj($aIt['doc_end'] ?? null);

    return $aIt;

}, $oMarker->aItens ?? []);

$oValidator = new ValidadorDocblock();

$aItems = array_values(array_filter(
    $aItems,
    fn($aIt) => $oValidator->precisaGerar($aIt)
));

if ($bIsFragment) {
    $aItems = array_values(array_filter(
        $aItems,
        fn($aIt) => in_array(
            $aIt['type'] ?? '',
            ['function', 'method', 'property', 'constant'],
            true
        )
    ));
}

file_put_contents(
    "{$sOutDir}/doc_map_{$sBase}.json",
    json_encode($aItems, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

echo "Mapping -> {$sOutDir}/doc_map_{$sBase}.json\n";

// Placeholders
if (!$bIsFragment) {

    $aMapa = array_map(function ($aIt) {
        return [
            'id' => $aIt['id'],
            'line' => max(2, (int) ($aIt['line'] ?? 1)),
            'doc_start' => $aIt['doc_start'] ?? null,
            'doc_end' => $aIt['doc_end'] ?? null,
        ];
    }, $aItems);

    $sSrcComPH = (new InjetorPlaceholder())->injetar($sInputPath, $aMapa);

    file_put_contents(
        "{$sOutDir}/placeholder_{$sBase}.php",
        $sSrcComPH
    );

    echo "Placeholders -> {$sOutDir}/placeholder_{$sBase}.php\n";
}

// Prompts
$oConstr = new ConstrutorPrompt();
$aPrompts = [];

foreach ($aItems as $aIt) {
    $aPrompts[$aIt['id']] = $oConstr->construir($aIt, $sRaw);
}

//LLM
$aLlmConfig = FabricaClienteLLM::resolverConfig();
$sApiKey = $aLlmConfig['apiKey'];
$sModel = $aLlmConfig['model'];
$sBaseUrl = rtrim($aLlmConfig['base'], '/');
$sProvider = $aLlmConfig['provider'];

echo "=> Provedor: {$sProvider}\n";
echo "=> Modelo:   {$sModel}\n";
echo "=> API KEY:  " . ($sApiKey !== '' ? strlen($sApiKey) . ' chars' : 'não configurada') . "\n";

$aDocs = [];

if ($sApiKey !== '') {

    $oCli = FabricaClienteLLM::criar();

    foreach ($aItems as $aIt) {

        $sDoc = $oCli->gerar(
            $sBaseUrl,
            $sApiKey,
            $sModel,
            $aPrompts[$aIt['id']]
        );

        if (!$sDoc || trim($sDoc) === '') {
            $sDoc = "/**\n * Documentação não gerada automaticamente.\n */";
        }

        $aDocs[$aIt['id']] = $sDoc;
    }

} else {

    foreach ($aItems as $aIt) {
        $aDocs[$aIt['id']] = "/**\n * Documentação gerada (FAKE — configure LLM_API_KEY ou OPENAI_API_KEY).\n */";
    }
}

file_put_contents(
    "{$sOutDir}/generated_docs_{$sBase}.json",
    json_encode($aDocs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
);

echo "Docs gerados: " . count($aDocs) . "\n";

//Aplicar docs
if (!$bIsFragment && file_exists("{$sOutDir}/placeholder_{$sBase}.php")) {

    $sSrcPH = file_get_contents("{$sOutDir}/placeholder_{$sBase}.php");
    $sFinal = (new AplicadorDocumentacao())->aplicar($sSrcPH, $aDocs);

    file_put_contents(
        "{$sOutDir}/documentado_{$sBase}.php",
        $sFinal
    );

    echo "Documentado -> {$sOutDir}/documentado_{$sBase}.php\n";

} else {

    if (!empty($aDocs)) {

        $sPreview = implode("\n\n", array_values($aDocs));

        file_put_contents(
            "{$sOutDir}/preview_patch_{$sBase}.txt",
            $sPreview
        );

        echo "Preview -> {$sOutDir}/preview_patch_{$sBase}.txt\n";
    }
}
