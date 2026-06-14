<?php

/**
 * Analisa a cobertura de documentação PHP de um diretório.
 *
 * Utilizado com php bin/analyze.php --dir /caminho/para/projeto
 *
 * Saída: JSON com resultado da cobertura por arquivo e total do diretório.
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\Parser\Normalizador;
use App\Parser\ServicoAst;
use Analyser\MarcadorDocumentacao;
use Analyser\ValidadorDocblock;
use PhpParser\NodeTraverser;

$aOptions = getopt('', ['dir:']);
$sDir = realpath($aOptions['dir'] ?? getcwd()) ?: (string) ($aOptions['dir'] ?? getcwd());

if (!is_dir($sDir)) {
    fwrite(STDERR, "Diretório não encontrado: {$sDir}\n");
    exit(1);
}

$aIgnoredDirs = ['vendor', 'tests', 'output', 'input', '.git', 'node_modules', 'docs'];

$oRii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($sDir));
$aFiles = [];

foreach ($oRii as $oFile) {
    if ($oFile->isDir() || $oFile->getExtension() !== 'php') {
        continue;
    }

    $sNormalized = str_replace('\\', '/', $oFile->getPathname());

    $bSkip = false;
    foreach ($aIgnoredDirs as $sIgnored) {
        if (str_contains($sNormalized, '/' . $sIgnored . '/') || str_contains($sNormalized, '/' . $sIgnored)) {
            $bSkip = true;
            break;
        }
    }

    if (!$bSkip) {
        $aFiles[] = $oFile->getPathname();
    }
}

/*
 * Analisar cada arquivo
 */

$oNormalizador = new Normalizador();
$oServicoAst = new ServicoAst();
$oValidator = new ValidadorDocblock();

$iTotalItems = 0;
$iTotalNeedDoc = 0;
$aFileStats = [];

foreach ($aFiles as $sFilePath) {
    $sRaw = @file_get_contents($sFilePath);
    if ($sRaw === false || trim($sRaw) === '') {
        continue;
    }

    [$sNormalized, , $iAddedLines] = $oNormalizador->normalizar($sRaw);
    [$aAst, $aParseErrors] = $oServicoAst->analisarCodigo($sNormalized);

    if (!empty($aParseErrors) || empty($aAst)) {
        continue;
    }

    $oMarker = new MarcadorDocumentacao();
    $oTr = new NodeTraverser();
    $oTr->addVisitor($oMarker);
    $oTr->traverse($aAst);

    $aItems = array_map(function ($aIt) use ($iAddedLines) {
        $fnAdj = fn($v) => is_int($v) ? max(1, $v - $iAddedLines) : $v;
        $aIt['line'] = $fnAdj($aIt['line'] ?? 1);
        $aIt['endLine'] = $fnAdj($aIt['endLine'] ?? null);
        return $aIt;
    }, $oMarker->aItens ?? []);

    $aNeedDoc = array_values(array_filter($aItems, fn($aIt) => $oValidator->precisaGerar($aIt)));
    $iFileTotal = count($aItems);
    $iFileNeed = count($aNeedDoc);

    if ($iFileTotal === 0) {
        continue;
    }

    $iTotalItems += $iFileTotal;
    $iTotalNeedDoc += $iFileNeed;

    $sRelPath = ltrim(
        str_replace(str_replace('\\', '/', $sDir), '', str_replace('\\', '/', $sFilePath)),
        '/'
    );

    $aFileStats[] = [
        'path' => $sRelPath,
        'total' => $iFileTotal,
        'documented' => $iFileTotal - $iFileNeed,
        'undocumented' => $iFileNeed,
        'coverage' => (int) round(($iFileTotal - $iFileNeed) / $iFileTotal * 100),
        'items_missing' => array_values(array_map(
            fn($aIt) => ['type' => $aIt['type'] ?? '?', 'name' => $aIt['name'] ?? $aIt['fqn'] ?? '?', 'line' => $aIt['line'] ?? 0],
            $aNeedDoc
        )),
    ];
}

usort($aFileStats, fn($aA, $aB) => $aB['undocumented'] - $aA['undocumented']);

$iDocumented = $iTotalItems - $iTotalNeedDoc;
$iCoverage = $iTotalItems > 0 ? (int) round($iDocumented / $iTotalItems * 100) : 100;

echo json_encode([
    'dir' => $sDir,
    'total' => $iTotalItems,
    'documented' => $iDocumented,
    'undocumented' => $iTotalNeedDoc,
    'coverage' => $iCoverage,
    'files' => $aFileStats,
    'files_scanned' => count($aFileStats),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
