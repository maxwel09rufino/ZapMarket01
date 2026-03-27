import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CAMPAIGN_TEMPLATE_VARIABLES } from "@/lib/campaigns/formatter";

export type CampaignFormValues = {
  campaignName: string;
  productId: string;
  selectAllProducts: boolean;
  messageTemplate: string;
};

type CampaignFormProps = {
  values: CampaignFormValues;
  onChange: <K extends keyof CampaignFormValues>(
    field: K,
    value: CampaignFormValues[K],
  ) => void;
  onInsertVariable: (variable: string) => void;
  onUseStarterTemplate: () => void;
  products: Array<{ id: string; name: string }>;
  previewMessage: string;
};

export default function CampaignForm({
  values,
  onChange,
  onInsertVariable,
  onUseStarterTemplate,
  products,
  previewMessage,
}: CampaignFormProps) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <h3 className="mb-5 font-heading text-xl font-semibold text-white">
        1 Produto e Modelo de Divulgacao
      </h3>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-zinc-300">Nome da campanha</label>
          <Input
            value={values.campaignName}
            onChange={(event) => onChange("campaignName", event.target.value)}
            placeholder="Ex: Oferta Relampago Sala"
            className="h-11 rounded-lg border-zinc-700 bg-zinc-800 focus-visible:border-green-500"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label className="block text-sm text-zinc-300">Selecionar produto</label>
            <button
              type="button"
              onClick={() => {
                const nextValue = !values.selectAllProducts;
                onChange("selectAllProducts", nextValue);
                if (nextValue) {
                  onChange("productId", "");
                }
              }}
              className="text-xs font-medium text-green-500 transition hover:text-green-400"
            >
              {values.selectAllProducts ? "Usar produto unico" : "Selecionar todos os produtos"}
            </button>
          </div>
          <select
            value={values.productId}
            onChange={(event) => onChange("productId", event.target.value)}
            disabled={values.selectAllProducts}
            className="h-11 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
          >
            <option value="">-- Escolha um produto --</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          {values.selectAllProducts ? (
            <p className="mt-2 text-xs text-green-400">
              O sistema vai disparar todos os produtos cadastrados, um por vez, seguindo o delay
              da campanha.
            </p>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label className="block text-sm text-zinc-300">Modelo de Divulgacao</label>
            <button
              type="button"
              onClick={onUseStarterTemplate}
              className="text-xs font-medium text-green-500 transition hover:text-green-400"
            >
              Usar modelo base
            </button>
          </div>

          <textarea
            value={values.messageTemplate}
            onChange={(event) => onChange("messageTemplate", event.target.value)}
            placeholder="Escreva o seu modelo com variaveis como {nome}, {preco}, {link} e {cupom}."
            rows={8}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/20"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {CAMPAIGN_TEMPLATE_VARIABLES.map((variable) => (
              <button
                key={variable}
                type="button"
                onClick={() => onInsertVariable(variable)}
                className="rounded-full border border-zinc-700 bg-zinc-950/70 px-3 py-1 text-xs font-medium text-zinc-300 transition hover:border-green-500/50 hover:text-green-400"
              >
                {variable}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-zinc-200">Preview da mensagem</p>
              <Badge className="border-transparent bg-green-600 text-white">
                Imagem + legenda
              </Badge>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/40 p-4 text-sm text-zinc-100">
              <p className="whitespace-pre-line break-words">
                {previewMessage || "Selecione um produto para visualizar o resultado final."}
              </p>
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              {values.selectAllProducts
                ? "Esse preview usa o primeiro produto disponivel. Nos envios reais cada produto sera aplicado no mesmo modelo, um por vez, com a imagem principal anexada."
                : "Esse preview e a legenda exata que sera disparada com a imagem principal do produto."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
