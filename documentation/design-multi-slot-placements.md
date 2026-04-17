# Design: Suporte a N Slots de Posicionamento no Fluxo de Duplicação de Campanhas

**Data:** 2026-04-13  
**Status:** Aprovado — aguardando implementação

---

## Contexto

O fluxo de duplicação de campanhas na página `/upload` suportava apenas 2 slots fixos hardcoded: `feed` (quadrado/paisagem) e `story` (9:16 vertical). Templates com 3+ slots eram bloqueados com a mensagem _"Template com mais de 2 slots não é suportado"_. A identificação de qual slot era feed ou story era feita por heurística textual frágil (`_STORY_PLACEMENT_TOKENS`).

---

## Entendimento

**O que está sendo construído:**
- Suporte a N slots de posicionamento, removendo o limite de 2 e o modelo binário `feed_file_index` / `story_file_index`
- Enum Python hardcoded de posicionamentos Meta como camada de **enriquecimento** (não de controle de fluxo): nome legível, dimensões e lista explícita de compatíveis
- Auto-fill bidirecional entre slots compatíveis, com override manual e reset por slot

**Non-goals:**
- Não é gestão de posicionamentos — é mapeamento transparente do que vem da Meta API
- Sem suporte a carousel — bloqueio existente se mantém
- Sem UI para configurar compatibilidades — o enum é definido pela equipe via código

**Assumptions:**
- `customization_spec` das rules (`facebook_positions`, `instagram_positions`, etc.) é suficiente para identificar os posicionamentos de cada slot
- Para `story_spec_simple` (slot único sem rules), `primary_placement` é derivado da estrutura do `object_story_spec`
- A lista de compatibilidades é revisada manualmente quando a Meta lança novos posicionamentos relevantes

---

## Posicionamentos Meta API (v24.0+)

| Campo | Valores |
|---|---|
| `publisher_platforms` | `facebook`, `instagram`, `threads`, `messenger`, `audience_network` |
| `facebook_positions` | `feed`, `right_hand_column`, `marketplace`, `video_feeds`, `story`, `search`, `instream_video`, `facebook_reels`, `facebook_reels_overlay`, `profile_feed`, `notification` |
| `instagram_positions` | `stream`, `story`, `explore`, `explore_home`, `reels`, `profile_feed`, `ig_search`, `profile_reels` |
| `messenger_positions` | `sponsored_messages`, `story` |
| `audience_network_positions` | `classic`, `rewarded_video` |

> **Nota:** Instagram Feed = `stream` (não `feed`). `facebook_reels_overlay` não estava coberto pelo `_STORY_PLACEMENT_TOKENS` anterior.

### Grupos de aspect ratio

| Aspect ratio | Posicionamentos |
|---|---|
| **9:16 vertical** | `fb:story`, `fb:facebook_reels`, `fb:facebook_reels_overlay`, `ig:story`, `ig:reels`, `ig:profile_reels`, `ms:story` |
| **Square/landscape** | `fb:feed`, `fb:right_hand_column`, `fb:marketplace`, `fb:video_feeds`, `fb:search`, `fb:profile_feed`, `fb:notification`, `ig:stream`, `ig:explore`, `ig:explore_home`, `ig:profile_feed`, `ig:ig_search`, `an:classic` |
| **16:9 in-stream** | `fb:instream_video`, `an:rewarded_video` |
| **Standalone** | `ms:sponsored_messages` |

---

## Design

### 1. `backend/app/services/placement_registry.py` (novo)

Fonte de verdade sobre posicionamentos. Puro dado, sem lógica de negócio.

