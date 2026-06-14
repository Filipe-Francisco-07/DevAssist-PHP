<?php

use PHPUnit\Framework\TestCase;
use Generator\AplicadorDocumentacao;

final class AplicadorDocumentacaoTest extends TestCase
{
    private AplicadorDocumentacao $sut;

    protected function setUp(): void
    {
        $this->sut = new AplicadorDocumentacao();
    }

    public function test_substitui_placeholder_por_docblock(): void
    {
        $conteudo = "{{doc_1}}\nfunction foo() {}";
        $docs     = ['doc_1' => "/**\n * Foo.\n */"];

        $resultado = $this->sut->aplicar($conteudo, $docs);

        $this->assertStringContainsString('/**', $resultado);
        $this->assertStringContainsString('Foo.', $resultado);
        $this->assertStringNotContainsString('{{doc_1}}', $resultado);
    }

    public function test_aceita_chave_numerica(): void
    {
        $conteudo = "{{doc_1}}\nfunction bar() {}";
        $docs     = ['1' => "/**\n * Bar.\n */"];

        $resultado = $this->sut->aplicar($conteudo, $docs);

        $this->assertStringContainsString('Bar.', $resultado);
        $this->assertStringNotContainsString('{{doc_1}}', $resultado);
    }

    public function test_ignora_placeholder_sem_doc_correspondente(): void
    {
        $conteudo = "{{doc_99}}\nfunction baz() {}";
        $docs     = [];

        $resultado = $this->sut->aplicar($conteudo, $docs);

        $this->assertStringContainsString('{{doc_99}}', $resultado);
    }

    public function test_multiplos_placeholders_substituidos(): void
    {
        $conteudo = "{{doc_1}}\nfunction a() {}\n{{doc_2}}\nfunction b() {}";
        $docs     = [
            'doc_1' => "/**\n * A.\n */",
            'doc_2' => "/**\n * B.\n */",
        ];

        $resultado = $this->sut->aplicar($conteudo, $docs);

        $this->assertStringContainsString('A.', $resultado);
        $this->assertStringContainsString('B.', $resultado);
        $this->assertStringNotContainsString('{{doc_1}}', $resultado);
        $this->assertStringNotContainsString('{{doc_2}}', $resultado);
    }

    public function test_preserva_indentacao_baseada_na_linha_seguinte(): void
    {
        $conteudo = "    {{doc_1}}\n    function foo() {}";
        $docs     = ['doc_1' => "/**\n * Indentado.\n */"];

        $resultado = $this->sut->aplicar($conteudo, $docs);

        // cada linha do docblock deve estar indentada
        foreach (explode("\n", "/**\n * Indentado.\n */") as $linha) {
            if (trim($linha) === '') continue;
            $this->assertMatchesRegularExpression('/^\s+/', $linha === '/**' ? '    /**' : $linha);
        }

        $this->assertStringContainsString('Indentado.', $resultado);
    }

    public function test_conteudo_sem_placeholders_retornado_sem_alteracao(): void
    {
        $conteudo = "<?php\nfunction foo() {}";
        $resultado = $this->sut->aplicar($conteudo, []);

        $this->assertSame($conteudo, $resultado);
    }

    public function test_normaliza_crlf_para_lf(): void
    {
        $conteudo  = "{{doc_1}}\r\nfunction foo() {}";
        $docs      = ['doc_1' => "/**\n * Crlf.\n */"];
        $resultado = $this->sut->aplicar($conteudo, $docs);

        $this->assertStringNotContainsString("\r\n", $resultado);
    }
}
