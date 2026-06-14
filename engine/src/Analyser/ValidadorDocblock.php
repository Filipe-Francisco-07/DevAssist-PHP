<?php

namespace Analyser;

/**
 * Classe responsável por validar se a documentação de um nó é completa.
 * 
 * Esta classe é utilizada para verificar se a documentação de um nó é completa,
 * adicionando informações relevantes à lista de itens.
 */
final class ValidadorDocblock
{
    /**
     * Valida se a documentação de um nó é completa.
     * 
     * @param array $aItem Array que representa o item a ser validado.
     * @return bool True se a documentação for completa, false caso contrário.
     */
    public function precisaGerar(array $aItem): bool
    {
        $sDoc = $aItem['doc'] ?? null;

        if (!$sDoc) {
            return true;
        }

        $sDoc = trim($sDoc);

        if ($sDoc === '/** */') {
            return true;
        }

        $sTipo = $aItem['type'] ?? '';

        if ($sTipo === 'method' || $sTipo === 'function') {
            return $this->docMetodoIncompleta($sDoc, $aItem);
        }

        if ($sTipo === 'property') {
            return !str_contains($sDoc, '@var');
        }

        return false;
    }

    /**
     * Valida se a documentação de um método ou função é incompleta.
     * 
     * @param string $sDoc String contendo a documentação do método ou função.
     * @param array $aItem Array que representa o item a ser validado.
     * @return bool True se a documentação for incompleta, false caso contrário.
     */
    private function docMetodoIncompleta(string $sDoc, array $aItem): bool
    {
        $aParams = $aItem['params'] ?? [];

        foreach ($aParams as $aParam) {
            $sNome = $aParam['name'] ?? '';
            if ($sNome !== '' && !str_contains($sDoc, $sNome)) {
                return true;
            }
        }

        if (!str_contains($sDoc, '@return')) {
            return true;
        }

        $aThrows = $aItem['throws'] ?? [];
        if (!empty($aThrows) && !str_contains($sDoc, '@throws')) {
            return true;
        }

        return false;
    }
}
