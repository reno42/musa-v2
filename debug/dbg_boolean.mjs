// One-shot debug: inspect sampleShapeRing + boolean ops output.
const { sampleShapeRing, booleanShapeOp } = await import("file://" + process.cwd().replace(/\\/g, "/") + "/src/lib/pathBoolean.ts");

const a = sampleShapeRing("M0 0L100 0L100 100L0 100Z");
const b = sampleShapeRing("M50 50L150 50L150 150L50 150Z");
console.log("A:", JSON.stringify(a));
console.log("B:", JSON.stringify(b));
for (const op of ["union", "subtract", "intersect", "exclude"]) {
  console.log(op + ":", JSON.stringify(booleanShapeOp(op, [[a], [b]])));
}
