<?php

namespace Generator;

/**
 * Factory responsável por instanciar o cliente LLM correto com base na variável de ambiente LLM_PROVIDER.
 */
final class FabricaClienteLLM
{
    /**
     * Retorna uma instância do cliente LLM configurado pelo ambiente.
     *
     * @return ClienteLLMInterface Cliente pronto para uso.
     * @throws \RuntimeException   Se o provedor informado não for suportado.
     */
    public static function criar(): ClienteLLMInterface
    {
        $sProvider = strtolower(getenv('LLM_PROVIDER') ?: 'openai');

        return match ($sProvider) {
            'openai' => new ClienteOpenAI(),
            'gemini' => new ClienteGemini(),
            default => throw new \RuntimeException(
                "Provedor LLM não suportado: '{$sProvider}'. Use 'openai' ou 'gemini'."
            ),
        };
    }

    /**
     * Resolve as variáveis de ambiente de configuração do LLM.
     *
     * Aceita o padrão novo (LLM_*) com fallback para o padrão antigo (OPENAI_*).
     *
     * @return array{provider: string, apiKey: string, model: string, base: string}
     */
    public static function resolverConfig(): array
    {
        $sProvider = strtolower(getenv('LLM_PROVIDER') ?: 'openai');

        $sApiKey = getenv('LLM_API_KEY')
            ?: getenv('OPENAI_API_KEY')
            ?: '';

        $sModel = getenv('LLM_MODEL')
            ?: getenv('OPENAI_MODEL')
            ?: self::modeloPadrao($sProvider);

        $sBase = getenv('LLM_BASE')
            ?: getenv('OPENAI_BASE')
            ?: self::basePadrao($sProvider);

        return [
            'provider' => $sProvider,
            'apiKey' => $sApiKey,
            'model' => $sModel,
            'base' => $sBase,
        ];
    }

    /**
     * Retorna o modelo padrão para cada provedor.
     *
     * @param string $sProvider Nome do provedor.
     * @return string           Modelo padrão.
     */
    private static function modeloPadrao(string $sProvider): string
    {
        return match ($sProvider) {
            'gemini' => 'gemini-1.5-flash',
            default => 'gpt-4o-mini',
        };
    }

    /**
     * Retorna a URL base padrão para cada provedor.
     *
     * @param string $sProvider Nome do provedor.
     * @return string           URL base da API.
     */
    private static function basePadrao(string $sProvider): string
    {
        return match ($sProvider) {
            'gemini' => 'https://generativelanguage.googleapis.com/v1beta',
            default => 'https://api.openai.com/v1',
        };
    }
}
