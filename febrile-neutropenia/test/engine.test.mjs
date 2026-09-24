// Тесты расчётов и правил выбора терапии.
// Функции берутся прямо из index.html (от "use strict" до блока «состояние и хранилище»),
// поэтому проверяется тот же код, что работает в приложении.
// Запуск: node --test febrile-neutropenia/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const from = html.indexOf('"use strict";');
const to = html.indexOf("/* ================== состояние и хранилище");
assert.ok(from > 0 && to > from, "не найден блок расчётов в index.html");
const E = new Function(html.slice(from, to) + "\nreturn {num, crcl, doseOf, sofa, qsofa, mascc, shock, recommend, planSteps};")();

// Пустой эпизод в том виде, в каком его создаёт newEpisode()
const EMPTY = {age:"", sex:"", weight:"", height:"", scr:"", anc:"", ancFalling:false, expDuration:"short", prophylaxis:"none", priorAbx:"none",
  comorbid:false, copd:false, tempMax:"", tempSustained:false, feverDays:0, sbp:"", dbp:"", hr:"", rr:"", spo2:"", fio2:"", po2:"", gcs:"",
  lactate:"", plt:"", bil:"", crea_umol:"", sofaBase:"", diur24:"", norad:"", adr:"", dopa:"", dobu:"", vent:"0", rrt:"none",
  masccBurden:"mod", dehydration:false, outpatient:false, solidOrNoFungal:false,
  foci:{}, ct:{}, colonization:{}, cultures:[], gm:"", bdg:"", gramPosBlood:false, candidemia:false, cdiff:false, hsv:false};

// Базовый пациент раздела 11.2 PRD: все поля заполнены, отклонений нет
const BASE = {...EMPTY, age:"55", sex:"m", weight:"75", height:"178", scr:"0.9", crea_umol:"80", anc:"0.2", tempMax:"38.6",
  sbp:"120", dbp:"75", rr:"18", spo2:"97", gcs:"15", plt:"160", bil:"12", diur24:"1800", lactate:"1.2",
  masccBurden:"none", outpatient:true, solidOrNoFungal:true};
const pt = over => ({...BASE, ...over, foci:{...(over.foci || {})}, ct:{...(over.ct || {})}, colonization:{...(over.colonization || {})}});
const names = r => [...r.rx, ...r.addons, ...r.fungal, ...r.viral].map(x => x.n);

test("num: пустое поле — нет данных, а не ноль (Д1)", () => {
  assert.equal(E.num(""), null);
  assert.equal(E.num("  "), null);
  assert.equal(E.num(null), null);
  assert.equal(E.num(undefined), null);
  assert.equal(E.num("abc"), null);
  assert.equal(E.num("0"), 0);
  assert.equal(E.num(0), 0);
  assert.equal(E.num("1,5"), 1.5);
  assert.equal(E.num(" 38.6 "), 38.6);
});

test("пустой эпизод не даёт баллов SOFA и признаков шока (Д1)", () => {
  const r = E.recommend(EMPTY);
  assert.equal(r.sofa.total, 0);
  assert.deepEqual(Object.keys(r.sofa.parts), []);
  assert.deepEqual(r.sofa.miss, ["дыхание", "тромбоциты", "билирубин", "гемодинамика", "сознание", "почки"]);
  assert.equal(r.qsofa.score, 0);
  assert.equal(r.qsofa.map, null);
  assert.equal(r.shock.suspected, false);
  assert.equal(r.baseKey, "cefepime");
  assert.ok(!r.flags.some(f => /нестабильность|шок|SOFA/.test(f.t)));
});

test("незаполненные ШКГ и диурез перечисляются как «нет данных» (Д1)", () => {
  const r = E.recommend(pt({gcs:"", diur24:""}));
  assert.equal(r.sofa.total, 0);
  assert.ok(r.sofa.miss.includes("сознание"));
  assert.ok(!("cns" in r.sofa.parts));
  assert.equal(r.sofa.parts.renal.p, 0); // креатинин 80 есть, диурез не внесён
});

