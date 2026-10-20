// Unicode 17 and diacritic source licenses are retained in THIRD_PARTY_NOTICES.
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const folds = {};
for (const line of read("tools/unicode-17.0.0/CaseFolding.txt").split(/\r?\n/)) {
  const [code, status, mapping] = line
    .split("#")[0]
    .split(";")
    .map((s) => s.trim());
  if (status === "C" || status === "S") folds[parseInt(code, 16)] = parseInt(mapping, 16);
}
const properties = { Uppercase: [], Lowercase: [], Titlecase: [] };
for (const line of read("tools/unicode-17.0.0/DerivedCoreProperties.txt").split(/\r?\n/)) {
  const [range, property] = line
    .split("#")[0]
    .split(";")
    .map((s) => s.trim());
  if (property !== "Uppercase" && property !== "Lowercase") continue;
  const [start, end = start] = range.split("..");
  properties[property].push([parseInt(start, 16), parseInt(end, 16)]);
}
for (const line of read("tools/unicode-17.0.0/UnicodeData.txt").split(/\r?\n/)) {
  const [code, , category] = line.split(";");
  if (category === "Lt") properties.Titlecase.push([parseInt(code, 16), parseInt(code, 16)]);
}
const diacritics = {};
for (const [character, base] of Object.entries(require("diacritic").map))
  diacritics[character.codePointAt(0)] = base.toLowerCase();
async function writeTables() {
  const prettier = require("prettier");
  for (const [name, data] of [
    ["unicode-data", { folds, ...properties }],
    ["diacritics-data", diacritics],
  ]) {
    const output = await prettier.format(JSON.stringify(data), { parser: "json" });
    fs.writeFileSync(path.join(root, "lib", name + ".json"), output);
  }
}
writeTables().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
