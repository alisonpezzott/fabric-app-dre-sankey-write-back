// Fixtures reais do modelo (scripts/capturar_fixtures.mjs) convertidas para os tipos da
// simulação. Usado só pelos testes (*.spec.ts); o app em execução nunca lê fixtures.

import { linhas_da_tabela, numero, texto, type Linha } from "@/dados/cliente_modelo";
import tabela_contas from "@/dados/fixtures/contas.json";
import tabela_dre_2025 from "@/dados/fixtures/dre_2025.json";
import tabela_dre_mar from "@/dados/fixtures/dre_2025_03.json";
import tabela_dre_abr from "@/dados/fixtures/dre_2025_04.json";
import tabela_dre_abr_se from "@/dados/fixtures/dre_2025_04_sudeste.json";
import tabela_sub_2025 from "@/dados/fixtures/dre_subtotais_2025.json";
import tabela_sub_mar from "@/dados/fixtures/dre_subtotais_2025_03.json";
import tabela_sub_abr from "@/dados/fixtures/dre_subtotais_2025_04.json";
import tabela_sub_abr_se from "@/dados/fixtures/dre_subtotais_2025_04_sudeste.json";
import tabela_links_lista from "@/dados/fixtures/sankey_links_lista.json";
import tabela_links_2025 from "@/dados/fixtures/sankey_links_2025.json";
import tabela_links_mar from "@/dados/fixtures/sankey_links_2025_03.json";
import tabela_links_abr from "@/dados/fixtures/sankey_links_2025_04.json";
import tabela_links_abr_se from "@/dados/fixtures/sankey_links_2025_04_sudeste.json";
import { definicoes_da_consulta } from "./cascata_sankey";
import type { ContaPlano } from "./mapa_premissas";
import { contas_da_consulta, type ContaDre } from "./motor_simulacao";

export const plano: ContaPlano[] = linhas_da_tabela(tabela_contas).map((l) => ({
    cod_conta: texto(l, "cod_conta"),
    natureza: texto(l, "natureza"),
}));

export const definicoes_links = definicoes_da_consulta(linhas_da_tabela(tabela_links_lista));

export interface Recorte {
    nome: string;
    linhas_dre: Linha[];
    contas: ContaDre[];
    subtotais: Linha[];
    /** links de sankey_valor: "origem__destino" → valor */
    links: Map<string, number>;
}

function recorte(nome: string, dre: typeof tabela_dre_2025, sub: typeof tabela_sub_2025, links: typeof tabela_links_2025): Recorte {
    const linhas_dre = linhas_da_tabela(dre);
    return {
        nome,
        linhas_dre,
        contas: contas_da_consulta(linhas_dre),
        subtotais: linhas_da_tabela(sub),
        links: new Map(
            linhas_da_tabela(links).map((l) => [
                `${texto(l, "cod_no_origem")}__${texto(l, "cod_no_destino")}`,
                numero(l, "valor") ?? 0,
            ]),
        ),
    };
}

export const recortes = {
    mar_2025: recorte("mar/2025", tabela_dre_mar, tabela_sub_mar, tabela_links_mar),
    abr_2025: recorte("abr/2025", tabela_dre_abr, tabela_sub_abr, tabela_links_abr),
    abr_2025_sudeste: recorte("abr/2025 Sudeste", tabela_dre_abr_se, tabela_sub_abr_se, tabela_links_abr_se),
    ano_2025: recorte("2025", tabela_dre_2025, tabela_sub_2025, tabela_links_2025),
};

export const lista_recortes = Object.values(recortes);
