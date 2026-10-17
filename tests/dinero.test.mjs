import { test } from "node:test";
import assert from "node:assert/strict";
import { redondear, aCentavos, aPesos, fmtPesos } from "../public/dinero.js";

test("redondeo a centavos sin errores de coma flotante", () => {
  assert.equal(redondear(1.005), 1.01);
  assert.equal(redondear(2368.4210526), 2368.42);
  assert.equal(aCentavos(0.1 + 0.2), 30);
  // Mil renglones de $0,10 suman exactamente $100 si se suma en centavos.
  let c = 0; for (let i = 0; i < 1000; i++) c += aCentavos(0.1);
  assert.equal(aPesos(c), 100);
});

test("formato de pesos argentinos", () => {
  assert.equal(fmtPesos(10000), "$ 10.000");
  assert.equal(fmtPesos(10000.5), "$ 10.000,50");
  assert.equal(fmtPesos(0), "$ 0");
  assert.equal(fmtPesos(-200), "− $ 200");
});
