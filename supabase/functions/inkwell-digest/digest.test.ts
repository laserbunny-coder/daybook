// Checks the summary helpers: node --experimental-strip-types supabase/functions/inkwell-digest/digest.test.ts
import assert from "node:assert/strict";
import * as d from "./digest.ts";
assert.equal(d.mondayOf("2026-11-01"), "2026-10-26");
assert.equal(d.mondayOf("2026-10-26"), "2026-10-26");
assert.equal(d.weekTitle("2026-10-26"), "Week of Oct 26 – Nov 1, 2026");
assert.equal(d.weekTitle("2026-11-02"), "Week of Nov 2 – 8, 2026");
assert.equal(d.monthEnd("2026-02"), "2026-02-28");
assert.equal(d.dayStart("2026-11-02","America/Los_Angeles"), "2026-11-02T08:00:00.000Z");
let p = d.periodsDue("2026-11-02");
assert.equal(p.weeks.at(-1), "2026-10-26"); assert.equal(p.weeks.length, 8);
assert.ok(p.months.includes("2026-10")); assert.ok(!d.periodsDue("2026-11-01").months.includes("2026-10"));
const rows = [
 {id:"a",kind:"line",parent_id:"day-2026-10-27",title:"",text:"Gift idea #gift",tags:["gift"],fields:{},created_at:"2026-10-27T10:00:00Z"},
 {id:"b",kind:"line",parent_id:"a",title:"",text:"ramen kit",tags:[],fields:{},created_at:"2026-10-27T10:01:00Z"},
 {id:"c",kind:"line",parent_id:"day-2026-10-27",title:"",text:"claude note",tags:[],fields:{by:"claude"},created_at:"2026-10-27T10:02:00Z"},
 {id:"e",kind:"para",parent_id:"ch",title:"",text:"prose",tags:[],fields:{},created_at:"2026-10-27T10:03:00Z"},
];
const w = d.weekPrompt(rows as any, (r)=> r.kind==="para" ? "Novel › Ch 1" : "Daily page 2026-10-27");
const t = d.tidy({summary:"x",threads:[{title:"Gift",gist:"g",from:["L2","L9"]}],tags:["#Mom"]}, w.labels, "L");
assert.deepEqual(t.threads[0].ids,["b"]); assert.deepEqual(t.keywords,["mom"]);
console.log("ok");
