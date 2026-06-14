<?php

use PHPUnit\Framework\TestCase;
use Generator\ClienteOpenAI;
use Generator\ClienteGemini;
use Generator\FabricaClienteLLM;
use Generator\ClienteLLMInterface;

/**
 * Testes de integração para os clientes LLM.
 *
 * Os testes que chamam APIs reais são pulados automaticamente
 * se a variável de ambiente LLM_API_KEY (ou OPENAI_API_KEY) não estiver definida.
 */
final class ClienteGPTTest extends TestCase
{
    private function apiKey(): string
    {
        return getenv('LLM_API_KEY') ?: getenv('OPENAI_API_KEY') ?: '';
    }

    private function promptSimples(): string
    {
        return <<<PROMPT
Gere APENAS um DocBlock PHPDoc válido entre /** e */. Não use crases.

Alvo: function somar (linhas 1-3)

REGRAS:
- Descreva objetivamente o que o corpo FAZ, não o nome.
- @param para cada parâmetro na ordem, com propósito.
- @return int coerente com o corpo.

METADADOS (JSON):
{"type":"function","fqn":"somar","params":[{"name":"a","type":"int"},{"name":"b","type":"int"}],"returnType":"int"}

TRECHO DO CÓDIGO (início→fim do elemento):
function somar(int \$a, int \$b): int {
    return \$a + \$b;
}
PROMPT;
    }

    // -------------------------------------------------------------------------
    // Testes unitários (sem API)
    // -------------------------------------------------------------------------

    public function test_clientes_implementam_interface(): void
    {
        $this->assertInstanceOf(ClienteLLMInterface::class, new ClienteOpenAI());
        $this->assertInstanceOf(ClienteLLMInterface::class, new ClienteGemini());
    }

    public function test_fabrica_retorna_openai_por_padrao(): void
    {
        putenv('LLM_PROVIDER=openai');
        $cliente = FabricaClienteLLM::criar();
        $this->assertInstanceOf(ClienteOpenAI::class, $cliente);
        putenv('LLM_PROVIDER');
    }

    public function test_fabrica_retorna_gemini_quando_configurado(): void
    {
        putenv('LLM_PROVIDER=gemini');
        $cliente = FabricaClienteLLM::criar();
        $this->assertInstanceOf(ClienteGemini::class, $cliente);
        putenv('LLM_PROVIDER');
    }

    public function test_fabrica_lanca_excecao_para_provedor_invalido(): void
    {
        $this->expectException(\RuntimeException::class);
        putenv('LLM_PROVIDER=inexistente');
        try {
            FabricaClienteLLM::criar();
        } finally {
            putenv('LLM_PROVIDER');
        }
    }

    public function test_resolver_config_retorna_campos_obrigatorios(): void
    {
        $config = FabricaClienteLLM::resolverConfig();

        $this->assertArrayHasKey('provider', $config);
        $this->assertArrayHasKey('apiKey',   $config);
        $this->assertArrayHasKey('model',    $config);
        $this->assertArrayHasKey('base',     $config);
    }

    public function test_openai_retorna_null_com_api_key_invalida(): void
    {
        $cliente   = new ClienteOpenAI();
        $resultado = $cliente->gerar(
            'https://api.openai.com/v1',
            'sk-invalida-00000000000000000000',
            'gpt-4o-mini',
            $this->promptSimples()
        );

        $this->assertNull($resultado);
    }

    // -------------------------------------------------------------------------
    // Testes de integração (requerem API key real)
    // -------------------------------------------------------------------------

    public function test_openai_gerar_retorna_docblock_valido(): void
    {
        $key = $this->apiKey();
        if ($key === '' || getenv('LLM_PROVIDER') === 'gemini') {
            $this->markTestSkipped('OPENAI_API_KEY ou LLM_API_KEY não configurada.');
        }

        $cliente   = new ClienteOpenAI();
        $resultado = $cliente->gerar(
            'https://api.openai.com/v1',
            $key,
            'gpt-4o-mini',
            $this->promptSimples()
        );

        $this->assertNotNull($resultado);
        $this->assertStringStartsWith('/**', $resultado);
        $this->assertStringContainsString('*/', $resultado);
    }

    public function test_gemini_gerar_retorna_docblock_valido(): void
    {
        $key = $this->apiKey();
        if ($key === '' || getenv('LLM_PROVIDER') !== 'gemini') {
            $this->markTestSkipped('LLM_PROVIDER=gemini e LLM_API_KEY não configurados.');
        }

        $cliente   = new ClienteGemini();
        $resultado = $cliente->gerar(
            'https://generativelanguage.googleapis.com/v1beta',
            $key,
            'gemini-1.5-flash',
            $this->promptSimples()
        );

        $this->assertNotNull($resultado);
        $this->assertStringStartsWith('/**', $resultado);
        $this->assertStringContainsString('*/', $resultado);
    }
}
