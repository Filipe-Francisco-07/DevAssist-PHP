<?php

use PHPUnit\Framework\TestCase;
use App\Parser\Normalizador;

final class NormalizadorTest extends TestCase
{
    private Normalizador $sut;

    protected function setUp(): void
    {
        $this->sut = new Normalizador();
    }

    public function test_codigo_com_tag_php_retorna_sem_alteracao(): void
    {
        $raw = "<?php\necho 'ola';";
        [$codigo, $isFragment, $linhasAdd] = $this->sut->normalizar($raw);

        $this->assertSame($raw, $codigo);
        $this->assertFalse($isFragment);
        $this->assertSame(0, $linhasAdd);
    }

    public function test_classe_sem_tag_php_e_envolvida(): void
    {
        $raw = "class Foo {}";
        [$codigo, $isFragment, $linhasAdd] = $this->sut->normalizar($raw);

        $this->assertStringStartsWith('<?php', $codigo);
        $this->assertStringContainsString('class Foo {}', $codigo);
        $this->assertTrue($isFragment);
        $this->assertSame(1, $linhasAdd);
    }

    public function test_interface_sem_tag_php_e_envolvida(): void
    {
        $raw = "interface Contrato {}";
        [$codigo, $isFragment] = $this->sut->normalizar($raw);

        $this->assertStringContainsString('<?php', $codigo);
        $this->assertTrue($isFragment);
    }

    public function test_metodo_com_visibilidade_e_envolvido_em_classe_temporaria(): void
    {
        $raw = "public function foo(): void {}";
        [$codigo, $isFragment, $linhasAdd] = $this->sut->normalizar($raw);

        $this->assertStringContainsString('class __Tmp__', $codigo);
        $this->assertStringContainsString('public function foo()', $codigo);
        $this->assertTrue($isFragment);
        $this->assertSame(2, $linhasAdd);
    }

    public function test_metodo_protegido_e_envolvido_em_classe_temporaria(): void
    {
        $raw = "protected function bar(): string { return ''; }";
        [$codigo, $isFragment] = $this->sut->normalizar($raw);

        $this->assertStringContainsString('class __Tmp__', $codigo);
        $this->assertTrue($isFragment);
    }

    public function test_funcao_standalone_e_envolvida(): void
    {
        $raw = "function somar(int \$a, int \$b): int { return \$a + \$b; }";
        [$codigo, $isFragment, $linhasAdd] = $this->sut->normalizar($raw);

        $this->assertStringStartsWith('<?php', $codigo);
        $this->assertStringContainsString('function somar', $codigo);
        $this->assertTrue($isFragment);
        $this->assertSame(1, $linhasAdd);
    }

    public function test_namespace_e_envolvido_com_tag_php(): void
    {
        $raw = "namespace App\\Servicos;";
        [$codigo, $isFragment] = $this->sut->normalizar($raw);

        $this->assertStringStartsWith('<?php', $codigo);
        $this->assertTrue($isFragment);
    }

    public function test_use_e_envolvido_com_tag_php(): void
    {
        $raw = "use App\\Servicos\\Foo;";
        [$codigo, $isFragment] = $this->sut->normalizar($raw);

        $this->assertStringStartsWith('<?php', $codigo);
        $this->assertTrue($isFragment);
    }

    public function test_expressao_generica_e_envolvida_em_funcao_temporaria(): void
    {
        $raw = '$x = 1 + 2;';
        [$codigo, $isFragment, $linhasAdd] = $this->sut->normalizar($raw);

        $this->assertStringContainsString('function __tmp__', $codigo);
        $this->assertTrue($isFragment);
        $this->assertSame(2, $linhasAdd);
    }

    public function test_retorna_array_com_tres_elementos(): void
    {
        $resultado = $this->sut->normalizar('class X {}');

        $this->assertCount(3, $resultado);
    }
}
