// DRE em tabela: contas em ordem_dre, realizado × orçado × variação, com os subtotais
// do modelo (lucro bruto, EBITDA, EBIT, LAIR, lucro líquido) intercalados e destacados.

import { useMemo } from "react";
import { DataGrid, type GridColumnDef, type Row } from "@microsoft/fabric-datagrid";
import type { DataTable } from "@microsoft/fabric-visuals-core";

import type { Linha } from "@/dados/cliente_modelo";
import { montar_linhas_dre } from "@/dados/linhas_dre";
import { formatar, formatos } from "@/dados/formatacao";
import { useThemeContext } from "@/hooks/theme.context";
import { cn } from "@/lib/utils";
import { SeloSimulado } from "./controles_simulacao";
import { Cartao, EstadoErro, EstadoCarregando, EstadoVazio } from "./estados_carregamento";

interface TabelaDreProps {
    contas: Linha[] | undefined;
    subtotais: Linha[] | undefined;
    carregando: boolean;
    erro: Error | undefined;
    subtitulo: string;
    className?: string;
    /** Modo Simulado: linhas já montadas por visao_simulada (Realizado | Simulado | Δ | Δ%). */
    simulada?: DataTable | null;
}

function valor_celula(formato: typeof formatos.moeda | typeof formatos.variacao_pct, colorir: boolean) {
    return (valor: unknown, row: Row) => {
        const tipo = row["tipo_linha"];
        const n = typeof valor === "number" ? valor : null;
        return (
            <span
                className={cn(
                    "numero block w-full text-right",
                    tipo === "destaque" && "font-semibold text-foreground",
                    tipo === "subtotal" && "text-foreground",
                    (tipo === "conta" || tipo === "conta_alterada") && "text-muted-foreground",
                    colorir && n !== null && n > 0 && "text-lucro",
                    colorir && n !== null && n < 0 && "text-custo",
                    !colorir && tipo === "destaque" && n !== null && n < 0 && "text-prejuizo-texto",
                )}
            >
                {formatar(n, formato)}
            </span>
        );
    };
}

const colunas: GridColumnDef[] = [
    { id: "tipo_linha", header: "Tipo", hidden: true },
    {
        id: "nome",
        header: "Linha da DRE",
        minWidth: 220,
        cellRenderer: (valor, row) => {
            const tipo = row["tipo_linha"];
            return (
                <span
                    className={cn(
                        "block truncate",
                        tipo === "conta" && "pl-4 text-muted-foreground",
                        // conta alterada pela simulação: marcador tracejado (não depende só da cor)
                        tipo === "conta_alterada" && "border-l-2 border-dashed border-interativo pl-[14px] text-foreground",
                        tipo === "subtotal" && "text-foreground",
                        tipo === "destaque" && "font-semibold text-foreground",
                    )}
                >
                    {String(valor ?? "")}
                </span>
            );
        },
    },
    { id: "realizado", header: "Realizado", minWidth: 130, cellRenderer: valor_celula(formatos.moeda, false) },
    { id: "orcado", header: "Orçado", minWidth: 130, cellRenderer: valor_celula(formatos.moeda, false) },
    { id: "var_pct", header: "Var. %", minWidth: 90, cellRenderer: valor_celula(formatos.variacao_pct, true) },
];

const colunas_simuladas: GridColumnDef[] = [
    colunas[0],
    colunas[1],
    { id: "realizado", header: "Realizado", minWidth: 120, cellRenderer: valor_celula(formatos.moeda, false) },
    { id: "simulado", header: "Simulado", minWidth: 120, cellRenderer: valor_celula(formatos.moeda, false) },
    { id: "delta", header: "Δ", minWidth: 110, cellRenderer: valor_celula(formatos.moeda, true) },
    { id: "delta_pct", header: "Δ %", minWidth: 80, cellRenderer: valor_celula(formatos.variacao_pct, true) },
];

export function TabelaDre({ contas, subtotais, carregando, erro, subtitulo, className, simulada }: TabelaDreProps) {
    const { theme } = useThemeContext();
    const modo_simulado = simulada !== undefined;
    const dados = useMemo(
        () => (modo_simulado ? simulada : contas && subtotais ? montar_linhas_dre(contas, subtotais) : null),
        [modo_simulado, simulada, contas, subtotais],
    );

    let conteudo;
    if (erro) conteudo = <EstadoErro erro={erro} />;
    else if (carregando && !dados) conteudo = <EstadoCarregando />;
    else if (!dados || dados.rows.length === 0) conteudo = <EstadoVazio />;
    else {
        conteudo = (
            <DataGrid
                data={dados}
                columns={modo_simulado ? colunas_simuladas : colunas}
                theme={theme}
                chromeless
                rowHeight={32}
                capabilities={{ disableSorting: true, disableFiltering: true, disableColumnReorder: true }}
            />
        );
    }

    return (
        <Cartao
            titulo={modo_simulado ? "DRE · realizado × simulado" : "DRE · realizado × orçado"}
            subtitulo={subtitulo}
            className={cn(className, modo_simulado && "border-dashed border-interativo")}
            acoes={modo_simulado ? <SeloSimulado /> : undefined}
        >
            <div className="min-h-0 flex-1">{conteudo}</div>
            <p className="mt-2 text-200 text-texto-fraco">
                {modo_simulado
                    ? "Δ = simulado − realizado; Δ% sobre |realizado|. Contas com marcador tracejado foram alteradas pelas premissas; IR & CSLL acompanha a variação do LAIR."
                    : "Variação: (realizado − orçado) ÷ |orçado|. Negativa = pior que o orçado, para receitas e para gastos."}
            </p>
        </Cartao>
    );
}
