<?php

use PHPUnit\Framework\TestCase;
use Util\RelatorErros;

final class RelatorErrosTest extends TestCase
{
    private string $tmpDir;

    protected function setUp(): void
    {
        $this->tmpDir = sys_get_temp_dir() . '/docgen_relator_' . uniqid();
    }

    protected function tearDown(): void
    {
        $file = $this->tmpDir . '/errors.json';
        if (file_exists($file)) unlink($file);
        if (is_dir($this->tmpDir)) rmdir($this->tmpDir);
    }

    public function test_cria_arquivo_errors_json(): void
    {
        $erros = [['mensagem' => 'Erro de teste', 'linha_inicio' => 1, 'linha_fim' => 1]];
        (new RelatorErros())->escrever($this->tmpDir, $erros);

        $this->assertFileExists($this->tmpDir . '/errors.json');
    }

    public function test_conteudo_do_arquivo_e_json_valido(): void
    {
        $erros = [['mensagem' => 'Falha', 'linha_inicio' => 5, 'linha_fim' => 5]];
        (new RelatorErros())->escrever($this->tmpDir, $erros);

        $conteudo = file_get_contents($this->tmpDir . '/errors.json');
        $decoded  = json_decode($conteudo, true);

        $this->assertNotNull($decoded);
        $this->assertIsArray($decoded);
    }

    public function test_preserva_mensagem_de_erro(): void
    {
        $mensagem = 'Sintaxe inválida na linha 10';
        $erros    = [['mensagem' => $mensagem, 'linha_inicio' => 10, 'linha_fim' => 10]];
        (new RelatorErros())->escrever($this->tmpDir, $erros);

        $conteudo = file_get_contents($this->tmpDir . '/errors.json');
        $this->assertStringContainsString($mensagem, $conteudo);
    }

    public function test_cria_diretorio_se_nao_existir(): void
    {
        $dir = $this->tmpDir . '/subdir_' . uniqid();
        (new RelatorErros())->escrever($dir, []);

        $this->assertFileExists($dir . '/errors.json');

        unlink($dir . '/errors.json');
        rmdir($dir);
    }

    public function test_escreve_array_vazio_como_json_valido(): void
    {
        (new RelatorErros())->escrever($this->tmpDir, []);

        $conteudo = file_get_contents($this->tmpDir . '/errors.json');
        $decoded  = json_decode($conteudo, true);

        $this->assertSame([], $decoded);
    }

    public function test_preserva_unicode_na_mensagem(): void
    {
        $erros = [['mensagem' => 'Erro: função não encontrada', 'linha_inicio' => 1, 'linha_fim' => 1]];
        (new RelatorErros())->escrever($this->tmpDir, $erros);

        $conteudo = file_get_contents($this->tmpDir . '/errors.json');
        $this->assertStringContainsString('função não encontrada', $conteudo);
    }
}
