// Controles do painel de simulação: botões e campos no estilo Carbon (cantos retos,
// campo com borda inferior), editor de premissa (%/R$, valor, justificativa) e o bloco
// de impacto ao vivo (realizado → simulado no período da simulação).

import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, X } from "lucide-react";

import { formatar, formatos, abreviar_moeda, percentual } from "@/dados/formatacao";
import type { AvisoSimulacao } from "@/estado/estado_simulacao";
import { cn } from "@/lib/utils";
import { definicoes_premissas, type CodPremissa } from "@/simulacao/mapa_premissas";
import type { ResultadoSimulacao } from "@/simulacao/motor_simulacao";
import type { StatusSimulacao } from "@/simulacao/repositorio_simulacoes";
import { limite_percentual, tamanhos, type PremissaEditavel } from "@/simulacao/validacao_premissas";
import { ler_numero, texto_numero } from "@/simulacao/textos_simulacao";
import { comparar, type Comparacao } from "@/simulacao/visao_simulada";

// ---------------------------------------------------------------- botões e campos

type Variante = "primario" | "secundario" | "fantasma";

export function BotaoAcao({
    variante = "secundario",
    className,
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
    return (
        <button
            type="button"
            {...props}
            className={cn(
                "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-200 transition-colors duration-100 ease-out",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                "disabled:cursor-not-allowed disabled:opacity-50",
                variante === "primario" && "bg-primary text-primary-foreground hover:opacity-90",
                variante === "secundario" && "border border-borda-forte text-foreground hover:bg-accent",
                variante === "fantasma" && "text-interativo hover:bg-accent",
                className,
            )}
        >
            {children}
        </button>
    );
}

export const classe_campo =
    "w-full border-0 border-b border-borda-forte bg-superficie-2 px-2 py-1.5 text-300 text-foreground "
    + "placeholder:text-texto-fraco focus:outline-none focus-visible:ring-2 focus-visible:ring-ring "
    + "disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-prejuizo";

export function Campo({
    rotulo,
    erro,
    ajuda,
    children,
    id,
}: {
    rotulo: string;
    erro?: string;
    ajuda?: ReactNode;
    children: ReactNode;
    id: string;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={id} className="text-200 text-muted-foreground">
                {rotulo}
            </label>
            {children}
            {erro ? (
                <p id={`${id}_erro`} className="text-200 text-prejuizo-texto" role="alert">
                    {erro}
                </p>
            ) : (
                ajuda && <p className="text-200 text-texto-fraco">{ajuda}</p>
            )}
        </div>
    );
}

const rotulos_status: Record<StatusSimulacao, string> = {
    rascunho: "Rascunho",
    salvo: "Salvo",
    arquivado: "Arquivado",
};

export function SeloStatus({ status }: { status: StatusSimulacao }) {
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-100",
                status === "salvo" && "border-lucro text-lucro",
                status === "rascunho" && "border-dashed border-borda-forte text-muted-foreground",
                status === "arquivado" && "border-border bg-muted text-texto-fraco",
            )}
        >
            {rotulos_status[status]}
        </span>
    );
}

/** Selo "Simulado": contorno tracejado, para não depender só da cor. */
export function SeloSimulado({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border border-dashed border-interativo px-2 py-0.5 text-100 text-interativo",
                className,
            )}
        >
            Simulado
        </span>
    );
}