```python
from dataclasses import dataclass, field

@dataclass
class PlacementInfo:
    display_name: str
    aspect_ratio: str                          # ex: "9:16", "1:1 / 1.91:1 / 4:5"
    min_width: int
    min_height: int
    recommended_width: int
    recommended_height: int
    compatible_with: list[tuple[str, str]] = field(default_factory=list)
    # ^ ordenado por prioridade: primeiro = fonte preferencial do auto-fill

REGISTRY: dict[tuple[str, str], PlacementInfo] = {
    ("facebook", "feed"): PlacementInfo(
        display_name="Facebook Feed",
        aspect_ratio="1:1 / 1.91:1 / 4:5",
        min_width=600, min_height=315,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "right_hand_column"),
            ("facebook", "marketplace"),
            ("facebook", "search"),
            ("facebook", "profile_feed"),
        ],
    ),
    ("facebook", "right_hand_column"): PlacementInfo(
        display_name="Facebook Coluna Direita",
        aspect_ratio="1.91:1",
        min_width=600, min_height=314,
        recommended_width=1200, recommended_height=628,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("instagram", "stream"): PlacementInfo(
        display_name="Instagram Feed",
        aspect_ratio="1:1 / 1.91:1 / 4:5",
        min_width=600, min_height=315,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("facebook", "right_hand_column"),
            ("facebook", "marketplace"),
        ],
    ),
    ("facebook", "story"): PlacementInfo(
        display_name="Facebook Stories",
        aspect_ratio="9:16",
        min_width=500, min_height=889,
        recommended_width=1080, recommended_height=1920,
        compatible_with=[
            ("instagram", "story"),
            ("facebook", "facebook_reels"),
            ("instagram", "reels"),
            ("facebook", "facebook_reels_overlay"),
            ("instagram", "profile_reels"),
            ("messenger", "story"),
        ],
    ),
    ("instagram", "story"): PlacementInfo(
        display_name="Instagram Stories",
        aspect_ratio="9:16",
        min_width=500, min_height=889,
        recommended_width=1080, recommended_height=1920,
        compatible_with=[
            ("facebook", "story"),
            ("facebook", "facebook_reels"),
            ("instagram", "reels"),
            ("facebook", "facebook_reels_overlay"),
            ("instagram", "profile_reels"),
            ("messenger", "story"),
        ],
    ),
    ("facebook", "facebook_reels"): PlacementInfo(
        display_name="Facebook Reels",
        aspect_ratio="9:16",
        min_width=500, min_height=889,
        recommended_width=1080, recommended_height=1920,
        compatible_with=[
            ("instagram", "reels"),
            ("facebook", "story"),
            ("instagram", "story"),
            ("facebook", "facebook_reels_overlay"),
            ("instagram", "profile_reels"),
        ],
    ),
    ("facebook", "facebook_reels_overlay"): PlacementInfo(
        display_name="Facebook Reels Overlay",
        aspect_ratio="9:16",
        min_width=500, min_height=889,
        recommended_width=1080, recommended_height=1920,
        compatible_with=[
            ("facebook", "facebook_reels"),
            ("instagram", "reels"),
            ("facebook", "story"),
            ("instagram", "story"),
        ],
    ),
    ("instagram", "reels"): PlacementInfo(
        display_name="Instagram Reels",
        aspect_ratio="9:16",
        min_width=500, min_height=889,
        recommended_width=1080, recommended_height=1920,
        compatible_with=[
            ("facebook", "facebook_reels"),
            ("instagram", "story"),
            ("facebook", "story"),
            ("instagram", "profile_reels"),
        ],
    ),
    ("instagram", "profile_reels"): PlacementInfo(
        display_name="Instagram Profile Reels",
        aspect_ratio="9:16",
        min_width=500, min_height=889,
        recommended_width=1080, recommended_height=1920,
        compatible_with=[
            ("instagram", "reels"),
            ("facebook", "facebook_reels"),
        ],
    ),
    ("messenger", "story"): PlacementInfo(
        display_name="Messenger Stories",
        aspect_ratio="9:16",
        min_width=500, min_height=889,
        recommended_width=1080, recommended_height=1920,
        compatible_with=[
            ("instagram", "story"),
            ("facebook", "story"),
        ],
    ),
    ("facebook", "marketplace"): PlacementInfo(
        display_name="Facebook Marketplace",
        aspect_ratio="1:1",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("facebook", "video_feeds"): PlacementInfo(
        display_name="Facebook Video Feeds",
        aspect_ratio="1:1 / 4:5",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("facebook", "search"): PlacementInfo(
        display_name="Facebook Search",
        aspect_ratio="1:1 / 1.91:1",
        min_width=600, min_height=315,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("facebook", "profile_feed"): PlacementInfo(
        display_name="Facebook Profile Feed",
        aspect_ratio="1:1",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
        ],
    ),
    ("facebook", "instream_video"): PlacementInfo(
        display_name="Facebook In-stream Video",
        aspect_ratio="16:9",
        min_width=1280, min_height=720,
        recommended_width=1920, recommended_height=1080,
        compatible_with=[],  # standalone — sem compatíveis
    ),
    ("instagram", "explore"): PlacementInfo(
        display_name="Instagram Explore",
        aspect_ratio="1:1 / 4:5",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    ("instagram", "explore_home"): PlacementInfo(
        display_name="Instagram Explore Home",
        aspect_ratio="1:1",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    ("instagram", "profile_feed"): PlacementInfo(
        display_name="Instagram Profile Feed",
        aspect_ratio="1:1",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    ("instagram", "ig_search"): PlacementInfo(
        display_name="Instagram Search",
        aspect_ratio="1:1",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("instagram", "stream"),
            ("facebook", "feed"),
        ],
    ),
    ("audience_network", "classic"): PlacementInfo(
        display_name="Audience Network",
        aspect_ratio="1:1 / 1.91:1",
        min_width=600, min_height=315,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[
            ("facebook", "feed"),
            ("instagram", "stream"),
        ],
    ),
    ("audience_network", "rewarded_video"): PlacementInfo(
        display_name="Audience Network Rewarded Video",
        aspect_ratio="16:9",
        min_width=1280, min_height=720,
        recommended_width=1920, recommended_height=1080,
        compatible_with=[],
    ),
    ("messenger", "sponsored_messages"): PlacementInfo(
        display_name="Messenger Sponsored Messages",
        aspect_ratio="1.91:1",
        min_width=600, min_height=314,
        recommended_width=1200, recommended_height=628,
        compatible_with=[],
    ),
    ("facebook", "notification"): PlacementInfo(
        display_name="Facebook Notification",
        aspect_ratio="1:1",
        min_width=600, min_height=600,
        recommended_width=1080, recommended_height=1080,
        compatible_with=[],
    ),
}


def lookup(publisher_platform: str, position: str) -> PlacementInfo | None:
    return REGISTRY.get((publisher_platform, position))


def format_unknown(position: str) -> str:
    """Formata um posicionamento desconhecido para exibição."""
    return position.replace("_", " ").title()
```

