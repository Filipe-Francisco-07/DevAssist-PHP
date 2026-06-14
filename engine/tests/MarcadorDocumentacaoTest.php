<?php

use PHPUnit\Framework\TestCase;
use Analyser\MarcadorDocumentacao;
use App\Parser\ServicoAst;
use PhpParser\NodeTraverser;

final class MarcadorDocumentacaoTest extends TestCase
{
    private function executar(string $codigo): array
    {
        $ast = (new ServicoAst())->analisarCodigo($codigo)[0];

        $marcador = new MarcadorDocumentacao();
        $tr       = new NodeTraverser();
        $tr->addVisitor($marcador);
        $tr->traverse($ast);

        return $marcador->aItens;
    }

    public function test_encontra_classe_simples(): void
    {
        $itens = $this->executar('<?php class MinhaClasse {}');

        $tipos = array_column($itens, 'type');
        $this->assertContains('class', $tipos);
    }

    public function test_encontra_metodo_publico(): void
    {
        $itens = $this->executar('<?php class Foo { public function bar(): void {} }');

        $tipos = array_column($itens, 'type');
        $this->assertContains('method', $tipos);
    }

    public function test_encontra_funcao_standalone(): void
    {
        $itens = $this->executar('<?php function somar(int $a, int $b): int { return $a + $b; }');

        $tipos = array_column($itens, 'type');
        $this->assertContains('function', $tipos);
    }

    public function test_metodo_tem_parametros(): void
    {
        $itens = $this->executar(
            '<?php class X { public function processar(string $nome, int $id): void {} }'
        );

        $metodo = array_values(array_filter($itens, fn($i) => $i['type'] === 'method'))[0] ?? null;
        $this->assertNotNull($metodo);
        $this->assertCount(2, $metodo['params']);

        $nomes = array_column($metodo['params'], 'name');
        $this->assertContains('$nome', $nomes);
        $this->assertContains('$id', $nomes);
    }

    public function test_metodo_tem_tipo_de_retorno(): void
    {
        $itens = $this->executar(
            '<?php class X { public function obter(): string { return ""; } }'
        );

        $metodo = array_values(array_filter($itens, fn($i) => $i['type'] === 'method'))[0] ?? null;
        $this->assertNotNull($metodo);
        $this->assertSame('string', $metodo['returnType']);
    }

    public function test_encontra_propriedade(): void
    {
        $itens = $this->executar('<?php class Foo { public string $nome; }');

        $tipos = array_column($itens, 'type');
        $this->assertContains('property', $tipos);
    }

    public function test_item_tem_campos_essenciais(): void
    {
        $itens = $this->executar('<?php function test(): void {}');

        $this->assertNotEmpty($itens);
        $item = $itens[0];

        $this->assertArrayHasKey('id',      $item);
        $this->assertArrayHasKey('type',    $item);
        $this->assertArrayHasKey('name',    $item);
        $this->assertArrayHasKey('line',    $item);
        $this->assertArrayHasKey('endLine', $item);
    }

    public function test_cada_item_tem_id_unico(): void
    {
        $itens = $this->executar(
            '<?php class X { public function a(): void {} public function b(): void {} }'
        );

        $ids = array_column($itens, 'id');
        $this->assertCount(count($ids), array_unique($ids), 'IDs duplicados encontrados');
    }

    public function test_codigo_vazio_retorna_sem_itens(): void
    {
        $itens = $this->executar('<?php');

        $this->assertIsArray($itens);
        $this->assertEmpty($itens);
    }
}
