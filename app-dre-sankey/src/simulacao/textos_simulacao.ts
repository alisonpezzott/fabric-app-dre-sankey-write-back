// Textos e entrada numérica do painel de simulação (puro, testado): leitura de números
// digitados em pt-BR, rótulo do período e resumo das linhas de auditoria.

import { formatar, formatos } from "@/dados/formatacao";
import { e_cod_premissa } from "./mapa_premissas";
import { rotulo_premissa, type RegistroAuditoria, type Simulacao } from "./repositorio_simulacoes";

/**
 * Número digitado em pt-BR → número; vazio = 0; texto inválido = NaN (a validação avisa).
 * Aceita "−8", "-8,5", "1.234,5", "20.000" (ponto de milhar) e "0.5" (ponto decimal).
 */
export function ler_numero(texto: string): number {
    const limpo = texto.trim().replace(/−/g, "-").replace(/\s|R\$|%/g, "");
    if (limpo === "" || limpo === "-" || limpo === "+") return 0;
    let normal: string;
    if (limpo.includes(",")) normal = limpo.replace(/\./g, "").replace(",", ".");
    else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, "");
    else normal = limpo;
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(normal) ? Number(normal) : Number.NaN;
}

/** Número → texto do campo (vírgula decimal); zero = campo vazio. */
export function texto_numero(valor: number): string {
    return valor === 0 || !Number.isFinite(valor) ? "" : String(valor).replace(".", ",");
}

/** "2025", "Mar/2025" ou "Jan a Jun/2025". */
export function periodo_simulacao(
    s: Pick<Simulacao, "ano" | "mes_inicio" | "mes_fim">,
    nome_mes: (mes: number) => string,
): string {
    if (s.mes_inicio === 1 && s.mes_fim === 12) return String(s.ano);
    if (s.mes_inicio === s.mes_fim) return `${nome_mes(s.mes_inicio)}/${s.ano}`;
    return `${nome_mes(s.mes_inicio)} a ${nome_mes(s.mes_fim)}/${s.ano}`;
}

type Json = Record<string, unknown>;

function ler_json(json: string | null): Json | null {
    if (!json) return null;
    try {
        const valor: unknown = JSON.parse(json);
        return valor && typeof valor === "object" ? (valor as Json) : null;
    } catch {
        return null;
    }
}

function descrever_premissa(p: Json | null): string {
    if (!p) return "–";
    const valor = Number(p.valor_ajuste ?? 0);
    if (valor === 0) return "sem ajuste";
    return p.tipo_ajuste === "absoluto"
        ? formatar(valor, formatos.moeda)
        : `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
}

/** Resumo legível de uma linha de auditoria (null quando não há o que detalhar). */
export function detalhe_auditoria(registro: RegistroAuditoria): string | null {
    const anterior = ler_json(registro.valor_anterior);
    const novo = ler_json(registro.valor_novo);
    switch (registro.acao) {
        case "alterar_premissa": {
            const cod = String(novo?.cod_premissa ?? anterior?.cod_premissa ?? "");
            const nome = e_cod_premissa(cod) ? rotulo_premissa(cod) : "Premissa";
            const justificativa = typeof novo?.justificativa === "string" && novo.justificativa.trim()
                ? ` · “${novo.justificativa.trim()}”`
                : "";
            return `${nome}: ${descrever_premissa(anterior)} → ${descrever_premissa(novo)}${justificativa}`;
        }
        case "salvar":
        case "arquivar":
        case "restaurar":
            return anterior && novo
                ? `status ${String(anterior.status)} → ${String(novo.status)} · versão ${String(anterior.versao)} → ${String(novo.versao)}`
                : null;
        case "duplicar":
            return anterior?.nome_origem ? `origem: ${String(anterior.nome_origem)}` : null;
        case "criar":
            return novo?.nome ? `“${String(novo.nome)}”` : null;
        default:
            return null;
    }
}