test("MASCC: тяжесть симптомов 5 / 3 / 0, прежнее значение mild = умеренные (Д2)", () => {
  const burden = b => E.mascc(pt({masccBurden:b})).items[0][1];
  assert.equal(burden("none"), 5);
  assert.equal(burden("mod"), 3);
  assert.equal(burden("mild"), 3);
  assert.equal(burden("sev"), 0);
  assert.equal(E.mascc(pt({})).total, 26);
  assert.equal(E.mascc(pt({masccBurden:"mod"})).total, 24);
});

test("тромбоцитопения без исходного SOFA не засчитывается как органная дисфункция (Д3)", () => {
  const r = E.recommend(pt({plt:"40"}));
  assert.equal(r.sofa.total, 3);
  assert.equal(r.sofa.dys, 0);
  assert.equal(r.risk.cls, "low");
  assert.ok(r.flags.some(f => f.lvl === "info" && /тромбоцитопени/.test(f.t)));
  assert.ok(!r.flags.some(f => /Органная дисфункция/.test(f.t)));
});

test("при указанном исходном SOFA дисфункция считается по приросту (Д3)", () => {
  // тромбоциты 40 (3) + билирубин 40 (2) = 5; исходный 3 → прирост 2
  const r = E.recommend(pt({plt:"40", bil:"40", sofaBase:"3"}));
  assert.equal(r.sofa.total, 5);
  assert.equal(r.sofa.dys, 2);
  assert.equal(r.risk.cls, "high");
  assert.ok(r.flags.some(f => /Органная дисфункция/.test(f.t)));
  // без исходного — билирубин 2 балла без коагуляции тоже дисфункция
  assert.equal(E.recommend(pt({plt:"40", bil:"40"})).sofa.dys, 2);
  // исходный выше текущего — прирост не отрицательный
  assert.equal(E.recommend(pt({plt:"40", sofaBase:"6"})).sofa.dys, 0);
});

test("клинические очаги, ЗПТ и низкий клиренс повышают риск (Д4)", () => {
  assert.equal(E.recommend(pt({})).risk.cls, "low");
  for (const over of [{foci:{resp:true}}, {ct:{consol:true}}, {foci:{cvc:true}}, {foci:{cns:true}}, {foci:{gi:true}},
    {foci:{perianal:true}}, {ct:{typhl:true}}, {rrt:"hd"}, {rrt:"crrt"}, {age:"75", scr:"3.0", crea_umol:"265"}]) {
    const r = E.recommend(pt(over));
    assert.equal(r.risk.cls, "high", JSON.stringify(over));
    assert.doesNotMatch(r.risk.d, /Возможна пероральная терапия/);
  }
  assert.match(E.recommend(pt({foci:{cvc:true}})).risk.d, /инфекция ЦВК/);
});

