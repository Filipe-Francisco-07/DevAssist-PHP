<?php

namespace Generator;

/**
 * Classe responsável por gerar DocBlocks PHPDoc a partir de informações fornecidas em um array e um contexto de código.
 */
final class ConstrutorPrompt
{

    /**
     * Gera um DocBlock PHPDoc válido com base nas informações fornecidas.
     * 
     * Este método processa um item de array e um código de contexto, extraindo informações relevantes e formatando-as em um JSON.
     * 
     * @param array $aItem Informações do item, incluindo tipo, FQN, parâmetros e tipo de retorno.
     * @param string $sCodigoContexto Código de contexto onde o item está localizado.
     * @return string Retorna uma string formatada em JSON com os metadados do item.
     */
    public function construir(array $aItem, string $sCodigoContexto): string
    {
        $sTipo = $aItem['type'] ?? 'desconhecido';
        $sFqn = $aItem['fqn'] ?? ($aItem['name'] ?? '');
        $iIniLn = (int) ($aItem['line'] ?? 1);
        $iFimLn = (int) ($aItem['endLine'] ?? ($iIniLn + 1));

        $aLinhas = preg_split('/\R/u', $sCodigoContexto);
        $iIni0 = max(0, $iIniLn - 1);
        $iFim0 = min(count($aLinhas), $iFimLn);
        $sTrecho = implode("\n", array_slice($aLinhas, $iIni0, $iFim0 - $iIni0));

        $aMeta = [
            'type' => $sTipo,
            'fqn' => $sFqn,
            'params' => $aItem['params'] ?? [],
            'returnType' => $aItem['returnType'] ?? null,
            'modificadores' => $aItem['modificadores'] ?? [],
            'atributos' => $aItem['atributos'] ?? [],
            'heranca' => $aItem['heranca'] ?? null,
            'tipos_uso' => $aItem['tipos_uso'] ?? [],
            'operadores' => $aItem['operadores'] ?? [],
            'operacao_principal' => $aItem['operacao_principal'] ?? null,
            'throws' => $aItem['throws'] ?? [],
            'exceptions_capturadas' => $aItem['exceptions_capturadas'] ?? [],
            'efeitos' => $aItem['efeitos_colaterais'] ?? [],
            'retornos' => $aItem['retornos'] ?? [],
            'complexidade' => $aItem['complexidade'] ?? [],
            'checagens' => $aItem['checagens'] ?? [],
            'recursivo' => $aItem['recursivo'] ?? false,
            'eh_generator' => $aItem['eh_generator'] ?? false,
            'instanciacoes' => $aItem['instanciacoes'] ?? [],
            'propriedades_acessadas' => $aItem['propriedades_acessadas'] ?? [],
            'type_casts' => $aItem['type_casts'] ?? [],
            'closures' => $aItem['closures'] ?? 0,
            'magic_methods' => $aItem['magic_methods'] ?? [],
            'dependencias_construtor' => $aItem['dependencias_construtor'] ?? [],
            'metodos_resumo' => $aItem['metodos_resumo'] ?? [],
            'linhas' => ['start' => $iIniLn, 'end' => $iFimLn, 'loc' => max(1, $iFimLn - $iIniLn + 1)],
            'chamadas' => array_values(array_slice($aItem['chamadas'] ?? [], 0, 10)),
        ];
        $sMetaJson = json_encode($aMeta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $sAss = $sTipo . ' ' . $sFqn;
        $sRet = $aItem['returnType'] ?? 'mixed';

        if ($sTipo === 'function' || $sTipo === 'method') {
            $aHints = [];
            if ($aItem['recursivo'] ?? false) {
                $aHints[] = "metodo RECURSIVO: mencione isso na descricao.";
            }
            if ($aItem['eh_generator'] ?? false) {
                $aHints[] = "metodo GENERATOR (usa yield): @return deve ser Generator ou iterable.";
            }
            if (!empty($aItem['instanciacoes'] ?? [])) {
                $aHints[] = "instancia internamente: " . implode(', ', $aItem['instanciacoes']);
            }
            if (!empty($aItem['exceptions_capturadas'] ?? [])) {
                $aHints[] = "captura excecoes: " . implode(', ', $aItem['exceptions_capturadas']);
            }
            $sHints = $aHints ? "\n- DICAS ADICIONAIS: " . implode('; ', $aHints) : '';

            $sRegras = "- Descreva objetivamente o que o corpo FAZ, nao o nome.\n"
                . "- Uma frase de descricao. Linha em branco.\n"
                . "- @param para cada parametro na ordem, com proposito.\n"
                . "- @return {$sRet} coerente com o corpo.\n"
                . "- Inclua @throws para cada excecao em 'throws' dos metadados. Nao invente outros."
                . $sHints;
        } elseif ($sTipo === 'class' || $sTipo === 'interface' || $sTipo === 'trait' || $sTipo === 'enum') {
            $sDeps = !empty($aItem['dependencias_construtor'] ?? [])
                ? implode(', ', array_column($aItem['dependencias_construtor'], 'type'))
                : '';
            $sMagic = !empty($aItem['magic_methods'] ?? [])
                ? implode(', ', $aItem['magic_methods'])
                : '';
            $sRegras = "- Papel/responsabilidade em 1-2 linhas. Sem @param/@return."
                . ($sDeps ? "\n- Depende de (via construtor): {$sDeps}." : '')
                . ($sMagic ? "\n- Implementa: {$sMagic}." : '');
        } elseif ($sTipo === 'property') {
            $sRegras = "- Descricao curta. Use @var <tipo> descricao. Sem @param/@return.";
        } elseif ($sTipo === 'constant') {
            $sRegras = "- Descricao curta. Sem @param/@return.";
        } else {
            $sRegras = "- Descricao curta baseada no corpo/metadata.";
        }

        return <<<PROMPT
            Gere APENAS um DocBlock PHPDoc válido entre /** e */. Não use crases.
            Se metadados e nomes divergirem do corpo, documente PELO CORPO.

            Alvo: {$sAss} (linhas {$iIniLn}-{$iFimLn})

            REGRAS:
            {$sRegras}

            METADADOS (JSON):
            {$sMetaJson}

            TRECHO DO CÓDIGO (início→fim do elemento):
            {$sTrecho}
        PROMPT;
    }
}
