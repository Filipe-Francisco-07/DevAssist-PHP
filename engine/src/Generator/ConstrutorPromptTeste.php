<?php

namespace Generator;

/**
 * Constrói prompts para geração de testes PHPUnit via LLM.
 *
 * Diferente do ConstrutorPrompt (que gera docblocks), esta classe
 * monta um prompt focado em gerar uma classe de teste completa
 * para cada classe PHP do usuário.
 */
final class ConstrutorPromptTeste
{
    /**
     * Constrói o prompt de geração de testes para uma classe PHP.
     *
     * @param array  $aClasse      Metadados da classe (type, fqn, name, namespace, methods).
     * @param array  $aMetodos     Lista de metadados de cada método público da classe.
     * @param string $sCodigo      Código-fonte completo do arquivo.
     * @return string              Prompt pronto para enviar à LLM.
     */
    public function construir(array $aClasse, array $aMetodos, string $sCodigo): string
    {
        $sClassName = $aClasse['name'] ?? ($aClasse['fqn'] ?? 'Classe');
        $sFqn = $aClasse['fqn'] ?? $sClassName;
        $sNamespace = $aClasse['namespace'] ?? '';

        $sTestNamespace = $sNamespace
            ? 'Tests\\' . $sNamespace
            : 'Tests';

        $sTestClass = $sClassName . 'Test';

        // Resumo dos métodos públicos
        $aResumoMetodos = array_map(function (array $m): array {
            return [
                'name' => $m['name'] ?? '?',
                'params' => array_map(
                    fn($p) => ($p['type'] ?? 'mixed') . ' $' . ($p['name'] ?? 'arg'),
                    $m['params'] ?? []
                ),
                'returnType' => $m['returnType'] ?? 'mixed',
                'throws' => $m['throws'] ?? [],
                'efeitos' => $m['efeitos_colaterais'] ?? [],
            ];
        }, $aMetodos);

        $sMetaJson = json_encode([
            'class' => $sFqn,
            'namespace' => $sNamespace,
            'methods' => $aResumoMetodos,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return <<<PROMPT
            Gere uma classe PHPUnit completa para a classe abaixo. Retorne APENAS o código PHP, começando com <?php.

            ESTRUTURA OBRIGATÓRIA:
            - namespace {$sTestNamespace};
            - use PHPUnit\\Framework\\TestCase;
            - use {$sFqn};
            - class {$sTestClass} extends TestCase
            - Nomes de teste: test_nomeDoMetodo_oQueEsta Testando()

            REGRAS:
            1. Para cada assertEquals, escolha parâmetros simples e calcule o retorno exato lendo o código linha a linha.
            Exemplo: se o método faz "return \$a + \$b" e você passa (3, 4), escreva assertEquals(7, ...).
            2. Só use expectException() se o método tiver "throw" explícito. Se não tiver throw, não teste exceção.
            3. Para exceções PHP nativas, sempre use barra inicial: \\Exception, \\InvalidArgumentException, \\RuntimeException, \\DivisionByZeroError.
            4. Se não tiver certeza do valor retornado, use assertNotNull() ou assertIsString/assertIsInt em vez de adivinhar.
            5. Crie instância real da classe (sem mock). Use setUp() se reutilizar.

            METADADOS (JSON):
            {$sMetaJson}

            CÓDIGO-FONTE (leia com atenção antes de escrever qualquer asserção):
            {$sCodigo}
        PROMPT;
    }
}
