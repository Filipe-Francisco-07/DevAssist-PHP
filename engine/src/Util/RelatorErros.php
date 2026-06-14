<?php

namespace Util;

/**
 * Classe responsável por relatar erros.
 */
final class RelatorErros
{

    /**
     * Escreve os erros em um arquivo JSON.
     *
     * @param string $sDir O caminho do diretório onde o arquivo de erros será escrito.
     * @param array $aErros Um array associativo contendo os erros a serem escritos.
     */
    public function escrever(string $sDir, array $aErros): void
    {
        if (!is_dir($sDir)) {
            mkdir($sDir, 0777, true);
        }

        file_put_contents(
            rtrim($sDir, '/') . '/errors.json',
            json_encode($aErros, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );
    }
}
