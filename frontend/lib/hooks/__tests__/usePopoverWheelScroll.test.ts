import test from "node:test";
import assert from "node:assert/strict";

import { attachPopoverWheelScroll, createPopoverWheelRef } from "../usePopoverWheelScroll";

/**
 * Elemento de mentira com o mínimo que o mecanismo toca. Guarda os listeners para o
 * teste poder disparar a roda e conferir que foram soltos.
 */
function elementoFalso(altura = { scrollHeight: 1000, clientHeight: 300 }) {
  const listeners: Array<{ tipo: string; fn: (e: unknown) => void; opts: unknown }> = [];
  const el = {
    scrollTop: 0,
    scrollHeight: altura.scrollHeight,
    clientHeight: altura.clientHeight,
    addEventListener(tipo: string, fn: (e: unknown) => void, opts: unknown) {
      listeners.push({ tipo, fn, opts });
    },
    removeEventListener(_tipo: string, fn: (e: unknown) => void) {
      const i = listeners.findIndex((l) => l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    listeners,
  };
  return el as unknown as HTMLElement & { listeners: typeof listeners };
}

function rodaDeMouse(deltaY: number, deltaMode = 0) {
  const evento = {
    deltaY,
    deltaMode,
    cancelable: true,
    propagouParaCima: true,
    padraoImpedido: false,
    stopPropagation() {
      evento.propagouParaCima = false;
    },
    preventDefault() {
      evento.padraoImpedido = true;
    },
  };
  return evento;
}

function dispara(el: HTMLElement & { listeners: Array<{ fn: (e: unknown) => void }> }, evento: unknown) {
  assert.equal(el.listeners.length, 1, "esperava exatamente um listener de roda preso");
  el.listeners[0].fn(evento);
}

// ─── A regressão de 2026-09-04 ────────────────────────────────────────────────
// Duas correções ficaram no ar por dias porque prendiam o listener num useEffect
// que rodava ANTES de o popover existir no DOM e nunca mais rodava. O contrato que
// impede isso de voltar é este: prender acontece dentro da chamada do ref.

test("prender o listener acontece DENTRO da chamada do ref, não depois", () => {
  const el = elementoFalso();
  const ref = createPopoverWheelRef();

  assert.equal(el.listeners.length, 0, "nada preso antes do nó chegar");
  ref(el);
  assert.equal(el.listeners.length, 1, "o listener tem que estar preso assim que o ref é chamado");
  assert.equal(el.listeners[0].tipo, "wheel");
  assert.deepEqual(el.listeners[0].opts, { passive: false }, "passive:false é o que permite preventDefault");
});

test("o ref de callback solta o listener quando o nó sai (null)", () => {
  const el = elementoFalso();
  const ref = createPopoverWheelRef();
  ref(el);
  ref(null);
  assert.equal(el.listeners.length, 0);
});

test("trocar de nó não deixa o listener antigo pendurado", () => {
  const antigo = elementoFalso();
  const novo = elementoFalso();
  const ref = createPopoverWheelRef();
  ref(antigo);
  ref(novo);
  assert.equal(antigo.listeners.length, 0, "o nó velho não pode continuar escutando");
  assert.equal(novo.listeners.length, 1);
});

test("o ref externo do componente continua sendo preenchido", () => {
  const el = elementoFalso();
  const refExterno = { current: null } as { current: HTMLElement | null };
  const ref = createPopoverWheelRef(refExterno);
  ref(el);
  assert.equal(refExterno.current, el, "quem usa o ref para rolagem infinita depende disto");
  ref(null);
  assert.equal(refExterno.current, null);
});

// ─── O comportamento da roda ──────────────────────────────────────────────────

test("rola a lista ela mesma e impede o padrão do navegador", () => {
  const el = elementoFalso();
  attachPopoverWheelScroll(el);
  const evento = rodaDeMouse(120);
  dispara(el, evento);
  assert.equal(el.scrollTop, 120);
  assert.equal(evento.padraoImpedido, true);
  assert.equal(evento.propagouParaCima, false);
});

test("converte deltaMode de linhas (Firefox) para pixels", () => {
  const el = elementoFalso();
  attachPopoverWheelScroll(el);
  dispara(el, rodaDeMouse(3, 1));
  assert.equal(el.scrollTop, 48, "3 linhas x 16px — sem converter andaria 3px por giro");
});

test("no topo rolando para cima deixa o evento seguir", () => {
  const el = elementoFalso();
  attachPopoverWheelScroll(el);
  const evento = rodaDeMouse(-120);
  dispara(el, evento);
  assert.equal(el.scrollTop, 0);
  assert.equal(evento.padraoImpedido, false, "sem isto a lista prenderia a roda do mouse");
  assert.equal(evento.propagouParaCima, true);
});

test("no fim rolando para baixo deixa o evento seguir", () => {
  const el = elementoFalso();
  el.scrollTop = 700; // 1000 - 300
  attachPopoverWheelScroll(el);
  const evento = rodaDeMouse(120);
  dispara(el, evento);
  assert.equal(el.scrollTop, 700);
  assert.equal(evento.padraoImpedido, false);
});

test("lista que não tem o que rolar não sequestra a roda", () => {
  const el = elementoFalso({ scrollHeight: 200, clientHeight: 200 });
  attachPopoverWheelScroll(el);
  const evento = rodaDeMouse(120);
  dispara(el, evento);
  assert.equal(evento.padraoImpedido, false);
});

test("não passa do fim da lista", () => {
  const el = elementoFalso();
  attachPopoverWheelScroll(el);
  dispara(el, rodaDeMouse(5000));
  assert.equal(el.scrollTop, 700);
});
