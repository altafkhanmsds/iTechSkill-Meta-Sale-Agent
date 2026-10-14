import fs from "fs";
const lines = fs.readFileSync("messages/en.json", "utf8").split("\n");
lines.forEach((l, i) => {
  if (l.includes('"groups":') || l.includes('"sections":') || l.includes('"admissions":')) {
    console.log(`Line ${i + 1}: ${l}`);
  }
});
