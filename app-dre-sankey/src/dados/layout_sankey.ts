// Layout do Sankey da DRE. As colunas são fixas (dim_no_sankey[coluna_sankey]) e não
// derivadas da profundidade do grafo, como faria o layout padrão do d3-sankey: num mês
// com prejuízo os subtotais somem, a profundidade muda e as colunas sairiam do lugar.
// O desenho das faixas usa o sankeyLinkHorizontal do d3-sankey sobre estas posições.

export interface NoSankeyEntrada {
    cod_no: string;
    nome_no: string;
    tipo_no: string;
    coluna_sankey: number;
    cor_hex: string;
}

export interface LinkSankeyEntrada {
    cod_no_origem: string;
    cod_no_destino: string;
    tipo_link: string;
    valor: number;
    valor_aa: number | null;
    var_aa_pct: number | null;
    /** Só no modo Simulado: valor do mesmo link no realizado (o `valor` é o simulado). */
    valor_realizado?: number;
}

export interface NoLayout extends NoSankeyEntrada {
    coluna: number;
    valor: number;
    valor_aa: number | null;
    entradas: LinkLayout[];
    saidas: LinkLayout[];
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

export interface LinkLayout extends LinkSankeyEntrada {
    id: string;
    source: NoLayout;
    target: NoLayout;
    /** largura da faixa */
    width: number;
    /** centro da faixa na saída da origem e na chegada ao destino */
    y0: number;
    y1: number;
}

export interface OpcoesLayout {
    largura: number;
    altura: number;
    largura_no: number;
    espaco_vertical: number;
}

export interface LayoutSankey {
    nos: NoLayout[];
    links: LinkLayout[];
    colunas: number;
}

const ordem_tipo: Record<string, number> = { total: 0, lucro: 0, receita: 0, custo: 1, prejuizo: 2 };

/** Nós que só têm saídas: o valor deles é a soma das saídas. */
export function no_so_de_saida(tipo_no: string): boolean {
    return tipo_no === "receita" || tipo_no === "prejuizo";
}

export function calcular_layout(
    nos_entrada: NoSankeyEntrada[],
    links_entrada: LinkSankeyEntrada[],
    opcoes: OpcoesLayout,
): LayoutSankey {
    const indice_dim = new Map(nos_entrada.map((no, i) => [no.cod_no, i]));
    const nos = new Map<string, NoLayout>();
    const links: LinkLayout[] = [];

    function no_ativo(cod_no: string): NoLayout | undefined {
        const existente = nos.get(cod_no);
        if (existente) return existente;
        const base = nos_entrada.find((no) => no.cod_no === cod_no);
        if (!base) return undefined;
        const novo: NoLayout = {
            ...base,
            coluna: base.coluna_sankey,
            valor: 0,
            valor_aa: null,
            entradas: [],
            saidas: [],
            x0: 0, x1: 0, y0: 0, y1: 0,
        };
        nos.set(cod_no, novo);
        return novo;
    }

    for (const link of links_entrada) {
        if (!(link.valor > 0)) continue;
        const source = no_ativo(link.cod_no_origem);
        const target = no_ativo(link.cod_no_destino);
        if (!source || !target) continue;
        const layout: LinkLayout = {
            ...link,
            id: `${link.cod_no_origem}__${link.cod_no_destino}`,
            source,
            target,
            width: 0,
            y0: 0,
            y1: 0,
        };
        source.saidas.push(layout);
        target.entradas.push(layout);
        links.push(layout);
    }

    const lista = [...nos.values()];
    if (lista.length === 0) return { nos: [], links: [], colunas: 0 };

    for (const no of lista) {
        const soma = (ls: LinkLayout[], campo: "valor" | "valor_aa") =>
            ls.reduce((s, l) => s + (l[campo] ?? 0), 0);
        no.valor = Math.max(soma(no.entradas, "valor"), soma(no.saidas, "valor"));
        const base_aa = no_so_de_saida(no.tipo_no) ? no.saidas : no.entradas;
        no.valor_aa = base_aa.some((l) => l.valor_aa !== null) ? soma(base_aa, "valor_aa") : null;
        // o prejuízo entra à esquerda da primeira camada que ele financia
        if (no.tipo_no === "prejuizo" && no.saidas.length > 0) {
            no.coluna = Math.max(0, Math.min(...no.saidas.map((l) => l.target.coluna_sankey)) - 1);
        }
    }

    const ultima_coluna = Math.max(...lista.map((no) => no.coluna));
    const por_coluna = new Map<number, NoLayout[]>();
    for (const no of lista) {
        por_coluna.set(no.coluna, [...(por_coluna.get(no.coluna) ?? []), no]);
    }

    // escala vertical única: a coluna mais cheia ocupa a altura toda
    const ky = Math.min(
        ...[...por_coluna.values()].map((grupo) => {
            const total = grupo.reduce((s, no) => s + no.valor, 0);
            const livre = opcoes.altura - opcoes.espaco_vertical * (grupo.length - 1);
            return total > 0 ? livre / total : Infinity;
        }),
    );

    const passo_x = ultima_coluna > 0 ? (opcoes.largura - opcoes.largura_no) / ultima_coluna : 0;
    const centro = (no: NoLayout) => (no.y0 + no.y1) / 2;

    for (let coluna = 0; coluna <= ultima_coluna; coluna++) {
        const grupo = por_coluna.get(coluna);
        if (!grupo) continue;

        // ordem: centro ponderado das origens (já posicionadas), depois o tipo e a ordem da dimensão
        const chave = new Map(
            grupo.map((no) => {
                const peso = no.entradas.reduce((s, l) => s + l.valor, 0);
                const baricentro = no.tipo_no === "prejuizo" || peso === 0
                    ? (coluna === 0 ? 0 : Infinity)
                    : no.entradas.reduce((s, l) => s + centro(l.source) * l.valor, 0) / peso;
                return [no.cod_no, baricentro];
            }),
        );
        grupo.sort((a, b) =>
            (chave.get(a.cod_no)! - chave.get(b.cod_no)!)
            || ((ordem_tipo[a.tipo_no] ?? 1) - (ordem_tipo[b.tipo_no] ?? 1))
            || (indice_dim.get(a.cod_no)! - indice_dim.get(b.cod_no)!),
        );

        let y = 0;
        for (const no of grupo) {
            const altura_no = no.valor * ky;
            no.y0 = no.tipo_no === "prejuizo" ? Math.max(y, opcoes.altura - altura_no) : y;
            no.y1 = no.y0 + altura_no;
            no.x0 = coluna * passo_x;
            no.x1 = no.x0 + opcoes.largura_no;
            y = no.y1 + opcoes.espaco_vertical;
        }
    }

    // faixas empilhadas na ordem vertical do outro extremo, para não se cruzarem no nó
    for (const no of lista) {
        let y_saida = no.y0;
        for (const link of [...no.saidas].sort((a, b) => a.target.y0 - b.target.y0 || a.target.x0 - b.target.x0)) {
            link.width = link.valor * ky;
            link.y0 = y_saida + link.width / 2;
            y_saida += link.width;
        }
    }
    for (const no of lista) {
        let y_entrada = no.y0;
        for (const link of [...no.entradas].sort((a, b) => a.source.y0 - b.source.y0 || a.source.x0 - b.source.x0)) {
            link.y1 = y_entrada + link.width / 2;
            y_entrada += link.width;
        }
    }

    return { nos: lista, links, colunas: ultima_coluna + 1 };
}