---

### 2. `CreativeMediaSlot` — campos novos

Em `backend/app/services/creative_template.py`:

```python
@dataclass
class CreativeMediaSlot:
    slot_key: str
    display_name: str
    media_type: str
    placements_summary: list[str]
    required: bool
    # NOVO:
    primary_placement: str           # "Facebook Feed" ou raw formatado da API
    aspect_ratio: str                # "9:16", "1:1 / 1.91:1 / 4:5"
    compatible_slot_keys: list[str]  # resolvido por template após detecção de todos os slots
```

**Resolução do `primary_placement`:**
```python
def _resolve_primary_placement(placements: list[tuple[str, str]]) -> str:
    for platform, position in placements:
        info = placement_registry.lookup(platform, position)
        if info:
            return info.display_name
    if placements:
        _, position = placements[0]
        return position.replace("_", " ").title()
    return ""
```

**Resolução de `compatible_slot_keys`** (após todos os slots estarem montados):
```python
def _resolve_compatibility(
    slots: list[CreativeMediaSlot],
    slot_placements: dict[str, list[tuple[str, str]]],
) -> None:
    placement_to_slot: dict[tuple[str, str], str] = {}
    for slot_key, placements in slot_placements.items():
        for p in placements:
            placement_to_slot[p] = slot_key

    for slot in slots:
        seen: set[str] = set()
        compatible: list[str] = []
        for platform, position in slot_placements.get(slot.slot_key, []):
            info = placement_registry.lookup(platform, position)
            if not info:
                continue
            for compat_platform, compat_position in info.compatible_with:
                target_key = placement_to_slot.get((compat_platform, compat_position))
                if target_key and target_key != slot.slot_key and target_key not in seen:
                    seen.add(target_key)
                    compatible.append(target_key)
        slot.compatible_slot_keys = compatible
```