export function Aviso({
    aviso,
    ao_fechar,
    ao_recarregar,
}: {
    aviso: AvisoSimulacao;
    ao_fechar: () => void;
    ao_recarregar?: () => void;
}) {
    const erro = aviso.tipo !== "sucesso";
    return (
        <div
            role={erro ? "alert" : "status"}
            className={cn(
                "flex items-start gap-2 border-l-4 bg-muted p-3 text-200",
                erro ? "border-prejuizo" : "border-lucro",
            )}
        >
            {erro ? (
                <AlertTriangle className="mt-0.5 icon-size-200 shrink-0 text-prejuizo-texto" aria-hidden="true" />
            ) : (
                <CheckCircle2 className="mt-0.5 icon-size-200 shrink-0 text-lucro" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
                <p className="text-foreground">{aviso.texto}</p>
                {aviso.tipo === "conflito" && ao_recarregar && (
                    <BotaoAcao variante="fantasma" className="mt-1 -ml-3" onClick={ao_recarregar}>
                        <RefreshCw className="icon-size-200" aria-hidden="true" />
                        Recarregar a versão atual (descarta o que não foi salvo)
                    </BotaoAcao>
                )}
            </div>
            <button
                type="button"
                onClick={ao_fechar}
                aria-label="Fechar aviso"
                className="text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <X className="icon-size-200" aria-hidden="true" />
            </button>
        </div>
    );
}

// ---------------------------------------------------------------- premissa


interface EditorPremissaProps {
    premissa: PremissaEditavel;
    total_base: number | null;
    erro_valor?: string;
    erro_justificativa?: string;
    invalida?: string;
    somente_leitura: boolean;
    ao_mudar: (mudanca: Partial<Omit<PremissaEditavel, "cod_premissa">>) => void;
}

export function EditorPremissa({
    premissa,
    total_base,
    erro_valor,
    erro_justificativa,
    invalida,
    somente_leitura,
    ao_mudar,
}: EditorPremissaProps) {
    const definicao = definicoes_premissas[premissa.cod_premissa];
    const id = useId();
    // o texto digitado fica local para aceitar estados intermediários ("-", "1,")
    const [texto, definir_texto] = useState(() => texto_numero(premissa.valor_ajuste));
    const [valor_externo, definir_valor_externo] = useState(premissa.valor_ajuste);
    if (!Object.is(premissa.valor_ajuste, valor_externo)) {
        // mudou por fora (abrir, descartar, recarregar): reflete no campo
        definir_valor_externo(premissa.valor_ajuste);
        if (!Object.is(ler_numero(texto), premissa.valor_ajuste)) definir_texto(texto_numero(premissa.valor_ajuste));
    }
    const percentual_tipo = premissa.tipo_ajuste === "percentual";
    const erro = erro_valor ?? invalida;

    let equivalente: string | null = null;
    if (total_base !== null && premissa.valor_ajuste !== 0 && !erro) {
        equivalente = percentual_tipo
            ? `≈ ${abreviar_moeda((premissa.valor_ajuste / 100) * total_base)} no período`
            : total_base !== 0
                ? `≈ ${formatar(premissa.valor_ajuste / total_base, formatos.variacao_pct)} da categoria`
                : null;
    }

    return (
        <fieldset
            className={cn(
                "flex flex-col gap-2 border p-3",
                premissa.valor_ajuste !== 0 ? "border-dashed border-interativo" : "border-border",
            )}
            disabled={somente_leitura}
        >
            <legend className="px-1 text-300 font-semibold text-foreground">{definicao.rotulo}</legend>
            <p className="text-200 text-texto-fraco">{definicao.descricao}</p>
            {total_base !== null && (
                <p className="text-200 text-muted-foreground">
                    Base no período: <span className="numero text-foreground">{formatar(total_base, formatos.moeda)}</span>
                </p>
            )}
            <div className="flex items-end gap-2">
                <div role="group" aria-label={`Tipo de ajuste de ${definicao.rotulo}`} className="flex shrink-0">
                    {(["percentual", "absoluto"] as const).map((tipo) => (
                        <button
                            key={tipo}
                            type="button"
                            aria-pressed={premissa.tipo_ajuste === tipo}
                            onClick={() => {
                                if (premissa.tipo_ajuste === tipo) return;
                                definir_texto("");
                                ao_mudar({ tipo_ajuste: tipo, valor_ajuste: 0 });
                            }}
                            className={cn(
                                "border px-2.5 py-1.5 text-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                                premissa.tipo_ajuste === tipo
                                    ? "border-transparent bg-foreground text-background"
                                    : "border-border text-muted-foreground hover:bg-accent",
                            )}
                        >
                            {tipo === "percentual" ? "%" : "R$"}
                        </button>
                    ))}
                </div>
                <div className="min-w-0 flex-1">
                    <label htmlFor={`${id}_valor`} className="sr-only">
                        {percentual_tipo ? "Ajuste em %" : "Ajuste em R$ no período"}
                    </label>
                    <input
                        id={`${id}_valor`}
                        inputMode="decimal"
                        className={cn(classe_campo, "numero text-right")}
                        placeholder={percentual_tipo ? "ex.: −8" : "ex.: −20.000"}
                        value={texto}
                        aria-invalid={Boolean(erro)}
                        aria-describedby={erro ? `${id}_valor_erro` : undefined}
                        onChange={(e) => {
                            definir_texto(e.target.value);
                            const numero = ler_numero(e.target.value);
                            definir_valor_externo(numero);
                            ao_mudar({ valor_ajuste: numero });
                        }}
                    />
                </div>
                <span className="pb-1.5 text-200 text-texto-fraco">{percentual_tipo ? "%" : "R$"}</span>
            </div>
            {erro ? (
                <p id={`${id}_valor_erro`} className="text-200 text-prejuizo-texto" role="alert">
                    {erro}
                </p>
            ) : (
                <p className="text-200 text-texto-fraco">
                    {equivalente ?? (percentual_tipo
                        ? `Aumento (+) ou redução (−), de −${limite_percentual}% a +${limite_percentual}%.`
                        : "Aumento (+) ou redução (−) em R$ no período da simulação.")}
                </p>
            )}
            <Campo id={`${id}_just`} rotulo="Justificativa" erro={erro_justificativa}>
                <textarea
                    id={`${id}_just`}
                    rows={2}
                    maxLength={tamanhos.justificativa}
                    className={cn(classe_campo, "resize-y")}
                    placeholder={premissa.valor_ajuste !== 0 ? "Obrigatória para salvar (ex.: renegociação de contratos)" : "Opcional enquanto a premissa estiver zerada"}
                    value={premissa.justificativa}
                    aria-invalid={Boolean(erro_justificativa)}
                    onChange={(e) => ao_mudar({ justificativa: e.target.value })}
                />
            </Campo>
        </fieldset>
    );
}

// ---------------------------------------------------------------- impacto ao vivo

function LinhaImpacto({ rotulo, c, formato }: { rotulo: string; c: Comparacao; formato: "moeda" | "pp" }) {
    const alta = (c.delta ?? 0) > 0.005;
    const queda = (c.delta ?? 0) < -0.005;
    const valor = (v: number | null) => (formato === "moeda" ? abreviar_moeda(v) : percentual(v));
    return (
        <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 py-1">
            <dt className="text-200 text-muted-foreground">{rotulo}</dt>
            <dd className="numero text-right text-200 text-foreground">
                {valor(c.realizado)} → <span className="font-semibold">{valor(c.simulado)}</span>
            </dd>
            <dd className={cn("numero col-span-2 text-right text-200", alta && "text-lucro", queda && "text-custo", !alta && !queda && "text-texto-fraco")}>
                {alta ? "▲" : queda ? "▼" : "■"}{" "}
                {formato === "moeda"
                    ? `${formatar(c.delta, formatos.moeda)} (${formatar(c.delta_pct, formatos.variacao_pct)})`
                    : formatar(c.delta === null ? null : c.delta * 100, formatos.variacao_pp)}
            </dd>
        </div>
    );
}

export function ImpactoAoVivo({ resultado, rotulo_periodo }: { resultado: ResultadoSimulacao; rotulo_periodo: string }) {
    const r = resultado.realizado;
    const s = resultado.simulado;
    return (
        <section aria-live="polite" aria-label="Impacto da simulação" className="border border-border bg-muted p-3">
            <header className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-300 font-semibold text-foreground">Impacto no período</h3>
                <span className="text-200 text-texto-fraco">{rotulo_periodo} · todas as regiões</span>
            </header>
            <dl className="divide-y divide-border">
                <LinhaImpacto rotulo="Receita líquida" c={comparar(r.receita_liquida, s.receita_liquida)} formato="moeda" />
                <LinhaImpacto rotulo="EBITDA" c={comparar(r.ebitda, s.ebitda)} formato="moeda" />
                <LinhaImpacto rotulo="Lucro líquido" c={comparar(r.lucro_liquido, s.lucro_liquido)} formato="moeda" />
                <LinhaImpacto rotulo="Margem líquida" c={comparar(r.margem_liquida, s.margem_liquida)} formato="pp" />
            </dl>
            {resultado.avisos.map((aviso) => (
                <p key={aviso} className="mt-2 flex items-start gap-1.5 text-200 text-muted-foreground">
                    <AlertTriangle className="mt-0.5 icon-size-100 shrink-0 text-custo" aria-hidden="true" />
                    {aviso}
                </p>
            ))}
        </section>
    );
}

export type InvalidasPorPremissa = Partial<Record<CodPremissa, string>>;
