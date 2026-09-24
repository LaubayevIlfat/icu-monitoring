// Тесты расчётов и правил выбора обезболивания.
// Функции берутся прямо из index.html (от "use strict" до блока «состояние»),
// поэтому проверяется тот же код, что работает в приложении.
// Запуск: node --test chronic-pain/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const from = html.indexOf('"use strict";');
const to = html.indexOf("/* ===================== состояние");
assert.ok(from > 0 && to > from, "не найден блок расчётов в index.html");
const E = new Function(html.slice(from, to) + "\nreturn {num, gfr, doseOf, omeDaily, recommend, DRUGS};")();

// Пустой случай в том виде, в каком его создаёт newEpisode()
const EMPTY = {age:"", sex:"", weight:"", height:"", scr:"", dx:"", plt:"", liver:false, ulcer:false, hf:false, cvRisk:false, elderly:false, cipn:false,
  nrsNow:"", nrsAvg:"", nrsWorst:"", scaleUsed:"nrs", painadScore:"", dn4:"", sleep:"", activity:"",
  type:{}, red:{}, comed:{}, location:"", character:"", breakthroughPerDay:"",
  curMorphinePO:"", curMorphineIV:"", curOxy:"", curTram:"", curFenta:"", curHydro:"", curOther:"", opioidNow:"none", diary:[]};
// Базовый пациент: мужчина 50 лет, 70 кг, 175 см, креатинин 0,9, тромбоциты 200
const BASE = {...EMPTY, age:"50", sex:"m", weight:"70", height:"175", scr:"0.9", plt:"200"};
const pt = over => ({...BASE, ...over, type:{...(over.type || {})}, red:{...(over.red || {})}, comed:{...(over.comed || {})}});
const rx = r => r.rx.map(x => x.n);
const adj = r => r.adj.map(x => x.n);

test("num: пустое поле — нет данных, а не ноль (Б1)", () => {
  assert.equal(E.num(""), null);
  assert.equal(E.num("  "), null);
  assert.equal(E.num(undefined), null);
  assert.equal(E.num("0"), 0);
  assert.equal(E.num("1,9"), 1.9);
});

test("пустые тромбоциты не запрещают НПВП, пустой креатинин не даёт бесконечную СКФ (Б1)", () => {
  const noPlt = E.recommend(pt({plt:"", nrsNow:"5"}));
  assert.ok(!noPlt.nsaidBlock.some(x => /тромбоциты/.test(x)));
  const noScr = E.recommend(pt({scr:"", nrsNow:"8"}));
  assert.equal(noScr.gfr, null);
  assert.match(noScr.rx.find(x => x.n === "Морфин").basis, /СКФ не рассчитана/);
  const empty = E.recommend(EMPTY);
  assert.deepEqual(empty.nsaidBlock, []);
  assert.equal(empty.gfr, null);
});

test("болевой криз ведёт к сильному опиоиду даже при боли 5 (Б2)", () => {
  const r = E.recommend(pt({nrsNow:"5", red:{crisis:true}}));
  assert.ok(rx(r).includes("Морфин"));
  assert.ok(!rx(r).includes("Трамадол"));
  assert.ok(r.flags.some(f => f.lvl === "crit" && /болевой криз/i.test(f.t)));
});

test("при отсутствии боли НПВП не назначается (Б3)", () => {
  assert.ok(!rx(E.recommend(pt({nrsNow:"0", nrsAvg:"0"}))).includes("Ибупрофен"));
  assert.ok(!rx(E.recommend(pt({}))).includes("Ибупрофен"));
  assert.ok(rx(E.recommend(pt({nrsNow:"2"}))).includes("Ибупрофен"));
  // костная боль сильной интенсивности — НПВП остаётся
  assert.ok(rx(E.recommend(pt({nrsNow:"8", type:{bone:true}}))).includes("Ибупрофен"));
});

test("СКФ < 30 без опиоидов: сначала гидроморфон с дозой, пластырь — только после подбора (Б4)", () => {
  const p = pt({age:"80", sex:"f", weight:"50", height:"155", scr:"2.5", nrsNow:"8"});
  const r = E.recommend(p);
  assert.ok(r.gfr.v < 30);
  assert.equal(r.rx[1].n, "Гидроморфон");
  assert.match(r.rx[1].dose, /0,65 мг/);
  const patch = r.rx.find(x => /Бупренорфин/.test(x.n));
  assert.match(patch.dose, /^не начинать до подбора/);
  assert.ok(!rx(r).includes("Морфин"));
  // уже на сильном опиоиде — пластырь предлагается сразу
  const onOpioid = E.recommend({...p, opioidNow:"strong", curMorphinePO:"60"});
  assert.equal(onOpioid.rx[1].n, "Бупренорфин трансдермальный");
  assert.match(onOpioid.rx[1].dose, /35 мкг\/ч/);
});

