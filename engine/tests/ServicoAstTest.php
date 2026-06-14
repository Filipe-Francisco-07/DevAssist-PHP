<?php

use PHPUnit\Framework\TestCase;
use App\Parser\ServicoAst;

final class ServicoAstTest extends TestCase
{
    private ServicoAst $sut;

    protected function setUp(): void
    {
        $this->sut = new ServicoAst();
    }

    // -------------------------------------------------------------------------
    // analisarCodigo
    // -------------------------------------------------------------------------

    public function test_analisar_codigo_valido_retorna_ast_nao_vazia(): void
    {
        [$ast, $erros] = $this->sut->analisarCodigo('<?php function foo() {}');

        $this->assertNotEmpty($ast);
        $this->assertEmpty($erros);
    }

    public function test_analisar_codigo_com_classe_retorna_ast(): void
    {
        [$ast, $erros] = $this->sut->analisarCodigo(
            '<?php class Foo { public function bar(): void {} }'
        );

        $this->assertNotEmpty($ast);
        $this->assertEmpty($erros);
    }

    public function test_analisar_codigo_invalido_retorna_erros(): void
    {
        [$ast, $erros] = $this->sut->analisarCodigo('<?php function (');

        $this->assertNotEmpty($erros);
        $this->assertArrayHasKey('mensagem', $erros[0]);
        $this->assertIsString($erros[0]['mensagem']);
    }

    public function test_analisar_codigo_vazio_retorna_arrays(): void
    {
        [$ast, $erros] = $this->sut->analisarCodigo('');

        $this->assertIsArray($ast);
        $this->assertIsArray($erros);
    }

    public function test_retorno_sempre_tem_dois_elementos(): void
    {
        $resultado = $this->sut->analisarCodigo('<?php echo 1;');

        $this->assertCount(2, $resultado);
        $this->assertIsArray($resultado[0]);
        $this->assertIsArray($resultado[1]);
    }

    public function test_analisar_codigo_resolve_namespace_sem_erros(): void
    {
        $codigo = '<?php namespace App\\Servicos; class MeuServico {}';
        [$ast, $erros] = $this->sut->analisarCodigo($codigo);

        $this->assertEmpty($erros);
        $this->assertNotEmpty($ast);
    }

    // -------------------------------------------------------------------------
    // analisarArquivo
    // -------------------------------------------------------------------------

    public function test_analisar_arquivo_inexistente_retorna_erro(): void
    {
        [$ast, $erros] = $this->sut->analisarArquivo('/nao/existe/arquivo.php');

        $this->assertEmpty($ast);
        $this->assertNotEmpty($erros);
        $this->assertStringContainsString('não encontrado', $erros[0]['mensagem']);
    }

    public function test_analisar_arquivo_valido_retorna_ast(): void
    {
        $tmp = tempnam(sys_get_temp_dir(), 'docgen_ast_');
        file_put_contents($tmp, '<?php function hello(): string { return "oi"; }');

        [$ast, $erros] = $this->sut->analisarArquivo($tmp);
        unlink($tmp);

        $this->assertNotEmpty($ast);
        $this->assertEmpty($erros);
    }
}
