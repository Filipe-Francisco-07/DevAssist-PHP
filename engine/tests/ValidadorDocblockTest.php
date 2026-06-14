<?php

use PHPUnit\Framework\TestCase;
use Analyser\ValidadorDocblock;

final class ValidadorDocblockTest extends TestCase
{
    private ValidadorDocblock $sut;

    protected function setUp(): void
    {
        $this->sut = new ValidadorDocblock();
    }

    // -------------------------------------------------------------------------
    // Sem documentação
    // -------------------------------------------------------------------------

    public function test_item_sem_doc_precisa_gerar(): void
    {
        $item = ['type' => 'method', 'doc' => null, 'params' => []];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    public function test_item_com_doc_vazio_precisa_gerar(): void
    {
        $item = ['type' => 'method', 'doc' => '', 'params' => []];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    public function test_doc_marcador_vazio_precisa_gerar(): void
    {
        $item = ['type' => 'method', 'doc' => '/** */', 'params' => []];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    // -------------------------------------------------------------------------
    // Métodos e funções
    // -------------------------------------------------------------------------

    public function test_metodo_sem_params_sem_return_precisa_gerar(): void
    {
        $item = [
            'type'   => 'method',
            'doc'    => "/**\n * Descrição.\n */",
            'params' => [],
        ];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    public function test_metodo_sem_params_com_return_nao_precisa_gerar(): void
    {
        $item = [
            'type'   => 'method',
            'doc'    => "/**\n * Descrição.\n * @return void\n */",
            'params' => [],
        ];
        $this->assertFalse($this->sut->precisaGerar($item));
    }

    public function test_metodo_com_param_ausente_no_doc_precisa_gerar(): void
    {
        $item = [
            'type'   => 'method',
            'doc'    => "/**\n * @return string\n */",
            'params' => [['name' => 'foo']],
        ];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    public function test_metodo_com_todos_params_documentados_e_return_nao_precisa_gerar(): void
    {
        $item = [
            'type'   => 'method',
            'doc'    => "/**\n * Descrição.\n * @param string \$nome Nome do usuário.\n * @return string\n */",
            'params' => [['name' => 'nome']],
        ];
        $this->assertFalse($this->sut->precisaGerar($item));
    }

    public function test_metodo_com_apenas_primeiro_param_documentado_e_segundo_ausente_precisa_gerar(): void
    {
        $item = [
            'type'   => 'method',
            'doc'    => "/**\n * @param int \$id\n * @return void\n */",
            'params' => [['name' => 'id'], ['name' => 'nome']],
        ];
        // $nome não está no doc — deve regenerar
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    public function test_metodo_sem_return_precisa_gerar(): void
    {
        $item = [
            'type'   => 'method',
            'doc'    => "/**\n * @param string \$x X.\n */",
            'params' => [['name' => 'x']],
        ];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    public function test_funcao_standalone_sem_doc_precisa_gerar(): void
    {
        $item = ['type' => 'function', 'doc' => null, 'params' => []];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    // -------------------------------------------------------------------------
    // Propriedades
    // -------------------------------------------------------------------------

    public function test_propriedade_sem_var_precisa_gerar(): void
    {
        $item = ['type' => 'property', 'doc' => "/**\n * Algum texto.\n */"];
        $this->assertTrue($this->sut->precisaGerar($item));
    }

    public function test_propriedade_com_var_nao_precisa_gerar(): void
    {
        $item = ['type' => 'property', 'doc' => "/**\n * @var string Nome.\n */"];
        $this->assertFalse($this->sut->precisaGerar($item));
    }

    // -------------------------------------------------------------------------
    // Classes
    // -------------------------------------------------------------------------

    public function test_classe_documentada_nao_precisa_gerar(): void
    {
        $item = ['type' => 'class', 'doc' => "/**\n * Descrição da classe.\n */"];
        $this->assertFalse($this->sut->precisaGerar($item));
    }

    public function test_classe_sem_doc_precisa_gerar(): void
    {
        $item = ['type' => 'class', 'doc' => null];
        $this->assertTrue($this->sut->precisaGerar($item));
    }
}
