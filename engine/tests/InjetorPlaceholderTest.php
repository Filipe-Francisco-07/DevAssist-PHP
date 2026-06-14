<?php

use PHPUnit\Framework\TestCase;
use Util\InjetorPlaceholder;

final class InjetorPlaceholderTest extends TestCase
{
    private InjetorPlaceholder $sut;
    /** @var string[] */
    private array $tempFiles = [];

    protected function setUp(): void
    {
        $this->sut = new InjetorPlaceholder();
    }

    protected function tearDown(): void
    {
        foreach ($this->tempFiles as $f) {
            if (file_exists($f)) unlink($f);
        }
    }

    private function criarArquivoTemp(string $conteudo): string
    {
        $path = tempnam(sys_get_temp_dir(), 'docgen_injetor_');
        file_put_contents($path, $conteudo);
        $this->tempFiles[] = $path;
        return $path;
    }

    public function test_injeta_placeholder_antes_da_linha_alvo(): void
    {
        $arquivo = $this->criarArquivoTemp("<?php\nfunction foo() {}\n");
        $mapa    = [['id' => 'doc_1', 'line' => 2, 'doc_start' => null, 'doc_end' => null]];

        $resultado = $this->sut->injetar($arquivo, $mapa);

        $this->assertStringContainsString('{{doc_1}}', $resultado);
        $this->assertStringContainsString('function foo()', $resultado);
    }

    public function test_placeholder_aparece_antes_da_funcao(): void
    {
        $arquivo = $this->criarArquivoTemp("<?php\nfunction bar(): void {}\n");
        $mapa    = [['id' => 'doc_1', 'line' => 2, 'doc_start' => null, 'doc_end' => null]];

        $resultado = $this->sut->injetar($arquivo, $mapa);
        $linhas    = explode("\n", $resultado);

        $idxPH  = array_search('{{doc_1}}', $linhas);
        $idxFn  = array_search('function bar(): void {}', $linhas);

        $this->assertNotFalse($idxPH, 'Placeholder não encontrado');
        $this->assertNotFalse($idxFn, 'Função não encontrada');
        $this->assertLessThan($idxFn, $idxPH, 'Placeholder deve vir antes da função');
    }

    public function test_remove_docblock_existente_e_injeta_placeholder(): void
    {
        $conteudo = "<?php\n/**\n * Antiga.\n */\nfunction foo() {}\n";
        $arquivo  = $this->criarArquivoTemp($conteudo);
        $mapa     = [['id' => 'doc_1', 'line' => 5, 'doc_start' => 2, 'doc_end' => 4]];

        $resultado = $this->sut->injetar($arquivo, $mapa);

        $this->assertStringNotContainsString('Antiga.', $resultado);
        $this->assertStringContainsString('{{doc_1}}', $resultado);
    }

    public function test_multiplas_insercoes_mantem_ordem_correta(): void
    {
        $conteudo = "<?php\nfunction a() {}\nfunction b() {}\n";
        $arquivo  = $this->criarArquivoTemp($conteudo);
        $mapa     = [
            ['id' => 'doc_1', 'line' => 2, 'doc_start' => null, 'doc_end' => null],
            ['id' => 'doc_2', 'line' => 3, 'doc_start' => null, 'doc_end' => null],
        ];

        $resultado = $this->sut->injetar($arquivo, $mapa);

        $this->assertStringContainsString('{{doc_1}}', $resultado);
        $this->assertStringContainsString('{{doc_2}}', $resultado);

        $pos1 = strpos($resultado, '{{doc_1}}');
        $pos2 = strpos($resultado, '{{doc_2}}');
        $this->assertLessThan($pos2, $pos1);
    }

    public function test_arquivo_inexistente_retorna_string_vazia(): void
    {
        $resultado = $this->sut->injetar('/nao/existe/arquivo.php', []);
        $this->assertSame('', $resultado);
    }

    public function test_mapa_vazio_retorna_conteudo_original(): void
    {
        $conteudo = "<?php\necho 'teste';\n";
        $arquivo  = $this->criarArquivoTemp($conteudo);

        $resultado = $this->sut->injetar($arquivo, []);

        $this->assertSame($conteudo, $resultado);
    }
}
