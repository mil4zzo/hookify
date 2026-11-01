import test from "node:test"
import assert from "node:assert/strict"
import {
  assignToSlots,
  creativeBaseName,
  groupIntoCreatives,
  isCreativeComplete,
  renderName,
  slotRatios,
  type PoolMedia,
} from "../grouping"
import type { MediaSlot } from "../types"

const slot = (slot_key: string, aspect_ratio: string, required = true): MediaSlot =>
  ({
    slot_key,
    display_name: slot_key,
    media_type: "video",
    source: "video_label",
    rules_count: 1,
    placements_summary: [],
    required,
    aspect_ratio,
    compatible_slot_keys: [],
    primary_placement: "",
  }) as unknown as MediaSlot

const FEED = slot("slot_1", "1:1 / 1.91:1 / 4:5")
const STORY = slot("slot_2", "9:16")

const media = (key: string, name: string, width: number | null, height: number | null, group?: string): PoolMedia => ({
  key,
  name,
  width,
  height,
  group,
})

test("nome-base ignora proporção e posicionamento", () => {
  assert.equal(creativeBaseName("AD01_feed.mp4"), "AD01")
  assert.equal(creativeBaseName("AD01 - 9x16.mov"), "AD01")
  assert.equal(creativeBaseName("Oferta Black 4:5 quadrado.png"), "Oferta Black")
  assert.equal(creativeBaseName("story.mp4"), "story") // não sobra nada → mantém o nome
})

test("proporções do slot", () => {
  assert.deepEqual(slotRatios(STORY), [9 / 16])
  assert.equal(slotRatios(FEED).length, 3)
})

test("1 slot: cada arquivo é um criativo", () => {
  const out = groupIntoCreatives([media("a", "AD01.mp4", 1080, 1920), media("b", "AD02.mp4", 1080, 1920)], [STORY])
  assert.deepEqual(
    out.map((c) => [c.name, c.slots.slot_2]),
    [
      ["AD01", "a"],
      ["AD02", "b"],
    ],
  )
})

test("multi-slot: pareia por nome e distribui por proporção (mesmo fora de ordem)", () => {
  const out = groupIntoCreatives(
    [
      media("s1", "AD01_story.mp4", 1080, 1920),
      media("f1", "AD01_feed.mp4", 1080, 1350),
      media("f2", "AD02 4x5.mp4", 1080, 1350),
      media("s2", "AD02 9x16.mp4", 1080, 1920),
    ],
    [FEED, STORY],
  )
  assert.equal(out.length, 2)
  const ad01 = out.find((c) => c.name === "AD01")!
  assert.deepEqual(ad01.slots, { slot_1: "f1", slot_2: "s1" })
  const ad02 = out.find((c) => c.name === "AD02")!
  assert.deepEqual(ad02.slots, { slot_1: "f2", slot_2: "s2" })
})

test("subpasta do Drive manda no agrupamento", () => {
  const out = groupIntoCreatives(
    [media("x", "qualquer.mp4", 1080, 1920, "Criativo A"), media("y", "outro.mp4", 1080, 1080, "Criativo A")],
    [FEED, STORY],
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].name, "Criativo A")
  assert.deepEqual(out[0].slots, { slot_1: "y", slot_2: "x" })
})

test("grupo com 1 arquivo reaproveita a mídia nos dois slots", () => {
  const out = assignToSlots([media("v", "AD.mp4", 1080, 1920)], [FEED, STORY])
  assert.deepEqual(out, { slot_1: "v", slot_2: "v" })
})

test("sem dimensões: ordem de chegada", () => {
  const out = assignToSlots([media("a", "a.mp4", null, null), media("b", "b.mp4", null, null)], [FEED, STORY])
  assert.deepEqual(out, { slot_1: "a", slot_2: "b" })
})

test("completo exige nome e slots obrigatórios", () => {
  const optional = slot("slot_3", "1:1", false)
  assert.equal(isCreativeComplete({ key: "k", name: "AD", slots: { slot_1: "a", slot_2: "b" } }, [FEED, STORY, optional]), true)
  assert.equal(isCreativeComplete({ key: "k", name: " ", slots: { slot_1: "a", slot_2: "b" } }, [FEED, STORY]), false)
  assert.equal(isCreativeComplete({ key: "k", name: "AD", slots: { slot_1: "a" } }, [FEED, STORY]), false)
})

test("renderName troca TODAS as ocorrências (legado só trocava a 1ª)", () => {
  assert.equal(renderName("{ad_name} | {ad_name} #{index}", { ad_name: "AD7", index: 2 }), "AD7 | AD7 #2")
  assert.equal(
    renderName("{template_adset_name} - {ad_name}", { ad_name: "AD7", index: 1, template_adset_name: "LAL 1%" }),
    "LAL 1% - AD7",
  )
})
