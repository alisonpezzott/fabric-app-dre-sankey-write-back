// Premissa de uma simulação. As três nascem com a simulação (valor 0); "remover" é zerar.
// Unicidade simulação × premissa por chave_premissa = "<simulacao_id>:<cod_premissa>",
// porque o Rayfin não aceita constraint composta. Guarda o próprio usuario_id: a policy
// não navega relações.

import { authenticated, date, decimal, entity, one, set, text, uuid } from "@microsoft/rayfin-core";

import { simulacao } from "./simulacao.js";

@entity()
@authenticated(["create", "read", "update"], {
    policy: (claims, item) => claims.sub.eq(item.usuario_id),
})
export class premissa_simulacao {
    @uuid() id!: string;
    @uuid() simulacao_id!: string;
    @one(() => simulacao, { optional: true }) simulacao?: simulacao;
    @set("receita_liquida", "custos", "despesas_administrativas")
    cod_premissa!: "receita_liquida" | "custos" | "despesas_administrativas";
    @text({ max: 80, unique: true }) chave_premissa!: string;
    @set("percentual", "absoluto") tipo_ajuste!: "percentual" | "absoluto";
    /** Percentual (−100 a 100) ou R$ no período da simulação: aumento (+) ou redução (−). */
    @decimal({ precision: 18, scale: 4, min: -1e12, max: 1e12 }) valor_ajuste!: number;
    @text({ max: 500, optional: true }) justificativa?: string;
    @text({ max: 200 }) usuario_id!: string;
    @date() criado_em!: Date;
    @date() alterado_em!: Date;
}