---

### 3. `campaign_bulk_service.py` — schema e mapeamento

**Schema (`backend/app/schemas.py`):**
```python
class CampaignBulkItem(BaseModel):
    ad_name: str
    slot_media: dict[str, int]  # { "slot_1": 0, "slot_2": 1, "slot_3": 2 }

    @model_validator(mode="after")
    def validate_slot_media(self):
        if not self.slot_media:
            raise ValueError("slot_media deve conter ao menos um slot")
        if any(v < 0 for v in self.slot_media.values()):
            raise ValueError("índices de arquivo devem ser >= 0")
        return self
```

**`_map_slot_files_to_template`** (substitui lógica binária feed/story):
```python
def _map_slot_files_to_template(
    slot_media: dict[str, int],
    media_refs: dict[int, MediaRef],
    template: CreativeTemplate,
    bundle_id: str,
) -> BundleMediaRef:
    slot_refs: dict[str, MediaRef] = {}

    for slot in template.media_slots:
        file_index = slot_media.get(slot.slot_key)
        if file_index is None:
            if slot.required:
                raise MetaAPIError(
                    f"Slot obrigatório '{slot.display_name}' ({slot.slot_key}) não recebeu mídia.",
                    "bundle_missing_slot",
                )
            continue
        ref = media_refs.get(file_index)
        if not ref:
            raise MetaAPIError(
                f"Índice {file_index} não corresponde a nenhum arquivo enviado.",
                "invalid_file_index",
            )
        if slot.media_type != ref.media_type:
            raise MetaAPIError(
                f"Slot '{slot.display_name}' espera {slot.media_type}, recebeu {ref.media_type}.",
                "media_type_mismatch",
            )
        slot_refs[slot.slot_key] = ref

    return BundleMediaRef(bundle_id=bundle_id, slot_refs=slot_refs)
```

`_is_story_slot` e `_STORY_PLACEMENT_TOKENS` são **removidos**.

---

### 4. Frontend — schemas (`frontend/lib/api/schemas.ts`)

```typescript
const CreativeMediaSlotSchema = z.object({
  slot_key: z.string(),
  display_name: z.string(),
  media_type: z.enum(["image", "video"]),
  placements_summary: z.array(z.string()).default([]),
  required: z.boolean().default(true),
  primary_placement: z.string(),
  aspect_ratio: z.string().default(""),
  compatible_slot_keys: z.array(z.string()).default([]),
})

const CampaignBulkItemSchema = z.object({
  ad_name: z.string(),
  campaign_name: z.string().optional(),
  adset_name_template: z.string().optional(),
  slot_media: z.record(z.string(), z.number().int().min(0)),
})
```

---

### 5. Frontend — estado e lógica (`upload/page.tsx`)

```typescript
interface SlotFile {
  file: File
  isAutoFilled: boolean
  autoFilledFrom: string  // slot_key de origem
}

interface AdMediaSet {
  id: string
  adName: string
  slots: Record<string, SlotFile | null>  // { slot_key: SlotFile | null }
}

function applyUpload(set: AdMediaSet, slotKey: string, file: File, template: CreativeTemplate): AdMediaSet {
  const updated = { ...set, slots: { ...set.slots } }
  updated.slots[slotKey] = { file, isAutoFilled: false, autoFilledFrom: "" }
  const slot = template.media_slots.find(s => s.slot_key === slotKey)
  for (const compatKey of slot?.compatible_slot_keys ?? []) {
    const existing = updated.slots[compatKey]
    if (!existing || existing.isAutoFilled) {
      updated.slots[compatKey] = { file, isAutoFilled: true, autoFilledFrom: slotKey }
    }
  }
  return updated
}

function resetSlotToAutoFill(set: AdMediaSet, slotKey: string, template: CreativeTemplate): AdMediaSet {
  const slot = template.media_slots.find(s => s.slot_key === slotKey)
  const sourceKey = slot?.compatible_slot_keys.find(k => !!set.slots[k]?.file)
  if (!sourceKey) return set
  const sourceFile = set.slots[sourceKey]!.file
  return { ...set, slots: { ...set.slots, [slotKey]: { file: sourceFile, isAutoFilled: true, autoFilledFrom: sourceKey } } }
}

// Payload
function buildSlotMedia(set: AdMediaSet, allFiles: File[], fileIndexMap: Map<File, number>) {
  return Object.fromEntries(
    Object.entries(set.slots)
      .filter(([, v]) => v?.file)
      .map(([slotKey, v]) => {
        const file = v!.file
        if (!fileIndexMap.has(file)) {
          fileIndexMap.set(file, allFiles.length)
          allFiles.push(file)
        }
        return [slotKey, fileIndexMap.get(file)!]
      })
  )
}
```

