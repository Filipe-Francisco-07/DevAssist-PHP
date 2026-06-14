<?php

use PHPUnit\Framework\TestCase;
use Generator\ConstrutorPrompt;

final class ConstrutorPromptTest extends TestCase
{
    private ConstrutorPrompt $sut;

    protected function setUp(): void
    {
        $this->sut = new ConstrutorPrompt();
    }

    private function itemFunction(): array
    {
        return [
            'type'       => 'function',
            'fqn'        => 'App\\Util\\somar',
            'name'       => 'somar',
            'line'       => 3,
            'endLine'    => 5,
            'params'     => [
                ['name' => 'a', 'type' => 'int', 'default' => null, 'variadic' => false, 'byRef' => false],
                ['name' => 'b', 'type' => 'int', 'default' => null, 'variadic' => false, 'byRef' => false],
            ],
            'returnType' => 'int',
        ];
    }

    private function codigoContexto(): string
    {
        return "<?php\nnamespace App\\Util;\n\nfunction somar(int \$a, int \$b): int {\n    return \$a + \$b;\n}\n";
    }

    public function test_construir_retorna_string_nao_vazia(): void
    {
        $resultado = $this->sut->construir($this->itemFunction(), $this->codigoContexto());

        $this->assertIsString($resultado);
        $this->assertNotEmpty($resultado);
    }

    public function test_construir_contem_fqn_do_item(): void
    {
        $resultado = $this->sut->construir($this->itemFunction(), $this->codigoContexto());

        $this->assertStringContainsString('App\\Util\\somar', $resultado);
    }

    public function test_construir_contem_metadados_json(): void
    {
        $resultado = $this->sut->construir($this->itemFunction(), $this->codigoContexto());

        $this->assertStringContainsString('METADADOS (JSON):', $resultado);
        $this->assertStringContainsString('"type"', $resultado);
        $this->assertStringContainsString('"params"', $resultado);
        $this->assertStringContainsString('"returnType"', $resultado);
    }

    public function test_construir_contem_trecho_do_codigo(): void
    {
        $resultado = $this->sut->construir($this->itemFunction(), $this->codigoContexto());

        $this->assertStringContainsString('TRECHO DO CÓDIGO', $resultado);
        $this->assertStringContainsString('somar', $resultado);
    }

    public function test_construir_function_inclui_regras_de_param_e_return(): void
    {
        $resultado = $this->sut->construir($this->itemFunction(), $this->codigoContexto());

        $this->assertStringContainsString('@param', $resultado);
        $this->assertStringContainsString('@return', $resultado);
    }

    public function test_construir_class_inclui_regras_de_classe(): void
    {
        $item = [
            'type'    => 'class',
            'fqn'     => 'App\\Servico',
            'name'    => 'Servico',
            'line'    => 1,
            'endLine' => 10,
        ];
        $codigo    = "<?php\nclass Servico {}\n";
        $resultado = $this->sut->construir($item, $codigo);

        $this->assertStringContainsString('responsabilidade', $resultado);
        $this->assertStringNotContainsString('@return {', $resultado);
    }

    public function test_construir_property_menciona_var(): void
    {
        $item = [
            'type'    => 'property',
            'fqn'     => 'App\\Servico::$nome',
            'name'    => 'nome',
            'line'    => 3,
            'endLine' => 3,
        ];
        $codigo    = "<?php\nclass Servico {\n    public string \$nome;\n}\n";
        $resultado = $this->sut->construir($item, $codigo);

        $this->assertStringContainsString('@var', $resultado);
    }

    public function test_construir_json_e_valido(): void
    {
        $resultado = $this->sut->construir($this->itemFunction(), $this->codigoContexto());

        // Extrai o JSON do prompt (pode ter espaços de indentação antes das labels)
        preg_match('/METADADOS \(JSON\):\s*\n\s*(.+?)\s*\n\s*\n\s*TRECHO/s', $resultado, $m);
        $this->assertNotEmpty($m[1] ?? null, 'JSON de metadados não encontrado no prompt');

        $decoded = json_decode(trim($m[1]), true);
        $this->assertNotNull($decoded, 'JSON de metadados inválido: ' . json_last_error_msg());
    }
}
