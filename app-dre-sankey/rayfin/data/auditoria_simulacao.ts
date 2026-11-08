// Trilha de auditoria das simulações: só criação e leitura (append-only para o usuário).
// valor_anterior e valor_novo guardam JSON. A linha é gravada pelo app: o banco impede
// alterar ou apagar, mas não garante que toda ação gere uma linha (limitação documentada).

import { authenticated, date, entity, one, set, text, uuid } from "@microsoft/rayfin-core";

import { simulacao } from "./simulacao.js";

@entity()
@authenticated(["create", "read"], {
    policy: (claims, item) => claims.sub.eq(item.usuario_id),
})
export class auditoria_simulacao {
    @uuid() id!: string;
    @uuid() simulacao_id!: string;
    @one(() => simulacao, { optional: true }) simulacao?: simulacao;
    @uuid({ optional: true }) premissa_id?: string;
    @set("criar", "alterar_premissa", "salvar", "duplicar", "arquivar", "restaurar")
    acao!: "criar" | "alterar_premissa" | "salvar" | "duplicar" | "arquivar" | "restaurar";
    @text({ max: 2000, optional: true }) valor_anterior?: string;
    @text({ max: 2000, optional: true }) valor_novo?: string;
    @text({ max: 200 }) usuario_id!: string;
    @text({ max: 320, optional: true }) email_usuario?: string;
    @date() alterado_em!: Date;
}
