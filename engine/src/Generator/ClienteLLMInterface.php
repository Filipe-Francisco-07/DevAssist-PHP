<?php

namespace Generator;

/**
 * Contrato para clientes de LLM utilizados na geração de DocBlocks.
 *
 * Qualquer provedor (OpenAI, Gemini, etc.) deve implementar esta interface
 * para ser compatível com o pipeline de documentação.
 */
interface ClienteLLMInterface
{
    /**
     * Envia um prompt ao modelo e retorna o DocBlock gerado.
     *
     * @param string $sBase    URL base da API do provedor.
     * @param string $sApiKey  Chave de autenticação da API.
     * @param string $sModelo  Identificador do modelo a ser usado.
     * @param string $sPrompt  Prompt com metadados e código-fonte do elemento.
     * @return string|null     DocBlock PHPDoc gerado, ou null em caso de falha.
     */
    public function gerar(string $sBase, string $sApiKey, string $sModelo, string $sPrompt, string $sSystem = ''): ?string;
}
