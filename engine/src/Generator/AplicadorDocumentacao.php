<?php

namespace Generator;

/**
 * Classe responsável por aplicar documentação em conteúdos de texto, substituindo
 * placeholders {{doc_X}} pelos DocBlocks gerados.
 */
final class AplicadorDocumentacao
{

    /**
     * @param string $sConteudo Conteúdo com placeholders
     * @param array  $aDocs     Mapa de docs (chaves podem ser 'doc_1' ou '1')
     */
    public function aplicar(string $sConteudo, array $aDocs): string
    {
        $sConteudo = str_replace("\r\n", "\n", $sConteudo);
        $aLinhas = explode("\n", $sConteudo);

        $iTotal = count($aLinhas);

        for ($i = 0; $i < $iTotal; $i++) {

            $sLinha = $aLinhas[$i];

            if (!preg_match('/\{\{\s*(doc_[A-Za-z0-9_-]+)\s*\}\}/', $sLinha, $aM)) {
                continue;
            }

            $sId = $aM[1];
            $sNum = substr($sId, 4);

            if (isset($aDocs[$sId])) {
                $sDoc = $aDocs[$sId];
            } elseif (isset($aDocs[$sNum])) {
                $sDoc = $aDocs[$sNum];
            } else {
                continue;
            }

            preg_match('/^([ \t]*)/', $sLinha, $aMi);
            $sIndent = $aMi[1] ?? '';

            if ($sIndent === '' && $i + 1 < $iTotal) {

                $j = $i + 1;

                while ($j < $iTotal && trim($aLinhas[$j]) === '') {
                    $j++;
                }

                if ($j < $iTotal && preg_match('/^([ \t]+)/', $aLinhas[$j], $aMn)) {
                    $sIndent = $aMn[1];
                }
            }

            $sDocBlock = $this->paraDocblockComIdentacao($sDoc, $sIndent);

            $aLinhas[$i] = preg_replace(
                '/\{\{\s*' . preg_quote($sId, '/') . '\s*\}\}/',
                $sDocBlock,
                $sLinha
            );
        }

        return implode("\n", $aLinhas);
    }

    /**
     * Aplica identação ao DocBlock, alinhando-o com o código circundante.
     * 
     * @param string $sTexto String contendo o DocBlock.
     * @param string $sIndent String contendo a identação a ser aplicada.
     * @return string String contendo o DocBlock com a identação aplicada.
     */
    private function paraDocblockComIdentacao(string $sTexto, string $sIndent = ''): string
    {
        $sTexto = trim(str_replace("\r\n", "\n", $sTexto));

        if (!str_starts_with($sTexto, '/**')) {

            $aLinhas = $sTexto === ''
                ? ['Documentação gerada.']
                : explode("\n", $sTexto);

            $aLinhas = array_map(
                fn($l) => ' * ' . ltrim(preg_replace('/^\*\s*/', '', $l)),
                $aLinhas
            );

            $sTexto = "/**\n" . implode("\n", $aLinhas) . "\n */";
        }

        $aOut = array_map(
            fn($l) => $sIndent . $l,
            explode("\n", $sTexto)
        );

        return implode("\n", $aOut);
    }
}
