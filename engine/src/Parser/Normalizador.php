<?php

namespace App\Parser;

/**
 * Classe responsável por normalizar trechos de código PHP.
 */
final class Normalizador
{

    /**
     * Normaliza um trecho de código PHP.
     * @param string $sRaw Trecho de código PHP.
     * @return array{string, bool, int} Array contendo o código normalizado.
     */
    public function normalizar(string $sRaw): array
    {
        $sInput = ltrim($sRaw);

        if (preg_match('/^\<\?php\b/u', $sInput)) {
            return [$sRaw, false, 0];
        }

        $iLinhasAdd = 0;
        $bIsFragment = true;

        $fnWrap = function (string $sPrefix, string $sBody, string $sSuffix = "") use (&$iLinhasAdd): string {
            $iLinhasAdd = substr_count($sPrefix, "\n");
            return $sPrefix . rtrim($sBody) . $sSuffix;
        };

        if (preg_match('/^(namespace|use)\b/u', $sInput)) {
            return [$fnWrap("<?php\n", $sInput, "\n"), $bIsFragment, $iLinhasAdd];
        }

        if (preg_match('/^(class|interface|trait|enum)\b/u', $sInput)) {
            return [$fnWrap("<?php\n", $sInput, "\n"), $bIsFragment, $iLinhasAdd];
        }

        if (preg_match('/^function\b/u', $sInput)) {
            return [$fnWrap("<?php\n", $sInput, "\n"), $bIsFragment, $iLinhasAdd];
        }

        if (preg_match('/^(public|protected|private)/u', $sInput)) {
            return [
                $fnWrap(
                    "<?php\nclass __Tmp__ {\n",
                    $sInput,
                    "\n}\n"
                ),
                $bIsFragment,
                $iLinhasAdd
            ];
        }

        return [
            $fnWrap(
                "<?php\nfunction __tmp__() {\n",
                $sInput,
                "\n}\n"
            ),
            $bIsFragment,
            $iLinhasAdd
        ];
    }
}