test("выбор стартовой схемы: 15 сценариев раздела 11.2", () => {
  const cases = [
    [{}, "cefepime", ["Цефепим"], "low"],
    [{anc:"1.5"}, "cefepime", ["Цефепим"], "low"],
    [{foci:{gi:true}, ct:{typhl:true}, outpatient:false, expDuration:"long", masccBurden:"mod"}, "piptazo", ["Пиперациллин/тазобактам"], "high"],
    [{colonization:{esbl:true}, outpatient:false, expDuration:"long"}, "meropenem", ["Меропенем"], "high"],
    [{sbp:"78", dbp:"40", norad:"0.3", lactate:"4.5", rr:"28", gcs:"13", outpatient:false, masccBurden:"sev"}, "meropenem", ["Меропенем", "Амикацин", "Ванкомицин"], "high"],
    [{colonization:{cre:true}, outpatient:false, expDuration:"long"}, "czataz", ["Цефтазидим/авибактам"], "high"],
    [{colonization:{mbl:true}, outpatient:false, expDuration:"long"}, "cefiderocol", ["Цефидерокол", "Азтреонам"], "high"],
    [{foci:{cvc:true}, outpatient:false}, "cefepime", ["Цефепим", "Ванкомицин"], "high"],
    [{foci:{resp:true}, ct:{consol:true}, colonization:{vre:true}, outpatient:false}, "cefepime", ["Цефепим", "Линезолид"], "high"],
    [{ct:{halo:true}, gm:"pos", expDuration:"long", feverDays:5, outpatient:false}, "cefepime", ["Цефепим", "Вориконазол"], "high"],
    [{ct:{revhalo:true}, expDuration:"long", outpatient:false}, "cefepime", ["Цефепим", "Липосомальный амфотерицин B"], "high"],
    [{expDuration:"long", feverDays:5, outpatient:false}, "cefepime", ["Цефепим", "Каспофунгин"], "high"],
    [{age:"75", scr:"3.0", crea_umol:"265", weight:"70"}, "cefepime", ["Цефепим"], "high"],
    [{rrt:"hd", outpatient:false}, "cefepime", ["Цефепим"], "high"],
    [{weight:"140", height:"170"}, "cefepime", ["Цефепим"], "low"],
  ];
  cases.forEach(([over, base, drugs, risk], i) => {
    const r = E.recommend(pt(over));
    assert.equal(r.baseKey, base, `сценарий ${i + 1}`);
    assert.deepEqual(names(r), drugs, `сценарий ${i + 1}`);
    assert.equal(r.risk.cls, risk, `сценарий ${i + 1}`);
  });
});

test("дозы по клиренсу и ЗПТ", () => {
  assert.match(E.recommend(pt({age:"75", scr:"3.0", weight:"70"})).rx[0].dose, /^1 г в\/в каждые 12 ч/);
  assert.match(E.recommend(pt({rrt:"hd"})).rx[0].dose, /после сеанса/);
  const c = E.crcl(pt({weight:"140", height:"170"}));
  assert.match(c.note, /скорректированной массе/);
  assert.equal(Math.round(c.v), 125);
  assert.equal(E.crcl(pt({scr:""})), null);
});

test("сценарий 1 из раздела 11.1: шок, ЦВК и ЖКТ, ESBL", () => {
  const p = pt({dx:"ОМЛ", age:"58", weight:"80", height:"175", scr:"1.4", crea_umol:"124", tempMax:"39.1", expDuration:"long", feverDays:"5",
    sbp:"86", dbp:"48", hr:"124", rr:"26", spo2:"93", norad:"0.15", lactate:"4.2", plt:"18", bil:"30", gcs:"14", diur24:"900",
    outpatient:false, foci:{cvc:true, gi:true}, colonization:{esbl:true}});
  const r = E.recommend(p);
  assert.equal(r.sofa.total, 12);
  assert.equal(r.qsofa.score, 3);
  assert.equal(r.shock.septicShock, true);
  assert.deepEqual(names(r), ["Меропенем", "Амикацин", "Ванкомицин", "Каспофунгин"]); // метронидазол к карбапенему не нужен
  assert.match(r.addons[0].dose, /каждые 36 ч/);
  // без диуреза почечный компонент считается по креатинину, а не как анурия
  assert.equal(E.recommend({...p, diur24:""}).sofa.parts.renal.p, 1);
});

test("план: линия 2 не дублирует линию 1", () => {
  const p = pt({foci:{cvc:true}});
  const r = E.recommend(p), steps = E.planSteps(p, r);
  assert.equal(steps.length, 5);
  const line2 = steps[2].br.find(b => /ухудшение/.test(b[0]))[1];
  assert.match(line2, /эскалация до карбапенема: Меропенем/);
  assert.match(line2, /Амикацин/);
  assert.doesNotMatch(line2, /анти-MRSA компонент/); // ванкомицин уже в линии 1
  assert.match(line2, /Каспофунгин/);
  assert.equal(steps[1].when, "через 24 часа");
  assert.equal(E.planSteps(pt({sbp:"80", dbp:"45", norad:"0.2"}), E.recommend(pt({sbp:"80", dbp:"45", norad:"0.2"})))[1].when, "через 6–12 часов");
});
