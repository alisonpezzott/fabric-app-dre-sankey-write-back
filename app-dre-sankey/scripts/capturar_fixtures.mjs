// Captura do modelo real as fixtures dos testes unitários (mesma forma das respostas da API).
// Uso: node scripts/capturar_fixtures.mjs  (requer o Azure CLI logado)
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "vite";

const exec_file = promisify(execFile);
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const servidor = await createServer({ root: raiz, appType: "custom", logLevel: "error", server: { middlewareMode: true } });
const c = await servidor.ssrLoadModule("/src/dados/consultas_dax.ts");
const cli = resolve(dirname(fileURLToPath(import.meta.resolve("@microsoft/fabric-app-data-cli"))), "cli.js");

async function tabela(query) {
    const { stdout } = await exec_file(process.execPath, [cli, "query", "semanticModel", c.conexao_modelo, "-q", query], {
        cwd: raiz, maxBuffer: 20 * 1024 * 1024, timeout: 120_000, windowsHide: true,
    });
    const resultado = JSON.parse(stdout);
    if (resultado.status !== "success") throw new Error(resultado.error?.message);
    return resultado.table;
}

const dominio = { anos: [2024, 2025, 2026], regioes: ["sudeste", "sul", "nordeste", "centro_oeste", "norte"] };
const ctx = (f) => ({ dominio, filtros: { ano: 2025, mes_inicio: 1, mes_fim: 12, regioes: [], cenario: "realizado", ...f } });

const mar = { mes_inicio: 3, mes_fim: 3 };
const abr = { mes_inicio: 4, mes_fim: 4 };
const abr_sudeste = { ...abr, regioes: ["sudeste"] };

const fixtures = {
    contas: await tabela(c.q_contas),
    sankey_nos: await tabela(c.q_sankey_nos),
    sankey_links_lista: await tabela(c.q_links_sankey_lista),
    sankey_links_2025_03: await tabela(c.q_sankey_links(ctx(mar))),
    sankey_links_2025_04: await tabela(c.q_sankey_links(ctx(abr))),
    sankey_links_2025_04_sudeste: await tabela(c.q_sankey_links(ctx(abr_sudeste))),
    sankey_links_2025: await tabela(c.q_sankey_links(ctx({}))),
    dre_2025_03: await tabela(c.q_dre(ctx(mar))),
    dre_2025_04: await tabela(c.q_dre(ctx(abr))),
    dre_2025_04_sudeste: await tabela(c.q_dre(ctx(abr_sudeste))),
    dre_2025: await tabela(c.q_dre(ctx({}))),
    dre_subtotais_2025_03: await tabela(c.q_dre_subtotais(ctx(mar))),
    dre_subtotais_2025_04: await tabela(c.q_dre_subtotais(ctx(abr))),
    dre_subtotais_2025_04_sudeste: await tabela(c.q_dre_subtotais(ctx(abr_sudeste))),
    dre_subtotais_2025: await tabela(c.q_dre_subtotais(ctx({}))),
};
for (const [nome, t] of Object.entries(fixtures)) {
    await writeFile(resolve(raiz, `src/dados/fixtures/${nome}.json`), JSON.stringify(t, null, 1) + "\n");
}
await servidor.close();
console.log(Object.entries(fixtures).map(([n, t]) => `${n}: ${t.rows.length}`).join("\n"));