Removed: `campaignRequiresBothSlots`, `campaignTemplateUnsupportedSlots`, `feedStoryPairs`, `FeedStoryPair`.

---

### 6. Frontend — componente `SlotUploadZone`

Substitui `FeedStoryUploadZone`. Renderiza N zonas dinamicamente com auto-fill e reset.

```typescript
function SlotUploadZone({ slots, mediaSet, template, onChange }: SlotUploadZoneProps) {
  return (
    <div className="space-y-3">
      {slots.map(slot => {
        const current = mediaSet.slots[slot.slot_key]
        const isAutoFilled = !!current?.isAutoFilled
        const sourceSlot = slots.find(s => s.slot_key === current?.autoFilledFrom)
        const resetSourceSlot = slots.find(s => s.slot_key === slot.compatible_slot_keys[0])

        return (
          <div key={slot.slot_key} className="relative">
            {isAutoFilled && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <LinkIcon className="h-3 w-3" />
                Preenchido automaticamente com mídia de{" "}
                <span className="font-medium">{sourceSlot?.primary_placement}</span>
              </div>
            )}
            <FileDropzone
              label={slot.display_name}
              description={slot.aspect_ratio}
              required={slot.required}
              file={current?.file ?? null}
              onFile={file => onChange(applyUpload(mediaSet, slot.slot_key, file, template))}
              onClear={() => onChange(clearSlot(mediaSet, slot.slot_key))}
            />
            {!isAutoFilled && slot.compatible_slot_keys.length > 0 && current?.file && (
              <button
                className="text-xs text-muted-foreground underline mt-1"
                onClick={() => onChange(resetSlotToAutoFill(mediaSet, slot.slot_key, template))}
              >
                Usar mídia do {resetSourceSlot?.primary_placement}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

---

## Decision Log

| # | Decisão | Alternativas | Motivo |
|---|---|---|---|
| 1 | Compatibilidade por lista explícita (não grupos nomeados) | Grupos por aspect ratio | Mais preciso — mesmo AR não implica intercambialidade |
| 2 | Enum hardcoded Python como enriquecimento | Config JSON, tabela no banco | Sem impacto no fluxo; baixa frequência de mudança; sem complexidade operacional |
| 3 | Posicionamento desconhecido → slot genérico funcional | Bloquear template | Meta API já tem os dados para criar o slot |
| 4 | Backend computa compatibilidades | Frontend computa, endpoint separado | Fonte de verdade única; frontend não conhece o registry |
| 5 | Compatibilidade bidirecional | Unidirecional | Mais natural — qualquer slot pode servir de fonte |
| 6 | Sem cascade no auto-fill | Override propaga para compatíveis | Comportamento previsível |
| 7 | Prioridade pela ordem da lista `compatible_with` | Campo numérico explícito | Suficiente; menos overhead |
| 8 | Chave `slot_media`: `slot_key` opaco | Nome do posicionamento | Evita colisões em slots multi-plataforma |
| 9 | Label reset: "Usar mídia do {primary_placement}" | Label genérico | Contextual e intuitivo |
| 10 | Fallback `primary_placement`: raw value formatado | "Posicionamento desconhecido" | Transparência — mostra o que veio da Meta |
| 11 | `compatible_slot_keys` em cada slot (Abordagem 1) | Grafo separado no template | Frontend mais simples; sem lookup extra |
| 12 | `_is_story_slot` e `_STORY_PLACEMENT_TOKENS` removidos | Manter como fallback | Substituídos por mapeamento explícito |
