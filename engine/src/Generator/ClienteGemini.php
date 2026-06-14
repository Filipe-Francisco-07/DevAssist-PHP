<?php

namespace Generator;

/**
 * Cliente HTTP para a API Google Gemini.
 *
 * Implementa ClienteLLMInterface utilizando o endpoint
 * generateContent da API Generative Language do Google.
 */
final class ClienteGemini implements ClienteLLMInterface
{
    /**
     * Envia um prompt ao modelo Gemini e retorna o DocBlock gerado.
     *
     * @param string $sBase    URL base da API.
     * @param string $sApiKey  Chave de API do Google.
     * @param string $sModelo  Nome do modelo (ex: gemini-1.5-flash).
     * @param string $sPrompt  Prompt com metadados e trecho de código.
     * @param string $sSystem  Mensagem de sistema opcional.
     * @return string|null     DocBlock PHPDoc, ou null em caso de falha.
     */
    public function gerar(string $sBase, string $sApiKey, string $sModelo, string $sPrompt, string $sSystem = ''): ?string
    {
        $sUrl = rtrim($sBase, '/') . '/models/' . $sModelo . ':generateContent?key=' . $sApiKey;

        $sSystemMsg = $sSystem ?: 'Você gera apenas DocBlocks PHPDoc válidos.';

        $aPayload = [
            'systemInstruction' => [
                'parts' => [['text' => $sSystemMsg]],
            ],
            'contents' => [
                ['parts' => [['text' => $sPrompt]]],
            ],
            'generationConfig' => [
                'temperature' => 0.1,
            ],
        ];

        $sLogDir = __DIR__ . '/../../output';
        if (!is_dir($sLogDir)) {
            mkdir($sLogDir, 0777, true);
        }
        $sLogFile = $sLogDir . '/gpt_debug.log';

        file_put_contents(
            $sLogFile,
            "=== REQ [gemini] ===\n" . json_encode($aPayload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n",
            FILE_APPEND
        );

        $oCurl = curl_init($sUrl);

        $sCacert = getenv('CURL_CA_BUNDLE')
            ?: ini_get('curl.cainfo')
            ?: ini_get('openssl.cafile')
            ?: null;

        if (!$sCacert || !file_exists($sCacert)) {
            $aWindowsFallbacks = [
                'C:/Program Files/Git/mingw64/etc/ssl/certs/ca-bundle.crt',
                'C:/Program Files/Git/usr/ssl/certs/ca-bundle.crt',
                'C:/Program Files/Git/mingw64/ssl/certs/ca-bundle.crt',
                __DIR__ . '/../../extras/cacert.pem',
            ];
            foreach ($aWindowsFallbacks as $sFb) {
                if (file_exists($sFb)) {
                    $sCacert = $sFb;
                    break;
                }
            }
        }

        $aCurlOpts = [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($aPayload, JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];

        if ($sCacert && file_exists($sCacert)) {
            $aCurlOpts[CURLOPT_CAINFO] = $sCacert;
        }

        curl_setopt_array($oCurl, $aCurlOpts);

        $sResp = curl_exec($oCurl);
        $iCode = curl_getinfo($oCurl, CURLINFO_RESPONSE_CODE);
        $sCurlErr = curl_error($oCurl);

        file_put_contents(
            $sLogFile,
            "\n=== HTTP $iCode ===\n$sResp\nErro: $sCurlErr\n",
            FILE_APPEND
        );

        if ($sResp === false || $iCode >= 400) {
            return null;
        }

        $aJson = json_decode($sResp, true);

        if (!isset($aJson['candidates'][0]['content']['parts'][0]['text'])) {
            file_put_contents($sLogFile, "\n[ERRO] JSON sem campo esperado.\n", FILE_APPEND);
            return null;
        }

        $sDoc = trim($aJson['candidates'][0]['content']['parts'][0]['text']);

        if ($sDoc === '') {
            return null;
        }

        $sDoc = preg_replace('/^```(?:php)?\s*/m', '', $sDoc);
        $sDoc = preg_replace('/\s*```$/m', '', $sDoc);
        $sDoc = trim($sDoc);

        if (!str_starts_with($sDoc, '<?php') && !str_starts_with($sDoc, '/**')) {
            $sDoc = "/**\n * " . preg_replace('/^\*?\s*/m', '* ', $sDoc) . "\n */";
        }

        file_put_contents($sLogFile, "\n=== DOC ===\n$sDoc\n", FILE_APPEND);

        return $sDoc;
    }
}