test("гидроморфон при СКФ < 30 выводится с дозой, а не только с предупреждением (Б4)", () => {
  const d10 = E.doseOf("hydro", pt({age:"80", sex:"f", weight:"50", height:"155", scr:"2.5"}));
  assert.match(d10.dose, /0,65 мг внутрь каждые 6–8 ч/);
  const d5 = E.doseOf("hydro", pt({age:"80", sex:"f", weight:"45", height:"150", scr:"6"}));
  assert.match(d5.dose, /0,65 мг внутрь каждые 8–12 ч/);
});

test("амитриптилин исключается у пожилых и при факторах удлинения QT (Б5)", () => {
  const neuro = over => adj(E.recommend(pt({nrsNow:"5", type:{neuro:true}, ...over})));
  assert.ok(neuro({}).includes("Амитриптилин"));
  assert.ok(!neuro({age:"80"}).includes("Амитриптилин"));
  assert.ok(!neuro({elderly:true}).includes("Амитриптилин"));
  for (const k of ["ondan", "fq", "azole"]) assert.ok(!neuro({comed:{[k]:true}}).includes("Амитриптилин"), k);
});

test("лидокаин не дублируется (Б6)", () => {
  const a = adj(E.recommend(pt({nrsNow:"5", type:{neuro:true, nocic:true, muco:true}})));
  assert.equal(a.filter(n => n === "Лидокаин местно").length, 1);
});

test("СКФ по CKD-EPI 2021", () => {
  const g = E.gfr(pt({}));             // мужчина 50 лет, 0,9 мг/дл: 142 × 0,9938^50
  assert.equal(Math.round(g.idx), 104);
  assert.equal(g.bsa.toFixed(2), "1.84"); // √(175 × 70 / 3600)
  assert.equal(Math.round(g.v), 111);
  assert.equal(Math.round(E.gfr(pt({age:"70", sex:"f", scr:"1.1"})).idx), 54);
  const noH = E.gfr(pt({height:""}));
  assert.equal(noH.v, noH.idx);
  assert.equal(E.gfr(pt({sex:""})), null);
  assert.match(E.doseOf("ibu", pt({})).basis, /СКФ 111 мл\/мин \(CKD-EPI\)/);
});

test("сценарий из раздела 11 PRD: миелома, тромбоциты 35, азол и антикоагулянт", () => {
  const p = pt({age:"66", weight:"70", height:"", scr:"1.9", plt:"35", nrsNow:"8", nrsAvg:"7", type:{bone:true, neuro:true}, comed:{azole:true, anticoag:true}});
  const r = E.recommend(p);
  assert.equal(Math.round(r.gfr.v), 38);   // CKD-EPI без роста: индексированная СКФ
  assert.ok(r.nsaidBlock.some(x => /тромбоциты 35/.test(x)));
  assert.ok(r.nsaidBlock.some(x => /антикоагулянт/.test(x)));
  assert.deepEqual(rx(r), ["Парацетамол", "Морфин", "Оксикодон"]);
  assert.match(r.rx[1].dose, /2,5–5 мг внутрь каждые 6 ч/);
  assert.deepEqual(adj(r), ["Прегабалин", "Дулоксетин", "Дексаметазон", "Золедроновая кислота", "Лидокаин местно"]);
  assert.ok(r.inter.some(i => /Азолы \+ опиоиды/.test(i.t)));
  assert.ok(r.inter.some(i => /НПВП \+ антикоагулянты/.test(i.t)));
});

test("пересчёт на морфин и прорывная доза", () => {
  assert.equal(E.omeDaily({curMorphinePO:"60", curFenta:"25"}), 120);
  assert.equal(E.omeDaily({curOxy:"20", curTram:"200"}), 50);
  const r = E.recommend(pt({nrsNow:"7", opioidNow:"strong", curMorphinePO:"60"}));
  assert.ok(r.support.some(x => /6–9 мг морфина внутрь/.test(x)));
});
