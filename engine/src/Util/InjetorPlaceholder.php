<?php

namespace Util;

/**
 * Classe responsável por injetar placeholders em um arquivo de entrada com base em um mapa de itens.
 */
final class InjetorPlaceholder
{

    /**
     * Insere placeholders em linhas específicas de um arquivo com base em um mapa fornecido.
     *
     * @param string $sArquivoEntrada O caminho do arquivo de entrada a ser modificado.
     * @param array $aMapa Um array associativo que contém informações sobre as linhas e os placeholders a serem inseridos.
     * @return string O conteúdo do arquivo após a inserção dos placeholders.
     */
    public function injetar(string $sArquivoEntrada, array $aMapa): string
    {
        if (!is_file($sArquivoEntrada) || !is_readable($sArquivoEntrada)) {
            return '';
        }

        $aLinhas = file($sArquivoEntrada);
        if ($aLinhas === false) {
            return '';
        }

        usort($aMapa, function (array $aA, array $aB): int {
            return ((int) ($aB['line'] ?? 0)) <=> ((int) ($aA['line'] ?? 0));
        });

        foreach ($aMapa as $aItem) {
            $iLinhaAlvo = (int) ($aItem['line'] ?? 1);
            $iIdx = max(0, $iLinhaAlvo - 1);
            $sPH = "{{" . ($aItem['id'] ?? 'doc_desconhecido') . "}}\n";

            $bTemDocIni = !empty($aItem['doc_start']);
            $bTemDocFim = !empty($aItem['doc_end']);

            if ($bTemDocIni && $bTemDocFim) {
                $iIni = max(0, (int) $aItem['doc_start'] - 1);
                $iFim = max(0, (int) $aItem['doc_end'] - 1);
                $iTam = max(0, $iFim - $iIni + 1);
                array_splice($aLinhas, $iIni, $iTam);
                $iIdx = $iIni;
            }
            array_splice($aLinhas, $iIdx, 0, $sPH);
        }

        return implode('', $aLinhas);
    }
}
